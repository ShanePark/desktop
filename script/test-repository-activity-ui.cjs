/* Isolated wiring tests. React/DOM/Git execution are stubs, not GUI validation. */
const Assert = require('node:assert/strict')
const Fs = require('node:fs')
const Path = require('node:path')
const Module = require('node:module')
const Ts = require('typescript')
const root = Path.resolve(__dirname, '..')
let passed = 0
function test(name, run) {
  run()
  passed++
  console.log(`PASS ${name}`)
}
class Component {
  constructor(props) { this.props = props }
  setState(update) {
    this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }
  }
}
const React = { Component, createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }
class Repository {
  constructor(path, id) { this.path = path; this.id = id; this.name = Path.basename(path) }
}
class Monitor {
  constructor(sample, notify) { this.notify = notify; this.paths = []; this.refreshes = 0; this.stopped = false }
  setPaths(paths) { const changed = JSON.stringify(paths) !== JSON.stringify(this.paths); this.paths = paths; return changed }
  refresh() { this.refreshes++; return Promise.resolve() }
  stop() { this.stopped = true }
}
const row = r => ({ id: String(r.id), repository: r, text: [r.name], changedFilesCount: 0, needsDisambiguation: false, aheadBehind: null })
const grouping = {
  KnownRepositoryGroup: { Enterprise: '_Enterprise_', NonGitHub: '_Non-GitHub_' },
  groupRepositories: repos => [{ identifier: 'Original', items: repos.map(row) }],
  makeRecentRepositoriesGroup: (ids, repos) => ({ identifier: 'Recent', items: repos.filter(r => ids.includes(r.id)).map(row) }),
}
const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path).exports
  const source = Fs.readFileSync(path, 'utf8')
  const output = Ts.transpileModule(source, {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { target: Ts.ScriptTarget.ES2020, module: Ts.ModuleKind.CommonJS, jsx: Ts.JsxEmit.React, esModuleInterop: true },
  })
  Assert.equal((output.diagnostics ?? []).filter(d => d.category === Ts.DiagnosticCategory.Error).length, 0)
  const mod = new Module(path, module)
  modules.set(path, mod)
  mod.require = spec => {
    if (spec === 'react') return React
    if (spec === 'classnames') return (...values) => values.filter(Boolean).join(' ')
    if (spec === 'memoize-one') return fn => fn
    if (!spec.startsWith('.')) return require(spec)
    const target = Path.resolve(Path.dirname(path), spec)
    if (target.endsWith('/models/repository')) return { Repository }
    if (target.endsWith('/group-repositories')) return grouping
    if (target.endsWith('/repository-activity/monitor')) return { RepositoryActivityMonitor: Monitor }
    if (target.endsWith('/git/repository-activity')) return { readRepositoryActivity: () => { throw new Error('Unexpected real scan') } }
    if (target.endsWith('/lib/path')) return { encodePathAsUrl: (...parts) => parts.join('/') }
    if (target.endsWith('/fuzzy-find')) return {
      match: (query, items) => items.filter(r => r.text.some(t => t.toLowerCase().includes(query)))
        .slice().reverse().map(item => ({ item, score: 7, matches: { title: [0], subtitle: [] } })),
    }
    if (target.endsWith('/list-row-index-path')) return {
      InvalidRowIndexPath: { section: -1, row: -1 },
      rowIndexPathEquals: (a, b) => a.section === b.section && a.row === b.row,
    }
    if (/repository-activity\/(status|list|preferences)$/.test(target)) return load(`${target}.ts`)
    if (target.endsWith('/repository-activity-toolbar') || target.endsWith('/section-filter-list')) return load(`${target}.tsx`)
    return {}
  }
  mod._compile(output.outputText, path)
  return mod.exports
}
const { SectionFilterList } = load(Path.join(root, 'app/src/ui/lib/section-filter-list.tsx'))
const rows = [row(new Repository('/fixture/z-project', 1)), row(new Repository('/fixture/a-project', 2))]
const listProps = {
  groups: [{ identifier: 'Local', items: rows }], selectedItem: null, filterText: 'PROJECT',
  rowHeight: 29, invalidationProps: {}, renderItem: () => null, renderGroupHeader: () => null,
}
const visible = list => list.state.rows.flat().filter(r => r.kind === 'item').map(r => r.item.id)
test('shared list preserves existing fuzzy ranking by default', () => {
  Assert.deepEqual(visible(new SectionFilterList(listProps)), ['2', '1'])
})
test('opt-in keeps activity order and match highlighting during name search', () => {
  const list = new SectionFilterList({ ...listProps, preserveItemOrder: true })
  Assert.deepEqual(visible(list), ['1', '2'])
  Assert.deepEqual(list.state.rows[0][1].matches.title, [0])
})
test('selected repository follows its ID when activity rows reorder', () => {
  const list = new SectionFilterList({ ...listProps, preserveItemOrder: true, selectedItem: rows[0] })
  list.componentWillReceiveProps({ ...listProps, preserveItemOrder: true, selectedItem: rows[0], groups: [{ identifier: 'Local', items: [...rows].reverse() }] })
  Assert.equal(list.state.rows[list.state.selectedRow.section][list.state.selectedRow.row].item.id, '1')
})
const storage = new Map()
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
const listeners = new Map()
let tick
let cleared = false
global.window = {
  addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k),
  setInterval: (fn, interval) => { Assert.equal(interval, 15000); tick = fn; return 1 },
  clearInterval: () => { cleared = true },
}
global.document = {
  visibilityState: 'visible', hasFocus: () => true,
  addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k),
}
const { RepositoriesList } = load(Path.join(root, 'app/src/ui/repositories-list/repositories-list.tsx'))
const { activityKey } = load(Path.join(root, 'app/src/lib/repository-activity/status.ts'))
const repositories = rows.map(r => r.repository)
const props = { repositories, selectedRepository: repositories[0], recentRepositories: [], localRepositoryStateLookup: new Map(), filterText: '', onSelectionChanged: () => {}, dispatcher: {} }
const picker = new RepositoriesList(props)
const listElement = () => picker.render().props.children[0]
const snapshot = count => ({ changedFilesCount: count, fingerprint: 'a'.repeat(64), fileModifiedAt: 100, lastChangedAt: count ? 100 : null, checkedAt: 1000, error: false })
test('picker opts into recent-local-change ordering and renders toolbar', () => {
  Assert.equal(picker.state.activityPreferences.sort, 'recent')
  Assert.equal(listElement().props.preserveItemOrder, true)
  Assert.equal(typeof listElement().props.renderPreList, 'function')
})
test('mount scans every registered repository despite active filters', () => {
  picker.props = { ...props, filterText: 'z-project' }
  picker.onActivityPreferencesChanged({ sort: 'recent', onlyUncommitted: true })
  picker.componentDidMount()
  Assert.deepEqual(picker.activityMonitor.paths, repositories.map(r => r.path))
  Assert.equal(picker.activityMonitor.refreshes, 1)
})
test('activity filter hides known-clean rows without dropping name search', () => {
  picker.activityMonitor.notify({ repositories: new Map(repositories.map((r, i) => [activityKey(r.path), snapshot(i)])), checking: false, completed: 2, total: 2 })
  Assert.deepEqual(listElement().props.groups[0].items.map(r => r.id), ['2'])
  Assert.equal(listElement().props.filterText, 'z-project')
  Assert.equal(listElement().props.selectedItem, null)
})
test('keyboard selection survives subsequent activity refreshes', () => {
  picker.onActivityPreferencesChanged({ sort: 'recent', onlyUncommitted: false })
  picker.onListSelectionChanged(rows[1])
  picker.setState({ activity: { ...picker.state.activity, checking: true } })
  Assert.equal(listElement().props.selectedItem.id, '2')
})
test('original grouping restores original text ranking', () => {
  picker.onActivityPreferencesChanged({ sort: 'name', onlyUncommitted: false })
  Assert.equal(listElement().props.preserveItemOrder, false)
  Assert.equal(listElement().props.groups[0].identifier, 'Original')
})
test('inactive window does not start scheduled scans; focus does', () => {
  const before = picker.activityMonitor.refreshes
  document.hasFocus = () => false
  tick()
  Assert.equal(picker.activityMonitor.refreshes, before)
  listeners.get('focus')()
  Assert.equal(picker.activityMonitor.refreshes, before + 1)
})
test('unmount stops queued work and removes timer and listeners', () => {
  picker.componentWillUnmount()
  Assert.equal(picker.activityMonitor.stopped, true)
  Assert.equal(cleared, true)
  Assert.equal(listeners.size, 0)
})
console.log(`\n${passed}/${passed} UI wiring tests passed (stubbed React/DOM).`)
