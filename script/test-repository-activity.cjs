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
