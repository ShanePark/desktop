/* Offline tests: no account, network, Electron, or changes to your repositories. */
const Assert = require('node:assert/strict')
const Fs = require('node:fs/promises')
const Path = require('node:path')
const Os = require('node:os')
const { execFileSync } = require('node:child_process')
const Ts = require('typescript')

const tests = []
const test = (name, run) => tests.push({ name, run })
const root = Path.resolve(__dirname, '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const git = (path, args) => execFileSync('git', [
  '-c', 'user.name=Activity Test', '-c', 'user.email=activity-test@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${Os.devNull}`, ...args,
], {
  cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_GLOBAL: Os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
})
const status = path => Promise.resolve(git(path, [
  '--no-optional-locks', '-c', 'core.fsmonitor=false', 'status',
  '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none',
]))
const withRepo = async run => {
  const path = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'desktop-activity-git-'))
  try {
    git(path, ['init', '--initial-branch=main'])
    await Fs.writeFile(Path.join(path, 'file.txt'), 'baseline\n')
    await Fs.writeFile(Path.join(path, '.gitignore'), 'ignored/\n')
    git(path, ['add', '.'])
    git(path, ['commit', '-m', 'baseline'])
    await run(path)
  } finally { await Fs.rm(path, { recursive: true, force: true }) }
}

