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
    if (target.endsWith('/models/popup')) return { PopupType: { RepositoryGroupEditor: 'RepositoryGroupEditor' } }
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
    if (/repository-activity\/(status|list|preferences|organization)$/.test(target)) return load(`${target}.ts`)
    if (target.endsWith('/repository-group-dialog') || target.endsWith('/repository-activity-toolbar') || target.endsWith('/section-filter-list')) return load(`${target}.tsx`)
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
  dispatchEvent: event => listeners.get(event.type)?.(),
  addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k),
  setInterval: (fn, interval) => { Assert.equal(interval, 15000); tick = fn; return 1 },
  clearInterval: () => { cleared = true },
}
global.document = {
  visibilityState: 'visible', hasFocus: () => true,
  addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k),
}
const { RepositoriesList } = load(Path.join(root, 'app/src/ui/repositories-list/repositories-list.tsx'))
const { RepositoryGroupDialog } = load(Path.join(root, 'app/src/ui/repositories-list/repository-group-dialog.tsx'))
const { activityKey } = load(Path.join(root, 'app/src/lib/repository-activity/status.ts'))
const repositories = rows.map(r => r.repository)
const props = { repositories, selectedRepository: repositories[0], recentRepositories: [], localRepositoryStateLookup: new Map(), filterText: '', onSelectionChanged: () => {}, dispatcher: { showPopup: popup => { props.lastPopup = popup } } }
const picker = new RepositoriesList(props)
const listElement = () => picker.render().props.children[0]
const snapshot = count => ({ changedFilesCount: count, fingerprint: 'a'.repeat(64), fileModifiedAt: 100, lastChangedAt: count ? 100 : null, checkedAt: 1000, error: false })
test('picker opts into recent-local-change ordering and renders compact options', () => {
  Assert.equal(picker.state.activityPreferences.sort, 'recent')
  Assert.equal(listElement().props.preserveItemOrder, true)
  Assert.equal(typeof listElement().props.renderPreList, 'function')
  const postFilter = listElement().props.renderPostFilter()
  Assert.equal(postFilter.props.children.length, 2)
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
test('name sort preserves Working and manual group order during search', () => {
  picker.onActivityPreferencesChanged({ sort: 'name', onlyUncommitted: false })
  Assert.equal(listElement().props.preserveItemOrder, true)
  Assert.equal(listElement().props.groups[0].identifier, '_Working_')
})
test('empty custom groups remain available as drop targets but search hides them', () => {
  const groups = [{ identifier: 'empty', items: [] }, { identifier: 'repos', items: rows }]
  const list = new SectionFilterList({ ...listProps, groups, filterText: '', showEmptyGroups: true })
  Assert.equal(list.state.rows[0][0].identifier, 'empty')
  const searched = new SectionFilterList({ ...listProps, groups, filterText: 'project', showEmptyGroups: true })
  Assert.equal(searched.state.rows.length, 1)
})
test('create, rename, drag, and delete persist assignments while Working has priority', () => {
  picker.props = { ...props, filterText: '' }
  picker.onCreateGroup()
  Assert.equal(props.lastPopup.type, 'RepositoryGroupEditor')
  const dialog = new RepositoryGroupDialog({ groupId: null, onDismissed() {} })
  dialog.onNameChanged('Projects')
  dialog.save()
  const group = picker.state.organization.groups.find(g => g.name === 'Projects')
  Assert.ok(group)
  const rename = new RepositoryGroupDialog({ groupId: group.id, onDismissed() {} })
  rename.onNameChanged('Personal')
  rename.save()
  Assert.equal(picker.state.organization.groups.find(g => g.id === group.id).name, 'Personal')
  const header = picker.renderGroupHeader(group.id)
  picker.draggedRepository = repositories[1].id
  header.props.onDrop({ currentTarget: { dataset: { group: group.id } }, preventDefault() {}, stopPropagation() {} })
  Assert.equal(picker.state.organization.assignments[activityKey(repositories[1].path)], group.id)
  Assert.equal(listElement().props.groups[0].identifier, '_Working_')
  Assert.equal(listElement().props.groups[0].items[0].id, '2')
  Assert.equal(listElement().props.groups[0].items[0].workingGroupName, 'Personal')
  const clean = snapshot(0)
  picker.activityMonitor.notify({ repositories: new Map(repositories.map(r => [activityKey(r.path), clean])), checking: false, completed: 2, total: 2 })
  Assert.equal(listElement().props.groups.find(g => g.identifier === group.id).items[0].id, '2')
  const nextPicker = new RepositoriesList(props)
  Assert.equal(nextPicker.state.organization.assignments[activityKey(repositories[1].path)], group.id)
  const { removeRepositoryGroup } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  picker.updateOrganization(removeRepositoryGroup(picker.state.organization, group.id))
  Assert.equal(listElement().props.groups.find(g => g.identifier === '_Ungrouped_').items.length, 2)
})
test('group dialog rejects empty, reserved, case, whitespace, and Unicode duplicates', () => {
  let dismissed = false
  const dialog = new RepositoryGroupDialog({ groupId: null, onDismissed() { dismissed = true } })
  for (const name of ['', '  ', 'WORKING', 'Ungrouped', ' SHANE ', 'ｓｈａｎｅ', 'a'.repeat(81)]) {
    dialog.onNameChanged(name)
    dialog.save()
    Assert.ok(dialog.state.saveError, name)
    Assert.equal(dismissed, false)
  }
  Assert.ok(dialog.state.edited)
})
test('group dialog revalidates on save and preserves concurrent assignments', () => {
  const dialog = new RepositoryGroupDialog({ groupId: null, onDismissed() {} })
  dialog.onNameChanged('Concurrent')
  const other = new RepositoryGroupDialog({ groupId: null, onDismissed() {} })
  other.onNameChanged('Concurrent'); other.save()
  dialog.save()
  Assert.match(dialog.state.saveError, /already exists/)
  const { readRepositoryOrganization, removeRepositoryGroup, saveRepositoryOrganization } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  const current = readRepositoryOrganization(localStorage)
  const id = current.groups.find(g => g.name === 'Concurrent').id
  saveRepositoryOrganization(localStorage, removeRepositoryGroup(current, id))
})
test('group dialog stays open on storage failure and cancel does not create anything', () => {
  const before = new Map(storage)
  let dismissed = false
  const dialog = new RepositoryGroupDialog({ groupId: null, onDismissed() { dismissed = true } })
  dialog.onNameChanged('Not saved')
  const original = localStorage.setItem
  localStorage.setItem = () => { throw new Error('full') }
  try { dialog.save() } finally { localStorage.setItem = original }
  Assert.equal(dismissed, false)
  Assert.match(dialog.state.saveError, /Could not save/)
  dialog.props.onDismissed()
  Assert.deepEqual(storage, before)
})
test('group reorder persists, preserves assignments, and keeps fixed sections at the ends', () => {
  const { moveRepositoryGroup } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  const original = picker.state.organization
  const value = { groups: [{ id: 'group-a', name: 'A' }, { id: 'group-b', name: 'B' }, { id: 'group-c', name: 'C' }], assignments: { '/fixture/repo': 'group-a' } }
  picker.updateOrganization(value)
  picker.moveGroup('group-c', 'up')
  Assert.deepEqual(picker.state.organization.groups.map(g => g.id), ['group-a', 'group-c', 'group-b'])
  picker.draggedGroup = 'group-a'
  picker.onGroupDrop({ currentTarget: { dataset: { group: '_Ungrouped_' }, getBoundingClientRect: () => ({ top: 0, height: 29 }) }, clientY: 0, preventDefault() {}, stopPropagation() {} })
  Assert.deepEqual(picker.state.organization.groups.map(g => g.id), ['group-c', 'group-b', 'group-a'])
  Assert.deepEqual(picker.state.organization.assignments, value.assignments)
  Assert.deepEqual(new RepositoriesList(props).state.organization.groups, picker.state.organization.groups)
  const groups = listElement().props.groups
  Assert.equal(groups[0].identifier, '_Working_')
  Assert.equal(groups[groups.length - 1].identifier, '_Ungrouped_')
  Assert.equal(moveRepositoryGroup(value, 'group-a', '_Working_'), value)
  Assert.equal(moveRepositoryGroup(value, '_Working_', 'group-a'), value)
  Assert.equal(moveRepositoryGroup(value, 'group-a', 'group-a'), value)
  picker.updateOrganization(original)
})
test('collapse survives recreation and reordering without changing membership', () => {
  const original = picker.state.organization
  const id = original.groups[0].id
  picker.suppressClickUntil = 0
  picker.onGroupToggle({ currentTarget: { dataset: { group: id } }, stopPropagation() {} })
  picker.onGroupToggle({ currentTarget: { dataset: { group: '_Working_' } }, stopPropagation() {} })
  const fresh = new RepositoriesList(props)
  Assert.deepEqual(fresh.state.organization.collapsed, [id, '_Working_'])
  Assert.deepEqual(fresh.state.organization.assignments, original.assignments)
  const { moveRepositoryGroup, removeRepositoryGroup, readRepositoryOrganization } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  Assert.deepEqual(moveRepositoryGroup(fresh.state.organization, id, '_Ungrouped_').collapsed, [id, '_Working_'])
  Assert.deepEqual(removeRepositoryGroup(fresh.state.organization, id).collapsed, ['_Working_'])
  const invalid = { ...fresh.state.organization, collapsed: [id, id, '_Working_', 'unknown', 2] }
  Assert.deepEqual(readRepositoryOrganization({ getItem: () => JSON.stringify(invalid) }).collapsed, [id, '_Working_'])
  picker.updateOrganization(original)
})
test('collapsed headers remain available and search reveals items temporarily', () => {
  const group = { identifier: 'group-test', items: rows }
  const options = { ...listProps, groups: [group], filterText: '', renderGroupHeader: () => null, collapsedGroupIds: new Set(['group-test']) }
  const collapsed = new SectionFilterList(options)
  Assert.deepEqual(visible(collapsed), [])
  Assert.equal(collapsed.state.rows.flat()[0].kind, 'group')
  Assert.equal(visible(new SectionFilterList({ ...options, filterText: 'project' })).length, 2)
  Assert.deepEqual(visible(new SectionFilterList(options)), [])
})
test('repository row drops persist order and reject Working targets', () => {
  const original = picker.state.organization
  const group = original.groups[0].id
  picker.assignGroup(repositories[0].path, group)
  const event = working => ({ currentTarget: { dataset: { repositoryId: String(repositories[0].id), working: String(working) }, getBoundingClientRect: () => ({ top: 0, height: 29 }) }, clientY: 1, dataTransfer: {}, preventDefault() {}, stopPropagation() {} })
  picker.draggedRepository = repositories[1].id
  picker.onRepositoryDragOver(event(false))
  Assert.equal(picker.state.dropPosition, 'before')
  picker.onRepositoryDrop(event(false))
  const saved = new RepositoriesList(props).state.organization
  Assert.deepEqual(saved.repositoryOrder, [repositories[1].path, repositories[0].path])
  Assert.equal(saved.assignments[repositories[1].path], group)
  picker.draggedRepository = repositories[1].id
  picker.onRepositoryDrop(event(true))
  Assert.deepEqual(picker.state.organization, saved)
  const header = picker.renderGroupHeader(group)
  Assert.equal(header.props.draggable, true)
  picker.updateOrganization(original)
})
test('list-wide drop slots include gaps, section bodies and list edges', () => {
  const { findRepositoryDropSlot: find } = load(Path.join(root, 'app/src/lib/repository-activity/drag.ts'))
  const rows = [
    { top: 0, bottom: 29, group: '_Working_' },
    { top: 29, bottom: 58, group: '_Working_', repositoryId: 1 },
    { top: 58, bottom: 87, group: 'group-a' },
    { top: 87, bottom: 116, group: 'group-a', repositoryId: 2 },
    { top: 120, bottom: 149, group: 'group-a', repositoryId: 3 },
    { top: 149, bottom: 178, group: 'group-b' },
    { top: 178, bottom: 207, group: 'group-b', repositoryId: 4 },
    { top: 207, bottom: 236, group: '_Ungrouped_' },
  ]
  Assert.equal(find(rows, 45, null, 4), null)
  Assert.equal(find(rows, 118, null, 4).repositoryId, 2)
  Assert.equal(find(rows, 118, null, 4).position, 'after')
  Assert.equal(find(rows, 86, null, 4).repositoryId, 2)
  Assert.equal(find(rows, 135, 'group-b', null).group, 'group-a')
  Assert.equal(find(rows, 135, 'group-b', null).position, 'after')
  Assert.equal(find(rows, 290, null, 4).group, '_Ungrouped_')
  Assert.equal(find(rows, 290, 'group-a', null).group, 'group-b')
  Assert.equal(find(rows, 290, 'group-a', null).position, 'after')
})
test('list-wide drop slots reject Working for both drag types', () => {
  const { findRepositoryDropSlot: find } = load(Path.join(root, 'app/src/lib/repository-activity/drag.ts'))
  const rows = [
    { top: 0, bottom: 29, group: '_Working_' },
    { top: 29, bottom: 58, group: '_Working_', repositoryId: 1 },
    { top: 58, bottom: 87, group: 'group-a' },
    { top: 87, bottom: 116, group: 'group-a', repositoryId: 2 },
    { top: 116, bottom: 145, group: '_Ungrouped_' },
  ]
  Assert.equal(find(rows, 10, 'group-a', null), null)
  Assert.equal(find(rows, 45, 'group-a', null), null)
  Assert.equal(find(rows, 10, null, 2), null)
  Assert.equal(find(rows, 45, null, 2), null)
})
test('list-wide drop on the source repository row is a no-op', () => {
  const { findRepositoryDropSlot: find } = load(Path.join(root, 'app/src/lib/repository-activity/drag.ts'))
  const rows = [
    { top: 0, bottom: 29, group: '_Working_' },
    { top: 29, bottom: 58, group: 'group-a' },
    { top: 58, bottom: 87, group: 'group-a', repositoryId: 1 },
    { top: 87, bottom: 116, group: 'group-b' },
    { top: 116, bottom: 145, group: 'group-b', repositoryId: 2 },
    { top: 145, bottom: 174, group: '_Ungrouped_' },
  ]
  Assert.equal(find(rows, 72, null, 1), null)
  Assert.equal(find(rows, 130, null, 2), null)
})
test('container drop commits the previewed slot even over whitespace', () => {
  const original = picker.state.organization
  picker.draggedRepository = repositories[1].id
  picker.dropSlot = { repositoryId: repositories[0].id, group: '_Ungrouped_', position: 'before', y: 100 }
  picker.onListDrop({ preventDefault() {}, stopPropagation() {} })
  Assert.deepEqual(picker.state.organization.repositoryOrder, [repositories[1].path, repositories[0].path])
  Assert.equal(picker.dropSlot, null)
  picker.updateOrganization(original)
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
