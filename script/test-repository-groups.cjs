/* Real local Git fixtures; no network or changes to registered repositories. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const loaded = new Map()
function load(file) {
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = new Module(file, module)
  loaded.set(file, mod)
  mod.require = name => {
    if (name === './core') return { git: async (args, cwd, _name, options) => {
      try { return { stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), exitCode: 0 } }
      catch (error) {
        if (options.successExitCodes?.has(error.status)) return { stdout: error.stdout, exitCode: error.status }
        throw error
      }
    } }
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)
  }
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file)
  return mod.exports
}
const { readRepositoryActivity } = load(path.join(root, 'app/src/lib/git/repository-activity.ts'))
const { advanceActivity } = load(path.join(root, 'app/src/lib/repository-activity/status.ts'))
const { projectActivityGroups } = load(path.join(root, 'app/src/lib/repository-activity/list.ts'))
const Org = load(path.join(root, 'app/src/lib/repository-activity/organization.ts'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-groups-'))
const repo = path.join(tmp, 'repo')
const remote = path.join(tmp, 'remote.git')
const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
let passed = 0
async function test(name, run) { await run(); passed++; console.log('PASS ' + name) }
async function main() {
  fs.mkdirSync(repo)
  git('init', '--initial-branch=main')
  let committed
  await test('empty repository has no commit and no unpublished commits', async () => {
    const sample = await readRepositoryActivity(repo)
    assert.equal(sample.lastCommitAt, null)
    assert.equal(sample.unpushedCount, 0)
  })
  await test('clean repository with a new commit retains recent activity and is Working before push', async () => {
    fs.writeFileSync(path.join(repo, 'file'), 'one')
    git('add', '.'); git('commit', '-m', 'first')
    committed = await readRepositoryActivity(repo)
    assert.equal(committed.changedFilesCount, 0)
    assert.equal(committed.unpushedCount, 1)
    assert.equal(committed.lastCommitAt, Number(git('log', '-1', '--format=%ct').trim()) * 1000)
    assert.equal(advanceActivity(undefined, committed, Date.now()).lastChangedAt, committed.lastCommitAt)
  })
  await test('pushing removes Working status without losing commit recency', async () => {
    git('init', '--bare', remote); git('remote', 'add', 'origin', remote)
    git('push', '-u', 'origin', 'main')
    const sample = await readRepositoryActivity(repo)
    assert.equal(sample.unpushedCount, 0)
    assert.equal(sample.lastCommitAt, committed.lastCommitAt)
  })
  await test('only the checked-out branch contributes unpublished commits', async () => {
    git('checkout', '-b', 'topic')
    fs.writeFileSync(path.join(repo, 'file'), 'two'); git('commit', '-am', 'topic')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 1)
    git('checkout', 'main')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 0)
    git('push', 'origin', 'topic')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 0)
  })
  await test('configured upstream determines ahead count even when another remote branch contains HEAD', async () => {
    git('checkout', 'topic')
    git('branch', '--set-upstream-to=origin/main')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 1)
    git('branch', '--set-upstream-to=origin/topic')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 0)
    git('checkout', 'main')
  })
  await test('detached HEAD commits are included', async () => {
    git('checkout', '--detach')
    fs.writeFileSync(path.join(repo, 'file'), 'detached'); git('commit', '-am', 'detached')
    assert.equal((await readRepositoryActivity(repo)).unpushedCount, 1)
    git('checkout', 'main')
  })
  await test('Working wins over assignments; unsorted custom repositories default to name order', () => {
    const rows = ['z-new', 'a-old', 'dirty', 'unpushed'].map((name, i) => ({
      id: String(i), repository: { id: i, path: path.join(tmp, name), name }, text: [name], changedFilesCount: 0, needsDisambiguation: false,
    }))
    const activities = new Map(rows.map((r, i) => [r.repository.path, {
      ...committed, unpushedCount: i === 3 ? 1 : 0, changedFilesCount: i === 2 ? 1 : 0,
      lastCommitAt: i === 0 ? 200 : 100, lastChangedAt: null, error: false, checkedAt: 1000,
    }]))
    const organization = { groups: [{ id: 'group-personal', name: 'Personal' }], assignments: Object.fromEntries(rows.map(r => [r.repository.path, 'group-personal'])) }
    const projected = projectActivityGroups([{ identifier: 'old', items: rows }], activities, { sort: 'recent', onlyUncommitted: false }, 'activity', organization)
    assert.deepEqual(projected.map(g => g.identifier), [Org.WorkingGroup, 'group-personal', Org.Ungrouped])
    assert.deepEqual(projected[0].items.map(r => r.id), ['2', '3'])
    assert.deepEqual(projected[1].items.map(r => r.id), ['1', '0'])
    const filtered = projectActivityGroups([{ identifier: 'old', items: rows }], activities, { sort: 'recent', onlyUncommitted: true }, 'activity', organization)
    assert.deepEqual(filtered.flatMap(g => g.items.map(r => r.id)), ['2'])
  })
  await test('manual order survives Working transitions, sort changes and reload', () => {
    const row = (id, name) => ({ id: String(id), repository: { id, name, path: '/fixture/' + name }, text: [name], changedFilesCount: 0, needsDisambiguation: false })
    const rows = [row(1, 'alpha'), row(2, 'beta'), row(3, 'gamma')]
    let org = { groups: [{ id: 'group-a', name: 'A' }], assignments: Object.fromEntries(rows.map(r => [r.repository.path, 'group-a'])), collapsed: ['group-a'] }
    org = Org.moveRepository(org, '/fixture/gamma', '/fixture/alpha', 'group-a', 'before', rows.map(r => r.repository.path))
    const storage = { data: '', setItem(k,v) { this.data = v }, getItem() { return this.data } }
    Org.saveRepositoryOrganization(storage, org)
    org = Org.readRepositoryOrganization(storage)
    assert.deepEqual(org.repositoryOrder, ['/fixture/gamma', '/fixture/alpha', '/fixture/beta'])
    assert.deepEqual(org.collapsed, ['group-a'])
    const activities = new Map(rows.map((r,i) => [r.repository.path, { checkedAt: 1, changedFilesCount: 0, unpushedCount: 0, lastChangedAt: i * 100, lastCommitAt: 0 }]))
    const project = sort => projectActivityGroups([{ identifier: 'old', items: rows }], activities, { sort, onlyUncommitted: false }, 'activity', org)
    for (const sort of ['name', 'recent', 'dirty-first']) assert.deepEqual(project(sort)[1].items.map(r => r.id), ['3','1','2'])
    activities.get('/fixture/gamma').changedFilesCount = 1
    activities.get('/fixture/alpha').changedFilesCount = 1
    assert.deepEqual(project('name')[0].items.map(r => r.id), ['1','3'])
    assert.deepEqual(project('recent')[0].items.map(r => r.id), ['3','1'])
    assert.deepEqual(project('recent')[1].items.map(r => r.id), ['2'])
    activities.get('/fixture/gamma').changedFilesCount = 0
    activities.get('/fixture/alpha').changedFilesCount = 0
    assert.deepEqual(project('recent')[1].items.map(r => r.id), ['3','1','2'])
    assert.equal(Org.moveRepository(org, '/fixture/gamma', '/fixture/alpha', Org.WorkingGroup, 'after', []), org)
  })
  await test('deleted groups unassign repositories; malformed storage is safe', () => {
    const value = { groups: [{ id: 'group-test', name: 'Test' }], assignments: { [repo]: 'group-test' } }
    assert.deepEqual(Org.removeRepositoryGroup(value, 'group-test'), { groups: [], assignments: {} })
    assert.equal(Org.readRepositoryOrganization({ getItem: () => '{broken' }).groups[0].name, 'shane')
    assert.equal(Org.assignRepository(value, repo, 'unknown'), value)
  })
  console.log(`${passed}/${passed} repository group tests passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }))