async function main() {
  const compiled = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'desktop-activity-js-'))
  try {
    for (const name of ['status', 'monitor', 'preferences', 'organization', 'list']) {
      const source = await Fs.readFile(Path.join(root, 'app/src/lib/repository-activity', `${name}.ts`), 'utf8')
      const result = Ts.transpileModule(source, {
        fileName: `${name}.ts`, reportDiagnostics: true,
        compilerOptions: { target: Ts.ScriptTarget.ES2020, module: Ts.ModuleKind.CommonJS, strict: true },
      })
      const errors = (result.diagnostics ?? []).filter(d => d.category === Ts.DiagnosticCategory.Error)
      Assert.equal(errors.length, 0, `${name} must transpile`)
      await Fs.writeFile(Path.join(compiled, `${name}.js`), result.outputText)
    }
    const { parseActivityStatus: parse, sampleRepositoryActivity: sample, advanceActivity: advance, activityKey: key } = require(Path.join(compiled, 'status.js'))
    const { RepositoryActivityMonitor: Monitor } = require(Path.join(compiled, 'monitor.js'))
    const { projectActivityGroups: project, preserveActivityOrder: order } = require(Path.join(compiled, 'list.js'))
    const Prefs = require(Path.join(compiled, 'preferences.js'))
    const snap = (count, time = 100, fingerprint = 'a'.repeat(64)) => ({
      changedFilesCount: count, fingerprint, fileModifiedAt: count ? time : null,
      lastChangedAt: count ? time : null, checkedAt: 1000, error: false,
    })
    const row = (id, name, path = Path.resolve('fixture', name), worktree = null) => ({
      id: String(id), repository: { id: Number(id), name, path }, worktree,
      text: [name], changedFilesCount: 0, needsDisambiguation: false,
    })
    const group = (name, items) => ({ identifier: name, items })
    const prefs = (sort = 'recent', onlyUncommitted = false) => ({ sort, onlyUncommitted })
    const ids = groups => groups.flatMap(g => g.items.map(r => r.id))
    const memoryStorage = () => {
      const data = new Map()
      return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data }
    }

    test('empty status is clean', () => Assert.deepEqual(parse(''), []))
    test('spaces, Unicode and newlines in paths are preserved', () => {
      Assert.deepEqual(parse(' M a file.txt\0?? 한글\nname.txt\0'), [
        { status: ' M', path: 'a file.txt', oldPath: undefined },
        { status: '??', path: '한글\nname.txt', oldPath: undefined },
      ])
    })
    test('rename and copy records consume the original path', () => {
      Assert.deepEqual(parse('R  new name\0old name\0C  copy\0original\0').map(e => [e.path, e.oldPath]), [
        ['new name', 'old name'], ['copy', 'original'],
      ])
    })
    test('staged, unstaged and all unmerged statuses count', () => {
      const statuses = ['M ', ' M', 'MM', 'A ', ' D', 'DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
      Assert.equal(parse(statuses.map((s, i) => `${s} f${i}\0`).join('')).length, statuses.length)
    })
    test('ignored entries are excluded', () => Assert.equal(parse('!! cache\0?? file\0').length, 1))
    test('malformed or truncated status fails instead of claiming clean', () => {
      for (const text of [' M x', 'R  x\0', 'XY x\0', ' M\0']) Assert.throws(() => parse(text))
    })
    test('a real clean repository returns zero changes', () => withRepo(async path => {
      Assert.equal((await sample(path, status)).changedFilesCount, 0)
    }))
    test('tracked, nested untracked and ignored files are classified by Git', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'edit\n')
      await Fs.mkdir(Path.join(path, 'new'))
      await Fs.writeFile(Path.join(path, 'new/a.txt'), 'new')
      await Fs.writeFile(Path.join(path, 'new/b.txt'), 'new')
      await Fs.mkdir(Path.join(path, 'ignored'))
      await Fs.writeFile(Path.join(path, 'ignored/cache'), 'do not count')
      Assert.equal((await sample(path, status)).changedFilesCount, 3)
    }))
    test('staged-only changes are not missed', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'staged')
      git(path, ['add', 'file.txt'])
      Assert.equal((await sample(path, status)).changedFilesCount, 1)
    }))
    test('initial recency uses a changed file mtime, not the scan time', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'edit')
      await Fs.utimes(Path.join(path, 'file.txt'), 1500000000, 1500000000)
      const value = advance(undefined, await sample(path, status), Date.now())
      Assert.equal(value.lastChangedAt, 1500000000000)
    }))
    test('rescanning an unchanged dirty repository preserves its activity time', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'edit')
      const initial = advance(undefined, await sample(path, status), 100)
      Assert.equal(advance(initial, await sample(path, status), 200).lastChangedAt, initial.lastChangedAt)
    }))
    test('editing the same dirty file changes the fingerprint without changing count', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'one')
      await Fs.utimes(Path.join(path, 'file.txt'), 1600000000, 1600000000)
      const first = await sample(path, status)
      await Fs.appendFile(Path.join(path, 'file.txt'), 'two')
      await Fs.utimes(Path.join(path, 'file.txt'), 1700000000, 1700000000)
      const second = await sample(path, status)
      Assert.equal(first.changedFilesCount, second.changedFilesCount)
      Assert.notEqual(first.fingerprint, second.fingerprint)
      const initial = advance(undefined, first, 100)
      Assert.ok(advance(initial, second, 200).lastChangedAt > initial.lastChangedAt)
    }))
    test('an initial deletion has unknown time rather than invented recency', () => withRepo(async path => {
      await Fs.unlink(Path.join(path, 'file.txt'))
      const value = await sample(path, status)
      Assert.equal(value.changedFilesCount, 1)
      Assert.equal(advance(undefined, value, Date.now()).lastChangedAt, null)
    }))
    test('an observed deletion receives an observation timestamp', () => withRepo(async path => {
      const baseline = advance(undefined, await sample(path, status), 100)
      await Fs.unlink(Path.join(path, 'file.txt'))
      Assert.equal(advance(baseline, await sample(path, status), 200).lastChangedAt, 200)
    }))
    test('real staged rename with whitespace is one change', () => withRepo(async path => {
      git(path, ['mv', 'file.txt', 'renamed file.txt'])
      Assert.equal((await sample(path, status)).changedFilesCount, 1)
    }))
    test('linked worktrees are scanned by their own paths', () => withRepo(async path => {
      const linked = Path.join(path, 'ignored', 'linked')
      await Fs.mkdir(Path.join(path, 'ignored'))
      git(path, ['worktree', 'add', '-b', 'activity-test', linked])
      await Fs.appendFile(Path.join(linked, 'file.txt'), 'linked edit')
      Assert.equal((await sample(linked, status)).changedFilesCount, 1)
      Assert.equal((await sample(path, status)).changedFilesCount, 0)
    }))
    test('committing removes a repository from the dirty set', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'edit')
      const before = advance(undefined, await sample(path, status), 100)
      git(path, ['add', '.']); git(path, ['commit', '-m', 'edit'])
      const after = advance(before, await sample(path, status), 200)
      Assert.equal(after.changedFilesCount, 0); Assert.equal(after.lastChangedAt, null)
    }))
    test('status paths cannot escape the working copy', () => withRepo(async path => {
      await Assert.rejects(sample(path, async () => '?? ../outside\0'))
      await Assert.rejects(sample(path, async () => `?? ${Path.resolve(path, '..', 'outside')}\0`))
    }))
    test('symlink targets are not followed for activity timestamps', () => withRepo(async path => {
      await Fs.symlink('missing-target', Path.join(path, 'link'))
      Assert.equal((await sample(path, status)).changedFilesCount, 1)
    }))
    test('local changes rank globally across groups and duplicate recent rows disappear', () => {
      const a = row(1, 'alpha'), z = row(2, 'zeta'), b = row(3, 'beta')
      const data = new Map([[key(a.repository.path), snap(0)], [key(z.repository.path), snap(1, 500)], [key(b.repository.path), snap(2, 400)]])
      Assert.deepEqual(ids(project([group('recent', [a, z]), group('owner1', [a]), group('owner2', [b, z])], data, prefs(), 'activity')), ['2', '3', '1'])
    })
    test('dirty-first uses a deterministic name tie-breaker', () => {
      const a = row(1, 'alpha'), z = row(2, 'zeta')
      const data = new Map([[key(a.repository.path), snap(1, 100)], [key(z.repository.path), snap(1, 900)]])
      Assert.deepEqual(ids(project([group('all', [z, a])], data, prefs('dirty-first'), 'activity')), ['1', '2'])
    })
    test('uncommitted-only hides confirmed clean rows but retains unknown/error rows', () => {
      const clean = row(1, 'clean'), dirty = row(2, 'dirty'), unknown = row(3, 'unknown'), failed = row(4, 'failed')
      const data = new Map([[key(clean.repository.path), snap(0)], [key(dirty.repository.path), snap(1)], [key(failed.repository.path), { ...snap(0), error: true }]])
      const actual = ids(project([group('all', [clean, dirty, unknown, failed])], data, prefs('recent', true), 'activity'))
      Assert.deepEqual(new Set(actual), new Set(['2', '3', '4']))
    })
    test('stale clean cache is rechecked before a row is hidden', () => {
      const a = row(1, 'a')
      const data = new Map([[key(a.repository.path), { ...snap(0), checkedAt: 0 }]])
      Assert.deepEqual(ids(project([group('all', [a])], data, prefs('recent', true), 'activity')), ['1'])
    })
    test('stale snapshots fall back to current row indicators for Working', () => {
      const dirty = {
        ...row(1, 'dirty'),
        changedFilesCount: 3,
        aheadBehind: { ahead: 0, behind: 1 },
      }
      const ahead = {
        ...row(2, 'ahead'),
        aheadBehind: { ahead: 2, behind: 0 },
      }
      const clean = {
        ...row(3, 'clean'),
        aheadBehind: { ahead: 0, behind: 0 },
      }
      const organization = {
        groups: [{ id: 'group-a', name: 'A' }],
        assignments: {
          [dirty.repository.path]: 'group-a',
          [ahead.repository.path]: 'group-a',
          [clean.repository.path]: 'group-a',
        },
      }
      for (const invalid of [{ checkedAt: 0 }, { error: true }]) {
        const stale = { ...snap(0), unpushedCount: 0, ...invalid }
        const positive = { ...snap(5, 500), unpushedCount: 4, ...invalid }
        const result = project(
          [group('all', [dirty, ahead, clean])],
          new Map([
            [key(dirty.repository.path), stale],
            [key(ahead.repository.path), stale],
            [key(clean.repository.path), positive],
          ]),
          prefs(),
          'activity',
          organization
        )
        const working = result.find(g => g.identifier === '_Working_').items
        Assert.deepEqual(working.map(r => r.id).sort(), ['1', '2'])
        Assert.equal(working.find(r => r.id === '1').changedFilesCount, 3)
        Assert.deepEqual(working.find(r => r.id === '2').aheadBehind, {
          ahead: 2,
          behind: 0,
        })
        Assert.deepEqual(
          result.find(g => g.identifier === 'group-a').items.map(r => r.id),
          ['3']
        )
      }
    })
    test('name mode preserves original groups and pin order', () => {
      const z = row(2, 'zeta'), a = row(1, 'alpha')
      const result = project([group('pinned', [z]), group('owner', [a])], new Map(), prefs('name'), 'activity')
      Assert.deepEqual(result.map(g => g.identifier), ['pinned', 'owner'])
      Assert.deepEqual(ids(result), ['2', '1'])
    })
    test('dirty linked worktrees keep a clean parent; clean siblings are filtered', () => {
      const parent = row(1, 'repo', Path.resolve('fixture/main'), { type: 'main', path: Path.resolve('fixture/main') })
      const child = { ...parent, id: '1:child', worktree: { type: 'linked', path: Path.resolve('fixture/child') } }
      const clean = { ...parent, id: '1:clean', worktree: { type: 'linked', path: Path.resolve('fixture/clean') } }
      const data = new Map([[key(parent.worktree.path), snap(0)], [key(child.worktree.path), snap(1)], [key(clean.worktree.path), snap(0)]])
      Assert.deepEqual(ids(project([group('all', [parent, child, clean])], data, prefs('recent', true), 'activity')), ['1', '1:child'])
    })
    test('latest linked worktree activity determines the family position', () => {
      const a = row(1, 'alpha'), z = row(2, 'zeta')
      const child = { ...z, id: '2:child', worktree: { type: 'linked', path: Path.resolve('fixture/child') } }
      const data = new Map([[key(a.repository.path), snap(1, 100)], [key(z.repository.path), snap(0)], [key(child.worktree.path), snap(1, 900)]])
      Assert.deepEqual(ids(project([group('all', [a, z, child])], data, prefs(), 'activity')), ['2', '2:child', '1'])
    })
    test('scanner counts replace stale sidebar indicators', () => {
      const a = { ...row(1, 'a'), changedFilesCount: 9 }
      const result = project([group('all', [a])], new Map([[key(a.repository.path), snap(0)]]), prefs(), 'activity')
      Assert.equal(result[0].items[0].changedFilesCount, 0)
    })
    test('fuzzy-search results keep the requested activity ordering', () => {
      Assert.deepEqual(order([{ item: { id: 'a' } }, { item: { id: 'z' } }], ['z', 'a']).map(m => m.item.id), ['z', 'a'])
    })
    test('empty dirty results do not retain empty group headers', () => {
      const a = row(1, 'a')
      Assert.deepEqual(project([group('all', [a])], new Map([[key(a.repository.path), snap(0)]]), prefs('recent', true), 'activity'), [])
    })
    test('same names in different folders receive disambiguation', () => {
      const a = row(1, 'same', Path.resolve('one/same')), b = row(2, 'same', Path.resolve('two/same'))
      Assert.ok(project([group('all', [a, b])], new Map(), prefs(), 'activity')[0].items.every(r => r.needsDisambiguation))
    })
    test('preferences persist and malformed values have safe defaults', () => {
      const storage = memoryStorage()
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs())
      Prefs.saveActivityPreferences(storage, prefs('dirty-first', true))
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs('dirty-first', true))
      for (const k of storage.data.keys()) storage.setItem(k, 'broken')
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs())
    })
    test('restored snapshots are stale but retain their fingerprints and timestamps', () => {
      const storage = memoryStorage(), path = key('fixture/a')
      Prefs.saveActivityCache(storage, new Map([[path, snap(1)]]))
      const restored = Prefs.readActivityCache(storage).get(path)
      Assert.equal(restored.checkedAt, 0); Assert.equal(restored.lastChangedAt, 100)
      Assert.equal(restored.fingerprint, snap(1).fingerprint)
    })
    test('session snapshots reuse verified progress while disk fallbacks stay unverified', () => {
      const storage = memoryStorage()
      const path = key('fixture/session')
      const verified = { ...snap(1, 700), checkedAt: 700 }
      const progress = new Map([[path, verified]])

      Prefs.saveActivityCache(storage, progress)
      const persisted = Prefs.readActivityCache(storage)
      Assert.equal(persisted.get(path).checkedAt, 0)
      Assert.equal(
        Prefs.readActivitySessionCache(storage).get(path).checkedAt,
        0
      )

      Prefs.saveActivitySessionCache(storage, progress)
      const restored = Prefs.readActivitySessionCache(storage)
      Assert.equal(restored.get(path).checkedAt, 700)
      Assert.equal(restored.get(path).changedFilesCount, 1)
      Assert.equal(
        Prefs.readActivitySessionCache(memoryStorage()).size,
        0
      )
    })
    test('unavailable storage is optional, not fatal', () => {
      const storage = { getItem() { throw Error('denied') }, setItem() { throw Error('full') } }
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs())
      Assert.equal(Prefs.readActivityCache(storage).size, 0)
      Assert.doesNotThrow(() => Prefs.saveActivityCache(storage, new Map()))
      Assert.doesNotThrow(() => Prefs.saveActivityPreferences(storage, prefs()))
    })
    test('a missing repository is not reported as clean', async () => {
      let final
      const monitor = new Monitor(async path => { if (path.endsWith('bad')) throw Error('missing'); return snap(1) }, s => { final = s })
      monitor.setPaths([Path.resolve('good'), Path.resolve('bad')]); await monitor.refresh()
      Assert.equal(final.repositories.get(key('bad')).error, true)
      Assert.equal(final.repositories.get(key('good')).error, false)
      Assert.equal(final.completed, 2)
    })
    test('publishes immutable cumulative results as repositories complete', async () => {
      let unblock
      const gate = new Promise(resolve => { unblock = resolve })
      let firstCompletedResolve
      const firstCompleted = new Promise(resolve => { firstCompletedResolve = resolve })
      const first = Path.resolve('first')
      const second = Path.resolve('second')
      const events = []
      const monitor = new Monitor(async path => {
        if (path === second) await gate
        return snap(path === first ? 1 : 2, path === first ? 100 : 200)
      }, state => {
        events.push(state)
        if (state.checking && state.completed === 1) firstCompletedResolve(state)
      }, new Map(), 2)
      monitor.setPaths([first, second])
      const pending = monitor.refresh()
      const firstState = await Promise.race([
        firstCompleted,
        sleep(100).then(() => undefined),
      ])
      unblock()
      await pending
      Assert.ok(firstState, 'a completed repository should publish progress')
      Assert.equal(firstState.repositories.size, 1)
      Assert.equal(firstState.repositories.get(key(first)).changedFilesCount, 1)
      const final = events.find(state => !state.checking)
      Assert.equal(final.repositories.size, 2)
      Assert.equal(final.repositories.get(key(second)).changedFilesCount, 2)
      Assert.notEqual(firstState.repositories, final.repositories)
      Assert.equal(firstState.repositories.has(key(second)), false)
    })
    test('fresh successful snapshots are reused while stale, unknown, and failed paths refresh', async () => {
      const now = 20000
      const fresh = Path.resolve('fresh')
      const stale = Path.resolve('stale')
      const unknown = Path.resolve('unknown')
      const failed = Path.resolve('failed')
      const calls = []
      let final
      const initial = new Map([
        [key(fresh), { ...snap(1, 100), checkedAt: now - 1, error: false }],
        [key(stale), { ...snap(1, 100), checkedAt: now - 15000, error: false }],
        [key(unknown), { ...snap(1, 100), checkedAt: 0, error: false }],
        [key(failed), { ...snap(1, 100), checkedAt: now - 1, error: true }],
      ])
      const monitor = new Monitor(async path => {
        calls.push(path)
        if (path === failed) throw Error('still unavailable')
        return snap(2, now)
      }, state => {
        if (!state.checking) final = state
      }, initial, 2, () => now)

      monitor.setPaths([fresh, stale, unknown, failed])
      await monitor.refresh({ maxAge: 15000 })

      Assert.equal(calls.includes(fresh), false)
      Assert.deepEqual(new Set(calls), new Set([stale, unknown, failed]))
      Assert.equal(final.repositories.get(key(fresh)).checkedAt, now - 1)
      Assert.equal(final.repositories.get(key(stale)).checkedAt, now)
      Assert.equal(final.repositories.get(key(unknown)).checkedAt, now)
      Assert.equal(final.repositories.get(key(failed)).error, true)
    })
    test('fresh cache entries survive path additions while removed entries are pruned', async () => {
      const now = 30000
      const keep = Path.resolve('keep')
      const removed = Path.resolve('removed')
      const added = Path.resolve('added')
      const calls = []
      let final
      const initial = new Map([
        [key(keep), { ...snap(1), checkedAt: now - 1, error: false }],
        [key(removed), { ...snap(1), checkedAt: now - 1, error: false }],
      ])
      const monitor = new Monitor(async path => {
        calls.push(path)
        return snap(1, now)
      }, state => {
        if (!state.checking) final = state
      }, initial, 2, () => now)

      monitor.setPaths([keep, removed])
      await monitor.refresh({ maxAge: 15000 })
      monitor.setPaths([keep, added])
      await monitor.refresh({ maxAge: 15000 })

      Assert.deepEqual(calls, [added])
      Assert.deepEqual([...final.repositories.keys()], [key(keep), key(added)])
      Assert.equal(final.repositories.get(key(keep)).checkedAt, now - 1)
    })
    test('scans are coalesced, deduplicated, and concurrency-limited', async () => {
      let active = 0, peak = 0, calls = 0
      const monitor = new Monitor(async () => { calls++; active++; peak = Math.max(peak, active); await sleep(5); active--; return snap(1) }, () => {})
      monitor.setPaths([1, 2, 3, 4, 1].map(n => Path.resolve(`fixture/${n}`)))
      const first = monitor.refresh(); const second = monitor.refresh()
      Assert.equal(first, second); await first
      Assert.equal(calls, 4); Assert.equal(peak, 2)
    })
    test('stop drops queued jobs and suppresses late UI updates', async () => {
      let unblock, startedResolve, calls = 0, updates = 0
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      const monitor = new Monitor(async () => { calls++; startedResolve(); await gate; return snap(1) }, () => { updates++ }, new Map(), 1)
      monitor.setPaths([Path.resolve('a'), Path.resolve('b')])
      const pending = monitor.refresh(); await started
      monitor.stop(); const count = updates; unblock(); await pending
      Assert.equal(updates, count); Assert.equal(calls, 1)
    })
    test('changing the repository set invalidates stale queued work', async () => {
      let unblock, startedResolve, final
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      const calls = []
      const monitor = new Monitor(async path => { calls.push(Path.basename(path)); if (path.endsWith('old')) { startedResolve(); await gate } return snap(1) }, s => { final = s }, new Map(), 1)
      monitor.setPaths([Path.resolve('old'), Path.resolve('removed')])
      const pending = monitor.refresh(); await started
      monitor.setPaths([Path.resolve('new')]); unblock(); await pending
      Assert.deepEqual(calls, ['old', 'new'])
      Assert.deepEqual([...final.repositories.keys()], [key('new')])
    })
    test('polling unchanged repositories never advances their recency', async () => {
      let final, clock = 1000
      const monitor = new Monitor(async () => snap(1, 100), s => { final = s }, new Map(), 2, () => clock)
      monitor.setPaths([Path.resolve('a')]); await monitor.refresh()
      clock = 2000; await monitor.refresh()
      Assert.equal(final.repositories.get(key('a')).lastChangedAt, 100)
    })
    test('invalid scan concurrency is rejected', () => {
      for (const limit of [0, -1, 9, 1.5]) Assert.throws(() => new Monitor(async () => snap(0), () => {}, new Map(), limit))
    })
    test('source includes the bundled-Git timeout, buffer cap and no-optional-locks', async () => {
      const source = await Fs.readFile(Path.join(root, 'app/src/lib/git/repository-activity.ts'), 'utf8')
      Assert.match(source, /--no-optional-locks/)
      Assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/)
      Assert.match(source, /signal:\s*controller\.signal/)
      Assert.match(source, /clearTimeout\(timeout\)/)
      Assert.match(source, /maxBuffer:/)
      Assert.match(source, /from ['"]\.\/core['"]/)
    })

    test('first successful scan after an initial failure uses file evidence', () => {
      const failed = { ...snap(0), error: true, fingerprint: '' }
      Assert.equal(advance(failed, snap(1, 100), 5000).lastChangedAt, 100)
    })
    test('offline edits are ordered by mtime rather than scan completion order', () => {
      const before = { ...snap(1, 100), checkedAt: 200 }
      const changed = { ...snap(1, 300, 'b'.repeat(64)) }
      Assert.equal(advance(before, changed, 9999).lastChangedAt, 300)
    })
    test('staging or timestamp-preserving changes use observation time', () => {
      const before = { ...snap(1, 100), checkedAt: 200 }
      Assert.equal(advance(before, snap(1, 100, 'b'.repeat(64)), 9999).lastChangedAt, 9999)
    })
    test('an empty repository list prunes an old persisted cache', async () => {
      let final
      const monitor = new Monitor(async () => snap(1), s => { final = s }, new Map([[key('old'), snap(1)]]))
      monitor.setPaths([]); await monitor.refresh()
      Assert.equal(final.repositories.size, 0)
    })
    test('an ignored build output does not alter an existing dirty fingerprint', () => withRepo(async path => {
      await Fs.appendFile(Path.join(path, 'file.txt'), 'edit')
      const before = await sample(path, status)
      await Fs.mkdir(Path.join(path, 'ignored'))
      await Fs.writeFile(Path.join(path, 'ignored/cache'), 'new output')
      Assert.equal((await sample(path, status)).fingerprint, before.fingerprint)
    }))

    let failures = 0
    for (const item of tests) {
      try { await item.run(); console.log(`PASS ${item.name}`) }
      catch (error) { failures++; console.error(`FAIL ${item.name}\n${error.stack}`) }
    }
    console.log(`\n${tests.length - failures}/${tests.length} tests passed.`)
    if (failures) process.exitCode = 1
  } finally { await Fs.rm(compiled, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
