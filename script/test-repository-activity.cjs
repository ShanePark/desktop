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
    const { projectActivityGroups: project, preserveActivityOrder: order, savedItemId, activityScanPriority: scanPriority } = require(Path.join(compiled, 'list.js'))
    const Org = require(Path.join(compiled, 'organization.js'))
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
    const prefs = (sort = 'recent') => ({ sort })
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
    test('files added and then deleted from the working tree are excluded', () => Assert.equal(parse('AD gone\0A  kept\0').length, 1))
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
    test('a real file added to the index and then deleted is clean like Changes', () => withRepo(async path => {
      await Fs.writeFile(Path.join(path, 'checklist.md'), 'temporary')
      git(path, ['add', 'checklist.md'])
      await Fs.rm(Path.join(path, 'checklist.md'))
      Assert.equal((await sample(path, status)).changedFilesCount, 0)
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
    test('clean, dirty, unknown and failed rows are all listed without a status filter', () => {
      const clean = row(1, 'clean'), dirty = row(2, 'dirty'), unknown = row(3, 'unknown'), failed = row(4, 'failed')
      const data = new Map([[key(clean.repository.path), snap(0)], [key(dirty.repository.path), snap(1)], [key(failed.repository.path), { ...snap(0), error: true }]])
      const actual = ids(project([group('all', [clean, dirty, unknown, failed])], data, { sort: 'recent', onlyUncommitted: true }, 'activity'))
      Assert.deepEqual(new Set(actual), new Set(['1', '2', '3', '4']))
    })
    const working = (rows, data) => {
      const organization = {
        groups: [{ id: 'group-a', name: 'A' }],
        assignments: Object.fromEntries(rows.map(r => [r.repository.path, 'group-a'])),
      }
      const result = project([group('all', rows)], data, prefs(), 'activity', organization)
      return {
        working: result.find(g => g.identifier === '_Working_').items,
        saved: result.find(g => g.identifier === 'group-a').items.map(r => r.id),
      }
    }
    test('unverified or failed snapshots keep last known Working membership over row indicators', () => {
      const dirty = { ...row(1, 'dirty'), aheadBehind: { ahead: 0, behind: 1 } }
      const ahead = row(2, 'ahead')
      const clean = { ...row(3, 'clean'), changedFilesCount: 3, aheadBehind: { ahead: 2, behind: 0 } }
      for (const invalid of [{ checkedAt: 0 }, { error: true }]) {
        const result = working([dirty, ahead, clean], new Map([
          [key(dirty.repository.path), { ...snap(5, 500), unpushedCount: 0, ...invalid }],
          [key(ahead.repository.path), { ...snap(0), unpushedCount: 4, ...invalid }],
          [key(clean.repository.path), { ...snap(0), unpushedCount: 0, ...invalid }],
        ]))
        Assert.deepEqual(result.working.map(r => r.id).sort(), ['1', '2'])
        Assert.equal(result.working.find(r => r.id === '1').changedFilesCount, 5)
        Assert.deepEqual(result.working.find(r => r.id === '2').aheadBehind, { ahead: 4, behind: 0 })
        Assert.equal(result.working.find(r => r.id === '1').workingGroupName, 'A')
        Assert.deepEqual(result.saved, ['3'])
      }
    })
    test('rows without snapshot data fall back to row indicators', () => {
      const dirty = { ...row(1, 'dirty'), changedFilesCount: 3 }
      const ahead = { ...row(2, 'ahead'), aheadBehind: { ahead: 2, behind: 0 } }
      const clean = { ...row(3, 'clean'), aheadBehind: { ahead: 0, behind: 0 } }
      // A failed first check has no earlier baseline to preserve.
      const failed = { ...snap(0), fingerprint: '', checkedAt: 1000, error: true }
      const result = working([dirty, ahead, clean], new Map([[key(ahead.repository.path), failed]]))
      Assert.deepEqual(result.working.map(r => r.id).sort(), ['1', '2'])
      Assert.equal(result.working.find(r => r.id === '1').changedFilesCount, 3)
      Assert.deepEqual(result.working.find(r => r.id === '2').aheadBehind, { ahead: 2, behind: 0 })
      Assert.deepEqual(result.saved, ['3'])
    })
    test('a successful clean recheck removes a restored row from Working', async () => {
      const restored = { ...row(1, 'restored'), aheadBehind: { ahead: 0, behind: 0 } }
      const path = restored.repository.path
      const initial = new Map([[key(path), { ...snap(2, 100), unpushedCount: 1, checkedAt: 0 }]])
      Assert.deepEqual(working([restored], initial).working.map(r => r.id), ['1'])
      let final
      const monitor = new Monitor(async () => ({ ...snap(0), unpushedCount: 0 }), s => { final = s }, initial, 2, () => 2000)
      monitor.setPaths([path]); await monitor.refresh()
      Assert.equal(final.repositories.get(key(path)).checkedAt, 2000)
      const result = working([restored], final.repositories)
      Assert.deepEqual(result.working, [])
      Assert.deepEqual(result.saved, ['1'])
    })
    const projectedRow = (rows, data, id) =>
      project([group('all', rows)], data, prefs(), 'activity', {
        groups: [{ id: 'group-a', name: 'A' }],
        assignments: Object.fromEntries(rows.map(r => [r.repository.path, 'group-a'])),
      }).flatMap(g => g.items).find(r => r.id === id)
    test('a newer clean indicator removes restored or older snapshots from Working', () => {
      // After an in-app commit and push, the app store observes a clean state.
      const committed = { ...row(1, 'committed'), aheadBehind: { ahead: 0, behind: 2 }, indicatorObservedAt: 1500 }
      for (const stale of [{ checkedAt: 0 }, { checkedAt: 1000 }, { checkedAt: 1000, error: true }]) {
        const data = new Map([[key(committed.repository.path), { ...snap(3, 500), unpushedCount: 2, ...stale }]])
        const result = working([committed], data)
        Assert.deepEqual(result.working, [])
        Assert.deepEqual(result.saved, ['1'])
        const projected = projectedRow([committed], data, '1')
        Assert.equal(projected.changedFilesCount, 0)
        Assert.deepEqual(projected.aheadBehind, { ahead: 0, behind: 2 })
      }
    })
    test('a newer dirty indicator moves a clean snapshot into Working', () => {
      const discarded = { ...row(1, 'edited'), changedFilesCount: 2, aheadBehind: { ahead: 0, behind: 0 }, indicatorObservedAt: 1500 }
      const result = working([discarded], new Map([[key(discarded.repository.path), { ...snap(0), unpushedCount: 0 }]]))
      Assert.deepEqual(result.working.map(r => [r.id, r.changedFilesCount]), [['1', 2]])
    })
    test('a failed check does not hide a newer dirty indicator', async () => {
      // The app store saw edits at 1000; the last successful check (500) was clean.
      const edited = { ...row(1, 'edited'), changedFilesCount: 2, aheadBehind: { ahead: 0, behind: 0 }, indicatorObservedAt: 1000 }
      const path = edited.repository.path
      const initial = new Map([[key(path), { ...snap(0), unpushedCount: 0, checkedAt: 500 }]])
      let final
      const monitor = new Monitor(async () => { throw Error('timeout') }, s => { final = s }, initial, 2, () => 1100)
      monitor.setPaths([path]); await monitor.refresh()
      const failed = final.repositories.get(key(path))
      Assert.equal(failed.error, true)
      Assert.equal(failed.checkedAt, 500)
      Assert.equal(failed.changedFilesCount, 0)
      Assert.deepEqual(working([edited], final.repositories).working.map(r => [r.id, r.changedFilesCount]), [['1', 2]])
    })
    test('scans check the selected repository, then Working, then by activity, then unknown', async () => {
      const [unknownA, older, selected, dirty, newer, unknownB, ahead] =
        ['unknown-a', 'older', 'selected', 'dirty', 'newer', 'unknown-b', 'ahead'].map((name, i) => row(i + 1, name))
      const rows = [unknownA, older, selected, dirty, newer, unknownB, ahead]
      const data = new Map([
        [key(older.repository.path), { ...snap(0), lastCommitAt: 200 }],
        [key(selected.repository.path), { ...snap(0), lastCommitAt: 100 }],
        [key(dirty.repository.path), snap(1, 300)],
        [key(newer.repository.path), { ...snap(0), lastCommitAt: 900 }],
        [key(ahead.repository.path), { ...snap(0), unpushedCount: 1, lastCommitAt: 400 }],
      ])
      const projected = project([group('all', rows)], data, prefs('name'), 'activity', { groups: [], assignments: {} })
      const priority = scanPriority(projected, data, selected.repository.path)
      const checked = []
      const monitor = new Monitor(async path => { checked.push(Path.basename(path)); return snap(0) }, () => {}, new Map(), 1)
      monitor.setPaths(rows.map(r => r.repository.path))
      monitor.setPriority(() => [Path.resolve('unregistered'), ...priority])
      await monitor.refresh()
      Assert.deepEqual(checked, ['selected', 'ahead', 'dirty', 'newer', 'older', 'unknown-a', 'unknown-b'])
      // Every pass reads the priority again.
      checked.length = 0
      monitor.setPriority(() => [unknownB.repository.path])
      await monitor.refresh()
      Assert.deepEqual(checked, ['unknown-b', 'unknown-a', 'older', 'selected', 'dirty', 'newer', 'ahead'])
    })
    test('an older indicator loses to a newer successful snapshot', () => {
      const stale = { ...row(1, 'stale'), changedFilesCount: 0, aheadBehind: { ahead: 0, behind: 0 }, indicatorObservedAt: 900 }
      const data = new Map([[key(stale.repository.path), { ...snap(4, 500), unpushedCount: 1 }]])
      const result = working([stale], data)
      Assert.deepEqual(result.working.map(r => r.id), ['1'])
      Assert.equal(result.working[0].changedFilesCount, 4)
      Assert.deepEqual(result.working[0].aheadBehind, { ahead: 1, behind: 0 })
    })
    test('a newer indicator without upstream keeps the snapshot unpushed count', () => {
      const local = { ...row(1, 'local'), aheadBehind: null, indicatorObservedAt: 1500 }
      const data = new Map([[key(local.repository.path), { ...snap(3, 500), unpushedCount: 2, checkedAt: 0 }]])
      const result = working([local], data)
      Assert.deepEqual(result.working.map(r => r.id), ['1'])
      Assert.equal(result.working[0].changedFilesCount, 0)
      Assert.deepEqual(result.working[0].aheadBehind, { ahead: 2, behind: 0 })
    })
    test('without an indicator observation the last known snapshot is kept', () => {
      const restored = { ...row(1, 'restored'), aheadBehind: { ahead: 0, behind: 0 } }
      const data = new Map([[key(restored.repository.path), { ...snap(3, 500), unpushedCount: 0, checkedAt: 0 }]])
      Assert.deepEqual(working([restored], data).working.map(r => [r.id, r.changedFilesCount]), [['1', 3]])
    })
    test('repository indicators do not override linked worktree snapshots', () => {
      const parent = { ...row(1, 'repo', Path.resolve('fixture/main'), { type: 'main', path: Path.resolve('fixture/main') }), indicatorObservedAt: 1500 }
      const child = { ...parent, id: '1:child', worktree: { type: 'linked', path: Path.resolve('fixture/child') } }
      const data = new Map([[key(parent.worktree.path), snap(1)], [key(child.worktree.path), snap(1)]])
      const result = project([group('all', [parent, child])], data, prefs(), 'activity')[0].items
      Assert.deepEqual(result.map(r => [r.id, r.changedFilesCount]), [['1', 0], ['1:child', 1]])
    })
    test('name mode preserves original groups and pin order', () => {
      const z = row(2, 'zeta'), a = row(1, 'alpha')
      const result = project([group('pinned', [z]), group('owner', [a])], new Map(), prefs('name'), 'activity')
      Assert.deepEqual(result.map(g => g.identifier), ['pinned', 'owner'])
      Assert.deepEqual(ids(result), ['2', '1'])
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
    test('same names in different folders receive disambiguation', () => {
      const a = row(1, 'same', Path.resolve('one/same')), b = row(2, 'same', Path.resolve('two/same'))
      Assert.ok(project([group('all', [a, b])], new Map(), prefs(), 'activity')[0].items.every(r => r.needsDisambiguation))
    })
    test('preferences persist and malformed values have safe defaults', () => {
      const storage = memoryStorage()
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs())
      Prefs.saveActivityPreferences(storage, prefs('dirty-first'))
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs('dirty-first'))
      for (const k of storage.data.keys()) storage.setItem(k, 'broken')
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs())
    })
    test('a stale stored Uncommitted only preference is ignored', () => {
      const storage = memoryStorage()
      storage.setItem('desktop.repository-activity.preferences.v1', JSON.stringify({ sort: 'name', onlyUncommitted: true }))
      Assert.deepEqual(Prefs.readActivityPreferences(storage), prefs('name'))
    })
    // Recent: clean repositories ordered by their latest edit or commit time.
    const recentFixture = () => {
      const rows = Array.from({ length: 9 }, (_, i) => row(i + 1, `repo-${String.fromCharCode(105 - i)}`))
      const data = new Map(rows.map((r, i) => [key(r.repository.path), { ...snap(0), unpushedCount: 0, lastCommitAt: (i + 1) * 100 }]))
      // Newest of all, but active: Working only.
      data.set(key(rows[8].repository.path), { ...snap(2, 5000), unpushedCount: 0 })
      data.set(key(rows[7].repository.path), { ...snap(0), unpushedCount: 1, lastCommitAt: 4000 })
      // No known activity time: never Recent.
      data.set(key(rows[0].repository.path), { ...snap(0), unpushedCount: 0 })
      // A local edit newer than its commit counts.
      data.set(key(rows[1].repository.path), { ...snap(0), unpushedCount: 0, lastChangedAt: 3000, lastCommitAt: 200 })
      const organization = {
        groups: [{ id: 'group-a', name: 'A' }],
        assignments: Object.fromEntries(rows.slice(0, 4).map(r => [r.repository.path, 'group-a'])),
      }
      return { rows, data, organization }
    }
    const section = (result, id) => result.find(g => g.identifier === id).items
    test('Recent lists the three newest repositories outside Working regardless of sort', () => {
      const { rows, data, organization } = recentFixture()
      for (const sort of ['recent', 'dirty-first', 'name']) {
        const result = project([group('all', rows)], data, prefs(sort), 'activity', organization)
        Assert.deepEqual(result.map(g => g.identifier), [Org.WorkingGroup, Org.RecentGroup, 'group-a', Org.Ungrouped], sort)
        Assert.deepEqual(new Set(section(result, Org.WorkingGroup).map(r => r.id)), new Set(['8', '9']), sort)
        Assert.deepEqual(section(result, Org.RecentGroup).map(r => r.id), ['recent:2', 'recent:7', 'recent:6'], sort)
      }
    })
    test('Recent fills Working and Recent to five but keeps at least three', () => {
      const { rows, data, organization } = recentFixture()
      const recentIds = () => section(project([group('all', rows)], data, prefs(), 'activity', organization), Org.RecentGroup).map(r => r.id)
      data.set(key(rows[8].repository.path), { ...snap(0), unpushedCount: 0, lastCommitAt: 5000 })
      data.set(key(rows[7].repository.path), { ...snap(0), unpushedCount: 0, lastCommitAt: 4000 })
      Assert.deepEqual(recentIds(), ['recent:9', 'recent:8', 'recent:2', 'recent:7', 'recent:6'])
      data.set(key(rows[8].repository.path), { ...snap(2, 5000), unpushedCount: 0 })
      Assert.deepEqual(recentIds(), ['recent:8', 'recent:2', 'recent:7', 'recent:6'])
      for (const i of [7, 6, 5]) data.set(key(rows[i].repository.path), { ...snap(1, 900), unpushedCount: 0 })
      Assert.deepEqual(recentIds(), ['recent:2', 'recent:5', 'recent:4'])
    })
    test('Recent rows duplicate saved rows with distinct ids and saved group tags', () => {
      const { rows, data, organization } = recentFixture()
      const result = project([group('all', rows)], data, prefs('name'), 'activity', organization)
      const recent = section(result, Org.RecentGroup)
      Assert.deepEqual(section(result, 'group-a').map(r => r.id), ['4', '3', '2', '1'])
      Assert.deepEqual(section(result, Org.Ungrouped).map(r => r.id), ['7', '6', '5'])
      Assert.deepEqual(recent.map(r => r.recentGroupName), ['A', 'Ungrouped', 'Ungrouped'])
      Assert.ok(recent.every(r => r.workingGroupName === undefined))
      Assert.equal(recent[0].repository, rows[1].repository)
      Assert.deepEqual(recent.map(r => savedItemId(r.id)), ['2', '7', '6'])
      Assert.equal(savedItemId('2'), '2')
      Assert.equal(new Set(result.flatMap(g => g.items.map(r => r.id))).size, result.flatMap(g => g.items).length)
    })
    test('Recent excludes rows without a known activity time and leaves Working membership unchanged', () => {
      const a = row(1, 'a'), b = row(2, 'b')
      const data = new Map([[key(a.repository.path), { ...snap(0), unpushedCount: 0 }], [key(b.repository.path), { ...snap(1, 900), unpushedCount: 0 }]])
      const result = project([group('all', [a, b])], data, prefs(), 'activity', { groups: [], assignments: {} })
      Assert.deepEqual(result.map(g => g.identifier), [Org.WorkingGroup, Org.RecentGroup, Org.Ungrouped])
      Assert.deepEqual(section(result, Org.WorkingGroup).map(r => r.id), ['2'])
      Assert.deepEqual(section(result, Org.RecentGroup), [])
      Assert.deepEqual(section(result, Org.Ungrouped).map(r => r.id), ['1'])
    })
    test('Recent is a reserved, non-collapsible derived section like Working', () => {
      const organization = { groups: [{ id: 'group-a', name: 'A' }], assignments: {} }
      for (const name of ['Recent', ' RECENT ', 'Working', 'ungrouped']) {
        Assert.match(Org.validateRepositoryGroupName(organization, name), /reserved/)
      }
      Assert.ok(Org.isDerivedGroup(Org.WorkingGroup) && Org.isDerivedGroup(Org.RecentGroup))
      Assert.ok(!Org.isDerivedGroup(Org.Ungrouped) && !Org.isDerivedGroup('group-a'))
      for (const id of [Org.WorkingGroup, Org.RecentGroup]) {
        Assert.equal(Org.toggleRepositoryGroup(organization, id), organization)
        Assert.equal(Org.assignRepository(organization, '/fixture/a', id), organization)
      }
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
    test('a dirty result appears in Working before the rest of the pass finishes', async () => {
      const rows = ['edited', 'slow-1', 'slow-2', 'slow-3', 'slow-4', 'queued'].map((name, i) => row(i + 1, name))
      let unblock
      const gate = new Promise(resolve => { unblock = resolve })
      let publishedResolve
      const published = new Promise(resolve => { publishedResolve = resolve })
      const monitor = new Monitor(async path => {
        if (path !== rows[0].repository.path) await gate
        return snap(path === rows[0].repository.path ? 1 : 0)
      }, state => {
        if (state.checking && state.repositories.size > 0) publishedResolve(state)
      })
      monitor.setPaths(rows.map(r => r.repository.path))
      const pending = monitor.refresh()
      const interim = await Promise.race([published, sleep(100).then(() => undefined)])
      unblock(); await pending
      Assert.ok(interim, 'a completed dirty check should publish before the pass ends')
      Assert.equal(interim.completed, 1)
      Assert.deepEqual(working(rows, interim.repositories).working.map(r => r.id), ['1'])
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
      monitor.setPaths([1, 2, 3, 4, 5, 6, 1].map(n => Path.resolve(`fixture/${n}`)))
      const first = monitor.refresh(); const second = monitor.refresh(); const third = monitor.refresh()
      Assert.notEqual(first, second); Assert.equal(second, third)
      await first
      Assert.equal(calls, 6)
      await second
      Assert.equal(calls, 12); Assert.equal(peak, 4)
    })
    test('requests during a pass run one follow-up with the strictest window', async () => {
      let clock = 50000
      const recent = Path.resolve('recent')
      const older = Path.resolve('older')
      let unblock, startedResolve
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      const calls = []
      const monitor = new Monitor(async path => {
        calls.push(path)
        if (calls.length === 1) { startedResolve(); await gate }
        return snap(1)
      }, s => {
        // Results from the first pass are 5s old when the follow-up starts.
        if (!s.checking) clock += 5000
      }, new Map(), 1, () => clock)
      monitor.setPaths([recent, older])
      const pending = monitor.refresh(); await started
      const loose = monitor.refresh({ maxAge: 15000 })
      const strict = monitor.refresh({ maxAge: 3000 })
      Assert.equal(loose, strict)
      unblock(); await pending
      Assert.deepEqual(calls, [recent, older])
      await strict
      Assert.deepEqual(calls, [recent, older, recent, older])
    })
    test('a stopped monitor does not run a queued follow-up pass', async () => {
      let unblock, startedResolve, calls = 0
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      const monitor = new Monitor(async () => { calls++; startedResolve(); await gate; return snap(1) }, () => {}, new Map(), 1)
      monitor.setPaths([Path.resolve('a')])
      const pending = monitor.refresh(); await started
      const followUp = monitor.refresh()
      monitor.stop(); unblock(); await pending; await followUp
      Assert.equal(calls, 1)
    })
    test('invalidated paths are rechecked despite a fresh snapshot', async () => {
      const now = 60000
      const changed = Path.resolve('changed')
      const unchanged = Path.resolve('unchanged')
      const calls = []
      const initial = new Map([
        [key(changed), { ...snap(1), checkedAt: now - 1 }],
        [key(unchanged), { ...snap(1), checkedAt: now - 1 }],
      ])
      const monitor = new Monitor(async path => { calls.push(path); return { ...snap(0), checkedAt: now } }, () => {}, initial, 2, () => now)
      monitor.setPaths([changed, unchanged])
      monitor.invalidate([changed, Path.resolve('unregistered')])
      await monitor.refresh({ maxAge: 15000 })
      Assert.deepEqual(calls, [changed])
      // The completed sample satisfies the invalidation.
      await monitor.refresh({ maxAge: 15000 })
      Assert.deepEqual(calls, [changed])
    })
    test('a sample started before invalidation does not satisfy it', async () => {
      const now = 70000
      const path = Path.resolve('in-flight')
      let unblock, startedResolve
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      let calls = 0
      let final
      const monitor = new Monitor(async () => {
        calls++
        if (calls === 1) { startedResolve(); await gate; return snap(2) }
        return snap(0)
      }, s => { if (!s.checking) final = s }, new Map(), 1, () => now)
      monitor.setPaths([path])
      const pending = monitor.refresh(); await started
      monitor.invalidate([path])
      unblock(); await pending
      Assert.equal(calls, 1)
      // The pre-invalidation result is not considered fresh.
      await monitor.refresh({ maxAge: 15000 })
      Assert.equal(calls, 2)
      Assert.equal(final.repositories.get(key(path)).changedFilesCount, 0)
      await monitor.refresh({ maxAge: 15000 })
      Assert.equal(calls, 2)
    })
    test('invalidation during a pass is resolved by its follow-up pass', async () => {
      const path = Path.resolve('committed')
      let unblock, startedResolve
      const started = new Promise(resolve => { startedResolve = resolve })
      const gate = new Promise(resolve => { unblock = resolve })
      let calls = 0
      let final
      const monitor = new Monitor(async () => {
        calls++
        if (calls === 1) { startedResolve(); await gate; return snap(2) }
        return snap(0)
      }, s => { if (!s.checking) final = s }, new Map(), 1, () => 80000)
      monitor.setPaths([path])
      const pending = monitor.refresh(); await started
      monitor.invalidate([path])
      const followUp = monitor.refresh({ maxAge: 15000 })
      unblock(); await pending; await followUp
      Assert.equal(calls, 2)
      Assert.equal(final.repositories.get(key(path)).changedFilesCount, 0)
    })
    test('the tick window rechecks the previous tick but reuses a forced check', async () => {
      const now = 90000
      const previousTick = Path.resolve('previous-tick')
      const forced = Path.resolve('forced')
      const calls = []
      const initial = new Map([
        [key(previousTick), { ...snap(1), checkedAt: now - 14000 }],
        [key(forced), { ...snap(1), checkedAt: now - 2000 }],
      ])
      const monitor = new Monitor(async path => { calls.push(path); return snap(1) }, () => {}, initial, 1, () => now)
      monitor.setPaths([previousTick, forced])
      await monitor.refresh({ maxAge: 7500 })
      Assert.deepEqual(calls, [previousTick])
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
    test('unchanged polls only publish lifecycle events and retain freshness', async () => {
      let final, clock = 1000
      const events = []
      const monitor = new Monitor(async () => snap(1, 100), s => { final = s; events.push(s) }, new Map(), 2, () => clock)
      monitor.setPaths([Path.resolve('a')]); await monitor.refresh()
      events.length = 0
      clock = 2000; await monitor.refresh()
      Assert.equal(final.repositories.get(key('a')).lastChangedAt, 100)
      Assert.deepEqual(events.map(event => [event.checking, event.completed]), [
        [true, 0], [false, 1],
      ])
      Assert.equal(final.repositories.get(key('a')).checkedAt, 2000)
    })
    test('only changed repository completions publish intermediate snapshots', async () => {
      const unchanged = Path.resolve('unchanged')
      const changed = Path.resolve('changed')
      const initial = new Map([
        [key(unchanged), snap(1, 100)],
        [key(changed), snap(1, 100)],
      ])
      const events = []
      const monitor = new Monitor(
        async path => path === unchanged ? snap(1, 100) : snap(2, 200),
        state => events.push(state),
        initial,
        1,
        () => 2000
      )
      monitor.setPaths([unchanged, changed]); await monitor.refresh()
      Assert.deepEqual(events.map(event => [event.checking, event.completed]), [
        [true, 0], [true, 2], [false, 2],
      ])
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
