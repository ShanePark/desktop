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
  constructor(props) {
    this.props = props
  }
  setState(update) {
    this.state = {
      ...this.state,
      ...(typeof update === 'function' ? update(this.state) : update),
    }
  }
}
const React = {
  Component,
  createElement: (type, props, ...children) => ({
    type,
    props: { ...props, children },
  }),
}
class Repository {
  constructor(path, id) {
    this.path = path
    this.id = id
    this.name = Path.basename(path)
  }
}
class Monitor {
  constructor(sample, notify, initial = new Map()) {
    this.notify = notify
    this.initial = initial
    this.paths = []
    this.refreshes = 0
    this.refreshOptions = []
    this.invalidated = []
    this.stopped = false
  }
  invalidate(paths) {
    this.invalidated.push(paths)
  }
  setPriority(priority) {
    this.priority = priority
  }
  setPaths(paths) {
    const changed = JSON.stringify(paths) !== JSON.stringify(this.paths)
    this.paths = paths
    return changed
  }
  refresh(options) {
    this.refreshes++
    this.refreshOptions.push(options)
    return Promise.resolve()
  }
  stop() {
    this.stopped = true
  }
}
const row = (r, lookup = new Map()) => ({
  id: String(r.id),
  repository: r,
  text: [r.name],
  changedFilesCount: lookup.get(r.id)?.changedFilesCount ?? 0,
  needsDisambiguation: false,
  aheadBehind: lookup.get(r.id)?.aheadBehind ?? null,
  indicatorObservedAt: lookup.get(r.id)?.observedAt,
})
let groupingCalls = 0
const grouping = {
  KnownRepositoryGroup: {
    Enterprise: '_Enterprise_',
    NonGitHub: '_Non-GitHub_',
  },
  groupRepositories: (repos, lookup) => {
    groupingCalls++
    return [
      { identifier: 'Original', items: repos.map(r => row(r, lookup)) },
    ]
  },
  makeRecentRepositoriesGroup: (ids, repos) => ({
    identifier: 'Recent',
    items: repos.filter(r => ids.includes(r.id)).map(r => row(r)),
  }),
}
const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path).exports
  const source = Fs.readFileSync(path, 'utf8')
  const output = Ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: Ts.ScriptTarget.ES2020,
      module: Ts.ModuleKind.CommonJS,
      jsx: Ts.JsxEmit.React,
      esModuleInterop: true,
    },
  })
  Assert.equal(
    (output.diagnostics ?? []).filter(
      d => d.category === Ts.DiagnosticCategory.Error
    ).length,
    0
  )
  const mod = new Module(path, module)
  modules.set(path, mod)
  mod.require = spec => {
    if (spec === 'react') return React
    if (spec === 'classnames')
      return (...values) => values.filter(Boolean).join(' ')
    if (spec === 'memoize-one')
      return require(Path.join(root, 'app/node_modules/memoize-one'))
    if (!spec.startsWith('.')) return require(spec)
    const target = Path.resolve(Path.dirname(path), spec)
    if (target.endsWith('/models/popup'))
      return { PopupType: { RepositoryGroupEditor: 'RepositoryGroupEditor' } }
    if (target.endsWith('/models/repository')) return { Repository }
    if (target.endsWith('/lib/popover'))
      return {
        Popover: 'Popover',
        PopoverAnchorPosition: { BottomRight: 'bottom-right' },
        PopoverDecoration: { Balloon: 'balloon' },
      }
    if (target.endsWith('/group-repositories')) return grouping
    if (target.endsWith('/repository-activity/monitor'))
      return { RepositoryActivityMonitor: Monitor }
    if (target.endsWith('/git/repository-activity'))
      return {
        readRepositoryActivity: () => {
          throw new Error('Unexpected real scan')
        },
      }
    if (target.endsWith('/lib/path'))
      return { encodePathAsUrl: (...parts) => parts.join('/') }
    if (target.endsWith('/fuzzy-find'))
      return {
        match: (query, items) =>
          items
            .filter(r => r.text.some(t => t.toLowerCase().includes(query)))
            .slice()
            .reverse()
            .map(item => ({
              item,
              score: 7,
              matches: { title: [0], subtitle: [] },
            })),
      }
    if (target.endsWith('/list-row-index-path'))
      return {
        InvalidRowIndexPath: { section: -1, row: -1 },
        rowIndexPathEquals: (a, b) =>
          a.section === b.section && a.row === b.row,
      }
    if (
      /repository-activity\/(status|list|preferences|organization)$/.test(
        target
      )
    )
      return load(`${target}.ts`)
    if (
      target.endsWith('/repository-group-dialog') ||
      target.endsWith('/repository-activity-toolbar') ||
      target.endsWith('/section-filter-list')
    )
      return load(`${target}.tsx`)
    if (target.endsWith('/repository-activity/drag'))
      return load(`${target}.ts`)
    return {}
  }
  mod._compile(output.outputText, path)
  return mod.exports
}
const { SectionFilterList } = load(
  Path.join(root, 'app/src/ui/lib/section-filter-list.tsx')
)
const rows = [
  row(new Repository('/fixture/z-project', 1)),
  row(new Repository('/fixture/a-project', 2)),
]
const listProps = {
  groups: [{ identifier: 'Local', items: rows }],
  selectedItem: null,
  filterText: 'PROJECT',
  rowHeight: 29,
  invalidationProps: {},
  renderItem: () => null,
  renderGroupHeader: () => null,
}
const visible = list =>
  list.state.rows
    .flat()
    .filter(r => r.kind === 'item')
    .map(r => r.item.id)
test('shared list preserves existing fuzzy ranking by default', () => {
  Assert.deepEqual(visible(new SectionFilterList(listProps)), ['2', '1'])
})
test('opt-in keeps activity order and match highlighting during name search', () => {
  const list = new SectionFilterList({ ...listProps, preserveItemOrder: true })
  Assert.deepEqual(visible(list), ['1', '2'])
  Assert.deepEqual(list.state.rows[0][1].matches.title, [0])
})
test('selected repository follows its ID when activity rows reorder', () => {
  const list = new SectionFilterList({
    ...listProps,
    preserveItemOrder: true,
    selectedItem: rows[0],
  })
  list.componentWillReceiveProps({
    ...listProps,
    preserveItemOrder: true,
    selectedItem: rows[0],
    groups: [{ identifier: 'Local', items: [...rows].reverse() }],
  })
  Assert.equal(
    list.state.rows[list.state.selectedRow.section][list.state.selectedRow.row]
      .item.id,
    '1'
  )
})
const storage = new Map()
global.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
}
const listeners = new Map()
let tick
let cleared = false
global.window = {
  dispatchEvent: event => listeners.get(event.type)?.(),
  addEventListener: (k, v) => listeners.set(k, v),
  removeEventListener: k => listeners.delete(k),
  setInterval: (fn, interval) => {
    Assert.equal(interval, 15000)
    tick = fn
    return 1
  },
  clearInterval: () => {
    cleared = true
  },
}
global.document = {
  visibilityState: 'visible',
  hasFocus: () => true,
  addEventListener: (k, v) => listeners.set(k, v),
  removeEventListener: k => listeners.delete(k),
}
const { RepositoryActivityToolbar } = load(
  Path.join(
    root,
    'app/src/ui/repositories-list/repository-activity-toolbar.tsx'
  )
)
const { RepositoriesList } = load(
  Path.join(root, 'app/src/ui/repositories-list/repositories-list.tsx')
)
const { RepositoryGroupDialog } = load(
  Path.join(root, 'app/src/ui/repositories-list/repository-group-dialog.tsx')
)
const { activityKey } = load(
  Path.join(root, 'app/src/lib/repository-activity/status.ts')
)
const { WorkingGroup, RecentGroup } = load(
  Path.join(root, 'app/src/lib/repository-activity/organization.ts')
)
const repositories = rows.map(r => r.repository)
const props = {
  repositories,
  selectedRepository: repositories[0],
  recentRepositories: [],
  localRepositoryStateLookup: new Map(),
  filterText: '',
  onSelectionChanged: () => {},
  dispatcher: {
    showPopup: popup => {
      props.lastPopup = popup
    },
  },
}
const picker = new RepositoriesList(props)
/** Mounts another list without replacing the shared picker's listeners. */
const withIsolatedMount = (list, run) => {
  const savedListeners = new Map(listeners)
  const savedTick = tick
  try {
    list.componentDidMount()
    run()
  } finally {
    list.componentWillUnmount()
    listeners.clear()
    savedListeners.forEach((value, key) => listeners.set(key, value))
    tick = savedTick
    cleared = false
  }
}
const listElement = () => picker.render().props.children[0]
const snapshot = count => ({
  changedFilesCount: count,
  fingerprint: 'a'.repeat(64),
  fileModifiedAt: 100,
  lastChangedAt: count ? 100 : null,
  checkedAt: 1000,
  error: false,
})
test('picker opts into recent-local-change ordering and renders compact options', () => {
  Assert.equal(picker.state.activityPreferences.sort, 'recent')
  Assert.equal(listElement().props.preserveItemOrder, true)
  Assert.equal(typeof listElement().props.renderPreList, 'function')
  const postFilter = listElement().props.renderPostFilter()
  Assert.equal(postFilter.props.children.length, 2)
  const toolbar = new RepositoryActivityToolbar({
    preferences: picker.state.activityPreferences,
    onChange: () => {},
  })
  toolbar.state = { isPopoverOpen: true }
  const popover = toolbar.render().props.children[1]
  Assert.equal(
    popover.props.children[1].props.children[0].props.children[0],
    'Sort by'
  )
  // Only the three Sort by modes remain; Uncommitted only was removed.
  Assert.equal(popover.props.children.length, 2)
  Assert.deepEqual(
    popover.props.children[1].props.children.slice(1).map(r => r.props.value),
    ['recent', 'dirty-first', 'name']
  )
  Assert.equal(
    toolbar.render().props.children[0].props.className,
    'repository-activity-options-button'
  )
})
test('activity checks avoid UI updates when only checkedAt changes', () => {
  const activityList = new RepositoriesList(props)
  let updates = 0
  const setState = activityList.setState.bind(activityList)
  activityList.setState = update => {
    updates++
    return setState(update)
  }
  const path = activityKey(repositories[0].path)
  const changed = new Map([[path, snapshot(1)]])
  activityList.activityMonitor.notify({
    repositories: changed,
    checking: true,
    completed: 1,
    total: 2,
  })
  activityList.activityMonitor.notify({
    repositories: changed,
    checking: false,
    completed: 1,
    total: 2,
  })
  const refreshed = new Map([[path, { ...snapshot(1), checkedAt: 2000 }]])
  activityList.activityMonitor.notify({
    repositories: refreshed,
    checking: true,
    completed: 1,
    total: 2,
  })
  activityList.activityMonitor.notify({
    repositories: refreshed,
    checking: false,
    completed: 1,
    total: 2,
  })
  Assert.equal(updates, 2)
})
test('mount scans every registered repository despite active filters', () => {
  picker.props = { ...props, filterText: 'z-project' }
  picker.onActivityPreferencesChanged({ sort: 'recent' })
  picker.componentDidMount()
  Assert.deepEqual(
    picker.activityMonitor.paths,
    repositories.map(r => r.path)
  )
  Assert.equal(picker.activityMonitor.refreshes, 1)
  Assert.deepEqual(picker.activityMonitor.refreshOptions, [{ maxAge: 0 }])
})
test('activity passes check the selected repository first, then Working', () => {
  const [working, selected] = repositories
  const list = new RepositoriesList({ ...props, selectedRepository: selected })
  // Repositories without known activity are left to registration order.
  list.activityMonitor.notify({
    repositories: new Map(),
    checking: false,
    completed: 0,
    total: 2,
  })
  Assert.deepEqual(list.activityMonitor.priority(), [selected.path])
  list.activityMonitor.notify({
    repositories: new Map([[activityKey(working.path), snapshot(2)]]),
    checking: false,
    completed: 1,
    total: 2,
  })
  Assert.deepEqual(list.activityMonitor.priority(), [
    selected.path,
    working.path,
  ])
})
test('a failed recheck of a restored result is described as unavailable', () => {
  const list = new RepositoriesList(props)
  const path = repositories[0].path
  const describe = activity => {
    list.activityMonitor.notify({
      repositories: new Map([[activityKey(path), activity]]),
      checking: false,
      completed: 1,
      total: 2,
    })
    return list.getActivityDescription(row(repositories[0]))
  }
  Assert.match(describe({ ...snapshot(1), checkedAt: 0 }), /waiting/)
  Assert.match(
    describe({ ...snapshot(1), checkedAt: 0, error: true }),
    /unavailable/
  )
})
test('reopening reuses verified session snapshots before the background refresh', () => {
  const cached = new Map(
    repositories.map((repository, index) => [
      activityKey(repository.path),
      snapshot(index + 1),
    ])
  )
  const source = new RepositoriesList(props)
  source.activityMonitor.notify({
    repositories: cached,
    checking: false,
    completed: 2,
    total: 2,
  })

  const reopened = new RepositoriesList(props)
  const groups = reopened.render().props.children[0].props.groups
  const working = groups.find(group => group.identifier === '_Working_').items
  Assert.deepEqual(
    new Set(working.map(item => item.repository.id)),
    new Set([1, 2])
  )
  Assert.equal(reopened.activityMonitor.initial.size, 2)
  Assert.equal(reopened.activityMonitor.refreshes, 0)

  withIsolatedMount(reopened, () => {
    Assert.deepEqual(reopened.activityMonitor.refreshOptions, [{ maxAge: 0 }])
  })
})
test('reopening retains partial in-progress session results', () => {
  const partial = new Map([[activityKey(repositories[1].path), snapshot(1)]])
  const source = new RepositoriesList(props)
  source.activityMonitor.notify({
    repositories: partial,
    checking: true,
    completed: 1,
    total: 2,
  })

  const reopened = new RepositoriesList(props)
  const groups = reopened.render().props.children[0].props.groups
  const working = groups.find(group => group.identifier === '_Working_').items
  Assert.deepEqual(
    working.map(item => item.repository.id),
    [2]
  )
})
test('repository path changes replace monitored paths and trigger a refresh', () => {
  const initialProps = {
    ...props,
    repositories: [repositories[0], repositories[1]],
  }
  const changing = new RepositoriesList(initialProps)
  const before = changing.activityMonitor.refreshes
  const added = new Repository('/fixture/new-project', 3)
  const nextProps = { ...initialProps, repositories: [repositories[0], added] }
  changing.props = nextProps
  changing.componentDidUpdate(initialProps)
  Assert.deepEqual(changing.activityMonitor.paths, [
    repositories[0].path,
    added.path,
  ])
  Assert.equal(changing.activityMonitor.refreshes, before + 1)
  Assert.deepEqual(changing.activityMonitor.refreshOptions.at(-1), {
    maxAge: 7500,
  })
})
test('app-store indicator changes invalidate only those repositories', () => {
  let lookup = new Map([
    [1, { changedFilesCount: 2, aheadBehind: { ahead: 1, behind: 0 }, observedAt: 1 }],
    [2, { changedFilesCount: 0, aheadBehind: null, observedAt: 1 }],
  ])
  const list = new RepositoriesList({ ...props, localRepositoryStateLookup: lookup })
  // The app store replaces its lookup on every change, as these updates do.
  const update = change => {
    const prevProps = list.props
    lookup = new Map(lookup)
    change(lookup)
    list.props = { ...prevProps, localRepositoryStateLookup: lookup }
    list.componentDidUpdate(prevProps)
  }
  withIsolatedMount(list, () => {
    const monitor = list.activityMonitor
    const refreshes = monitor.refreshes

    // Same values observed again (a routine status reload) are not changes.
    update(l =>
      l.set(1, {
        changedFilesCount: 2,
        aheadBehind: { ahead: 1, behind: 0 },
        observedAt: 2,
      })
    )
    Assert.deepEqual(monitor.invalidated, [])
    Assert.equal(monitor.refreshes, refreshes)

    // Commit + push.
    update(l =>
      l.set(1, {
        changedFilesCount: 0,
        aheadBehind: { ahead: 0, behind: 0 },
        observedAt: 3,
      })
    )
    Assert.deepEqual(monitor.invalidated, [[repositories[0].path]])
    Assert.equal(monitor.refreshes, refreshes + 1)
    Assert.deepEqual(monitor.refreshOptions.at(-1), { maxAge: 7500 })

    update(l =>
      l.set(2, {
        changedFilesCount: 0,
        aheadBehind: { ahead: 0, behind: 1 },
        observedAt: 3,
      })
    )
    Assert.deepEqual(monitor.invalidated.at(-1), [repositories[1].path])

    update(l => {
      l.delete(1)
      l.set(3, { changedFilesCount: 1, aheadBehind: null, observedAt: 4 })
    })
    Assert.deepEqual(monitor.invalidated.at(-1), [repositories[0].path])
    Assert.equal(monitor.refreshes, refreshes + 3)
  })
})
test('a replaced app-store lookup updates the open picker before the recheck', () => {
  const path = activityKey(repositories[0].path)
  const savedStorage = new Map(storage)
  const list = new RepositoriesList(props)
  list.setState({
    activityPreferences: { sort: 'recent' },
  })
  // Restored from the previous session: dirty and unpushed, not yet verified.
  list.activityMonitor.notify({
    repositories: new Map([
      [path, { ...snapshot(3), unpushedCount: 1, checkedAt: 0 }],
    ]),
    checking: true,
    completed: 0,
    total: 2,
  })
  const render = () => list.render().props.children[0].props.groups
  // An empty Working section is hidden.
  const working = () =>
    (
      render().find(group => group.identifier === WorkingGroup)?.items ?? []
    ).map(item => [item.repository.id, item.changedFilesCount])
  const update = lookup => {
    const prevProps = list.props
    list.props = { ...prevProps, localRepositoryStateLookup: lookup }
    list.componentDidUpdate(prevProps)
  }
  withIsolatedMount(list, () => {
    Assert.deepEqual(working(), [[1, 3]])
    const calls = groupingCalls
    render()
    Assert.equal(groupingCalls, calls, 'unchanged props reuse memoized groups')

    // In-app commit and push: the app store observes a clean repository.
    update(
      new Map([
        [
          1,
          {
            changedFilesCount: 0,
            aheadBehind: { ahead: 0, behind: 0 },
            observedAt: Date.now(),
          },
        ],
      ])
    )
    Assert.deepEqual(working(), [])
    Assert.equal(groupingCalls, calls + 1)
    const row = render()
      .flatMap(group => group.items)
      .find(item => item.repository.id === 1)
    Assert.equal(row.changedFilesCount, 0)
    Assert.match(list.getActivityDescription(row), /^0 changed files; 0 unpushed/)
    Assert.deepEqual(list.activityMonitor.invalidated.at(-1), [
      repositories[0].path,
    ])

    // A later successful check is newer again and wins.
    list.activityMonitor.notify({
      repositories: new Map([
        [path, { ...snapshot(1), unpushedCount: 0, checkedAt: Date.now() + 1 }],
      ]),
      checking: false,
      completed: 2,
      total: 2,
    })
    Assert.deepEqual(working(), [[1, 1]])
  })
  storage.clear()
  savedStorage.forEach((value, key) => storage.set(key, value))
})
test('name search applies to Recent rows and hides empty headings', () => {
  picker.activityMonitor.notify({
    repositories: new Map(
      repositories.map((r, i) => [
        activityKey(r.path),
        { ...snapshot(i), lastCommitAt: 500 },
      ])
    ),
    checking: false,
    completed: 2,
    total: 2,
  })
  const props = listElement().props
  Assert.equal(props.filterText, 'z-project')
  Assert.equal(props.showEmptyGroups, true)
  Assert.deepEqual(
    props.groups.map(g => [g.identifier, g.items.map(r => r.id)]),
    [
      [WorkingGroup, ['2']],
      [RecentGroup, ['recent:1']],
      ['group-shane', []],
      ['_Ungrouped_', ['1']],
    ]
  )
  const searched = new SectionFilterList(props)
  Assert.deepEqual(
    searched.state.rows.map(section => section[0].identifier),
    [RecentGroup, '_Ungrouped_']
  )
  Assert.deepEqual(visible(searched), ['recent:1', '1'])
})
test('keyboard selection survives transitions between Working and its saved group', () => {
  picker.onActivityPreferencesChanged({ sort: 'recent' })
  picker.onListSelectionChanged(rows[1])
  picker.setState({ activity: { ...picker.state.activity, checking: true } })
  Assert.equal(listElement().props.selectedItem.id, '2')
  for (const count of [0, 1]) {
    picker.activityMonitor.notify({
      repositories: new Map(
        repositories.map(r => [activityKey(r.path), snapshot(count)])
      ),
      checking: false,
      completed: 2,
      total: 2,
    })
    const list = listElement()
    Assert.equal(list.props.selectedItem.repository.id, repositories[1].id)
    Assert.equal(list.props.selectedItem.id, rows[1].id)
    Assert.equal(
      list.props.groups.flatMap(group => group.items)
        .filter(item => item.repository.id === repositories[1].id).length,
      1
    )
    Assert.equal(
      (
        list.props.groups.find(group => group.identifier === WorkingGroup)
          ?.items ?? []
      ).some(item => item.repository.id === repositories[1].id),
      count > 0
    )
  }
})
test('name sort preserves filter order across groups during search', () => {
  picker.onActivityPreferencesChanged({ sort: 'name' })
  Assert.equal(listElement().props.preserveItemOrder, true)
  Assert.equal(listElement().props.groups[0].identifier, '_Working_')
})
test('empty custom groups remain available as drop targets but search hides them', () => {
  const groups = [
    { identifier: 'empty', items: [] },
    { identifier: 'repos', items: rows },
  ]
  const list = new SectionFilterList({
    ...listProps,
    groups,
    filterText: '',
    showEmptyGroups: true,
  })
  Assert.equal(list.state.rows[0][0].identifier, 'empty')
  const searched = new SectionFilterList({
    ...listProps,
    groups,
    filterText: 'project',
    showEmptyGroups: true,
  })
  Assert.equal(searched.state.rows.length, 1)
})
test('create, rename, drag, and delete persist assignments while Working hides assigned repositories', () => {
  picker.props = { ...props, filterText: '' }
  picker.onCreateGroup()
  Assert.equal(props.lastPopup.type, 'RepositoryGroupEditor')
  const dialog = new RepositoryGroupDialog({ groupId: null, onDismissed() {} })
  dialog.onNameChanged('Projects')
  dialog.save()
  const group = picker.state.organization.groups.find(
    g => g.name === 'Projects'
  )
  Assert.ok(group)
  const rename = new RepositoryGroupDialog({
    groupId: group.id,
    onDismissed() {},
  })
  rename.onNameChanged('Personal')
  rename.save()
  Assert.equal(
    picker.state.organization.groups.find(g => g.id === group.id).name,
    'Personal'
  )
  const header = picker.renderGroupHeader(group.id)
  picker.draggedRepository = repositories[1].id
  header.props.onDrop({
    currentTarget: { dataset: { group: group.id } },
    preventDefault() {},
    stopPropagation() {},
  })
  Assert.equal(
    picker.state.organization.assignments[activityKey(repositories[1].path)],
    group.id
  )
  Assert.equal(listElement().props.groups[0].identifier, '_Working_')
  Assert.equal(listElement().props.groups[0].items[0].repository.id, 2)
  Assert.equal(
    listElement().props.groups[0].items[0].workingGroupName,
    'Personal'
  )
  Assert.equal(
    listElement().props.groups.find(g => g.identifier === group.id).items.length,
    0
  )
  const clean = snapshot(0)
  picker.activityMonitor.notify({
    repositories: new Map(repositories.map(r => [activityKey(r.path), clean])),
    checking: false,
    completed: 2,
    total: 2,
  })
  Assert.equal(
    listElement().props.groups.find(g => g.identifier === group.id).items[0].id,
    '2'
  )
  const nextPicker = new RepositoriesList(props)
  Assert.equal(
    nextPicker.state.organization.assignments[
      activityKey(repositories[1].path)
    ],
    group.id
  )
  const { removeRepositoryGroup } = load(
    Path.join(root, 'app/src/lib/repository-activity/organization.ts')
  )
  picker.updateOrganization(
    removeRepositoryGroup(picker.state.organization, group.id)
  )
  Assert.equal(
    listElement().props.groups.find(g => g.identifier === '_Ungrouped_').items
      .length,
    2
  )
})
test('group dialog rejects empty, reserved, case, whitespace, and Unicode duplicates', () => {
  let dismissed = false
  const dialog = new RepositoryGroupDialog({
    groupId: null,
    onDismissed() {
      dismissed = true
    },
  })
  for (const name of [
    '',
    '  ',
    'WORKING',
    'Ungrouped',
    ' SHANE ',
    'ｓｈａｎｅ',
    'a'.repeat(81),
  ]) {
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
  other.onNameChanged('Concurrent')
  other.save()
  dialog.save()
  Assert.match(dialog.state.saveError, /already exists/)
  const {
    readRepositoryOrganization,
    removeRepositoryGroup,
    saveRepositoryOrganization,
  } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  const current = readRepositoryOrganization(localStorage)
  const id = current.groups.find(g => g.name === 'Concurrent').id
  saveRepositoryOrganization(localStorage, removeRepositoryGroup(current, id))
})
test('group dialog stays open on storage failure and cancel does not create anything', () => {
  const before = new Map(storage)
  let dismissed = false
  const dialog = new RepositoryGroupDialog({
    groupId: null,
    onDismissed() {
      dismissed = true
    },
  })
  dialog.onNameChanged('Not saved')
  const original = localStorage.setItem
  localStorage.setItem = () => {
    throw new Error('full')
  }
  try {
    dialog.save()
  } finally {
    localStorage.setItem = original
  }
  Assert.equal(dismissed, false)
  Assert.match(dialog.state.saveError, /Could not save/)
  dialog.props.onDismissed()
  Assert.deepEqual(storage, before)
})
test('group reorder persists, preserves assignments, and keeps fixed sections at the ends', () => {
  const { moveRepositoryGroup } = load(
    Path.join(root, 'app/src/lib/repository-activity/organization.ts')
  )
  const original = picker.state.organization
  const value = {
    groups: [
      { id: 'group-a', name: 'A' },
      { id: 'group-b', name: 'B' },
      { id: 'group-c', name: 'C' },
    ],
    assignments: { '/fixture/repo': 'group-a' },
  }
  picker.updateOrganization(value)
  picker.moveGroup('group-c', 'up')
  Assert.deepEqual(
    picker.state.organization.groups.map(g => g.id),
    ['group-a', 'group-c', 'group-b']
  )
  picker.draggedGroup = 'group-a'
  picker.onGroupDrop({
    currentTarget: {
      dataset: { group: '_Ungrouped_' },
      getBoundingClientRect: () => ({ top: 0, height: 29 }),
    },
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  })
  Assert.deepEqual(
    picker.state.organization.groups.map(g => g.id),
    ['group-c', 'group-b', 'group-a']
  )
  Assert.deepEqual(picker.state.organization.assignments, value.assignments)
  Assert.deepEqual(
    new RepositoriesList(props).state.organization.groups,
    picker.state.organization.groups
  )
  // Working and Recent are empty here, so they are hidden; when shown they
  // always precede the custom groups (see the projection tests).
  Assert.deepEqual(
    listElement().props.groups.map(g => g.identifier),
    ['group-c', 'group-b', 'group-a', '_Ungrouped_']
  )
  Assert.equal(moveRepositoryGroup(value, 'group-a', '_Working_'), value)
  Assert.equal(moveRepositoryGroup(value, '_Working_', 'group-a'), value)
  Assert.equal(moveRepositoryGroup(value, 'group-a', 'group-a'), value)
  picker.updateOrganization(original)
})
test('collapse survives recreation and reordering without changing membership', () => {
  const original = picker.state.organization
  const id = original.groups[0].id
  picker.suppressClickUntil = 0
  picker.onGroupToggle({
    currentTarget: { dataset: { group: id } },
    stopPropagation() {},
  })
  // Working and Recent cannot be collapsed.
  for (const derived of ['_Working_', '_Recent_']) {
    picker.onGroupToggle({
      currentTarget: { dataset: { group: derived } },
      stopPropagation() {},
    })
  }
  const fresh = new RepositoriesList(props)
  Assert.deepEqual(fresh.state.organization.collapsed, [id])
  Assert.deepEqual(fresh.state.organization.assignments, original.assignments)
  const {
    moveRepositoryGroup,
    removeRepositoryGroup,
    readRepositoryOrganization,
  } = load(Path.join(root, 'app/src/lib/repository-activity/organization.ts'))
  Assert.deepEqual(
    moveRepositoryGroup(fresh.state.organization, id, '_Ungrouped_').collapsed,
    [id]
  )
  Assert.deepEqual(
    removeRepositoryGroup(fresh.state.organization, id).collapsed,
    []
  )
  // A collapsed Working state stored by an earlier version is ignored.
  const invalid = {
    ...fresh.state.organization,
    collapsed: [id, id, '_Working_', '_Recent_', '_Ungrouped_', 'unknown', 2],
  }
  Assert.deepEqual(
    readRepositoryOrganization({ getItem: () => JSON.stringify(invalid) })
      .collapsed,
    [id, '_Ungrouped_']
  )
  picker.updateOrganization(original)
})
test('collapsed headers remain available and search reveals items temporarily', () => {
  const group = { identifier: 'group-test', items: rows }
  const options = {
    ...listProps,
    groups: [group],
    filterText: '',
    renderGroupHeader: () => null,
    collapsedGroupIds: new Set(['group-test']),
  }
  const collapsed = new SectionFilterList(options)
  Assert.deepEqual(visible(collapsed), [])
  Assert.equal(collapsed.state.rows.flat()[0].kind, 'group')
  Assert.equal(
    visible(new SectionFilterList({ ...options, filterText: 'project' }))
      .length,
    2
  )
  Assert.deepEqual(visible(new SectionFilterList(options)), [])
})
test('repository row drops highlight the destination group and dim the source', () => {
  const original = picker.state.organization
  const groups = [
    { id: 'group-source', name: 'Source' },
    { id: 'group-target', name: 'Target' },
  ]
  const sourceGroup = groups[0].id
  const targetGroup = groups[1].id
  picker.updateOrganization({
    groups,
    assignments: {
      [repositories[0].path]: targetGroup,
      [repositories[1].path]: sourceGroup,
    },
  })
  const event = (repositoryId, group, working = false) => ({
    currentTarget: {
      dataset: {
        repositoryId: String(repositoryId),
        working: String(working),
        ownerGroup: group,
      },
      getBoundingClientRect: () => ({ top: 0, height: 29 }),
    },
    clientY: 1,
    dataTransfer: { dropEffect: '' },
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  })
  picker.draggedRepository = repositories[1].id
  const targetEvent = event(repositories[0].id, targetGroup)
  picker.onRepositoryDragOver(targetEvent)
  Assert.equal(picker.state.dropGroup, targetGroup)
  Assert.equal(picker.state.dropPosition, null)
  Assert.equal(targetEvent.dataTransfer.dropEffect, 'move')
  const renderedRow = picker.renderItem(rows[0], {})
  Assert.equal(renderedRow.props.className, 'repository-activity-row')
  Assert.equal(
    listElement().props.getGroupSectionClassName(targetGroup),
    'repository-drop-group-section'
  )
  Assert.equal(
    listElement().props.getGroupSectionClassName(sourceGroup),
    'repository-drag-source-group'
  )
  Assert.equal(
    listElement().props.getGroupSectionClassName(WorkingGroup),
    undefined
  )
  Assert.equal(listElement().props.getItemClassName(rows[1]), undefined)
  const workingCopy = picker.renderItem(
    {
      ...rows[1],
      id: rows[1].id,
      workingGroupName: 'Source',
    },
    {}
  )
  Assert.equal(
    listElement().props.getItemClassName({
      ...rows[1],
      id: rows[1].id,
      workingGroupName: 'Source',
    }),
    'repository-drag-source'
  )
  Assert.equal(workingCopy.props.className, 'repository-activity-row')
  const header = picker.renderGroupHeader(targetGroup)
  Assert.ok(!header.props.className.includes('drop-target'))
  picker.onRepositoryDrop(event(repositories[0].id, targetGroup))
  const saved = new RepositoriesList(props).state.organization
  Assert.equal(saved.assignments[repositories[1].path], targetGroup)
  Assert.equal(saved.repositoryOrder, undefined)
  picker.draggedRepository = repositories[1].id
  picker.onRepositoryDrop(event(repositories[0].id, WorkingGroup, true))
  Assert.deepEqual(picker.state.organization, saved)
  Assert.equal(
    picker.renderItem(rows[0], {}).props.className,
    'repository-activity-row'
  )
  Assert.equal(listElement().props.getItemClassName(rows[1]), undefined)
  const targetHeader = picker.renderGroupHeader(targetGroup)
  Assert.ok(!targetHeader.props.className.includes('drop-target'))
  Assert.equal(header.props.draggable, true)
  picker.updateOrganization(original)
})

test('repository drag keeps the destination group stable across row and gap boundaries', () => {
  const original = picker.state.organization
  const sourceGroup = 'group-source'
  const targetGroup = 'group-target'
  picker.updateOrganization({
    groups: [
      { id: sourceGroup, name: 'Source' },
      { id: targetGroup, name: 'Target' },
    ],
    assignments: {
      [repositories[0].path]: targetGroup,
      [repositories[1].path]: sourceGroup,
    },
  })

  const section = group => ({
    dataset: { group },
  })
  const rowTarget = (repositoryId, group) => {
    const row = {
      dataset: {
        repositoryId: String(repositoryId),
        itemId: String(repositoryId),
        ownerGroup: group,
      },
    }
    return {
      currentTarget: row,
      element: {
        closest: selector => {
          if (selector === '.repository-activity-row') return row
          if (selector === '.filter-list-group-header[data-group]') return null
          if (selector === '.ReactVirtualized__Grid[data-group]') {
            return section(group)
          }
          return null
        },
      },
    }
  }
  const gapTarget = group => ({
    closest: selector =>
      selector === '.ReactVirtualized__Grid[data-group]'
        ? section(group)
        : null,
  })
  const event = (currentTarget, relatedTarget = null) => ({
    currentTarget: currentTarget.currentTarget ?? currentTarget,
    relatedTarget: relatedTarget?.element ?? relatedTarget,
    target: relatedTarget?.element ?? relatedTarget,
    clientX: 1,
    clientY: 1,
    dataTransfer: { dropEffect: '' },
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  })

  picker.draggedRepository = repositories[1].id
  const firstRow = rowTarget(repositories[0].id, targetGroup)
  picker.onRepositoryDragOver(event(firstRow))
  Assert.equal(picker.state.dropGroup, targetGroup)

  // Moving between descendants of two different rows in the same group keeps
  // the section border mounted without a row-specific preview.
  const secondRow = rowTarget(repositories[0].id, targetGroup)
  picker.onListDragOver({
    currentTarget: {},
    target: secondRow.element,
    dataTransfer: { dropEffect: '' },
    preventDefault() {},
    stopPropagation() {},
  })
  Assert.equal(picker.state.dropGroup, targetGroup)

  // Moving from a row into the section's empty space keeps the group target;
  // the list capture handler keeps the group-level preview.
  const gap = gapTarget(targetGroup)
  picker.onListDragOver({
    currentTarget: {},
    target: gap,
    dataTransfer: { dropEffect: '' },
    preventDefault() {},
    stopPropagation() {},
  })
  Assert.equal(picker.state.dropGroup, targetGroup)

  // Header-to-row transitions use the same section identity as row-to-row
  // transitions, including when the header is the current event target.
  const header = {
    dataset: { group: targetGroup },
  }
  picker.onGroupDragOver({
    currentTarget: header,
    dataTransfer: { dropEffect: '' },
    preventDefault() {},
    stopPropagation() {},
  })
  picker.onGroupDragLeave(event(header, secondRow))
  Assert.equal(picker.state.dropGroup, targetGroup)

  // Chromium can expose a null relatedTarget for dragleave. Resolve the
  // pointer position against the list before clearing the target.
  const originalElementFromPoint = document.elementFromPoint
  document.elementFromPoint = () => secondRow.element
  picker.onListDragLeave({
    currentTarget: { contains: () => true },
    relatedTarget: null,
    clientX: 1,
    clientY: 1,
  })
  Assert.equal(picker.state.dropGroup, targetGroup)
  document.elementFromPoint = originalElementFromPoint

  // Entering the original group is an explicit no-op and clears the target.
  const sameGroupRow = rowTarget(repositories[1].id, sourceGroup)
  picker.onRepositoryDragOver(event(sameGroupRow))
  Assert.equal(picker.state.dropGroup, null)
  picker.onRepositoryDragOver(event(firstRow))
  Assert.equal(picker.state.dropGroup, targetGroup)
  // An ambiguous list dragleave is ignored; the document boundary handler
  // clears the preview once the pointer is confirmed outside the list.
  picker.onListDragLeave({
    currentTarget: { contains: () => false },
    relatedTarget: null,
    clientX: 1,
    clientY: 1,
  })
  Assert.equal(picker.state.dropGroup, targetGroup)
  picker.repositoryListElement = { contains: () => false }
  picker.onDocumentDragOver({
    target: null,
    clientX: 1,
    clientY: 1,
  })
  Assert.equal(picker.state.dropGroup, null)

  // A drop on the section's gap is handled by the list capture boundary and
  // still assigns the repository to that section.
  picker.draggedRepository = repositories[1].id
  picker.onRepositoryDragOver(event(firstRow))
  picker.onListDrop({
    target: gap,
    dataTransfer: { dropEffect: 'move' },
    preventDefault() {},
    stopPropagation() {},
  })
  Assert.equal(
    picker.state.organization.assignments[repositories[1].path],
    targetGroup
  )

  picker.updateOrganization(original)
})

test('repository drops on itself or its current group are rejected', () => {
  const original = picker.state.organization
  const group = original.groups[0].id
  picker.updateOrganization({
    ...original,
    assignments: {
      [repositories[0].path]: group,
      [repositories[1].path]: group,
    },
  })
  const event = (repositoryId, ownerGroup = group) => {
    const dataTransfer = { dropEffect: '' }
    return {
      currentTarget: {
        dataset: {
          repositoryId: String(repositoryId),
          working: 'false',
          ownerGroup,
        },
      },
      dataTransfer,
      preventDefault() {
        this.prevented = true
      },
      stopPropagation() {
        this.stopped = true
      },
    }
  }

  picker.draggedRepository = repositories[1].id
  const selfEvent = event(repositories[1].id)
  picker.onRepositoryDragOver(selfEvent)
  Assert.equal(selfEvent.dataTransfer.dropEffect, 'none')
  Assert.equal(picker.state.dropGroup, null)

  const before = JSON.stringify(picker.state.organization)
  picker.onRepositoryDrop(event(repositories[1].id))
  Assert.equal(JSON.stringify(picker.state.organization), before)

  picker.draggedRepository = repositories[1].id
  const sameGroup = event(repositories[0].id)
  picker.onRepositoryDragOver(sameGroup)
  Assert.equal(sameGroup.dataTransfer.dropEffect, 'none')
  Assert.equal(picker.state.dropGroup, null)
  picker.onRepositoryDrop(sameGroup)
  Assert.equal(JSON.stringify(picker.state.organization), before)

  picker.draggedRepository = repositories[0].id
  const ungrouped = {
    currentTarget: { dataset: { group: '_Ungrouped_' } },
    dataTransfer: { dropEffect: '' },
    preventDefault() {},
    stopPropagation() {},
  }
  picker.onGroupDragOver(ungrouped)
  Assert.equal(ungrouped.dataTransfer.dropEffect, 'move')
  Assert.equal(picker.state.dropGroup, '_Ungrouped_')
  Assert.ok(
    !picker
      .renderGroupHeader('_Ungrouped_')
      .props.className.includes('drop-target')
  )
  picker.onRepositoryDragEnd()
  picker.updateOrganization(original)
})
test('list-wide slots are available only for custom group drags', () => {
  const { findRepositoryDropSlot: find } = load(
    Path.join(root, 'app/src/lib/repository-activity/drag.ts')
  )
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
  Assert.equal(find(rows, 118, null, 4), null)
  Assert.equal(find(rows, 86, null, 4), null)
  Assert.equal(find(rows, 135, 'group-b', null).group, 'group-a')
  Assert.equal(find(rows, 135, 'group-b', null).position, 'after')
  Assert.equal(find(rows, 290, null, 4), null)
  Assert.equal(find(rows, 290, 'group-a', null).group, 'group-b')
  Assert.equal(find(rows, 290, 'group-a', null).position, 'after')
})
test('list-wide group drop slots reject Working and Recent', () => {
  const { findRepositoryDropSlot: find } = load(
    Path.join(root, 'app/src/lib/repository-activity/drag.ts')
  )
  const rows = [
    { top: 0, bottom: 29, group: '_Working_' },
    { top: 29, bottom: 58, group: '_Working_', repositoryId: 1 },
    { top: 58, bottom: 87, group: '_Recent_' },
    { top: 87, bottom: 116, group: '_Recent_', repositoryId: 2 },
    { top: 116, bottom: 145, group: 'group-a' },
    { top: 145, bottom: 174, group: 'group-a', repositoryId: 2 },
    { top: 174, bottom: 203, group: '_Ungrouped_' },
  ]
  Assert.equal(find(rows, 10, 'group-a', null), null)
  Assert.equal(find(rows, 45, 'group-a', null), null)
  Assert.equal(find(rows, 70, 'group-a', null), null)
  Assert.equal(find(rows, 100, 'group-a', null), null)
  Assert.equal(find(rows, 150, null, 2), null)
  // The nearest slot below Recent is before the first custom group.
  Assert.deepEqual(find(rows, 117, 'group-b', null), {
    group: 'group-a',
    y: 116,
    position: 'before',
  })
})
test('repository drags never resolve list-wide source slots', () => {
  const { findRepositoryDropSlot: find } = load(
    Path.join(root, 'app/src/lib/repository-activity/drag.ts')
  )
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
test('container drops do not persist repository order', () => {
  const original = picker.state.organization
  picker.draggedRepository = repositories[1].id
  picker.dropSlot = {
    repositoryId: repositories[0].id,
    group: '_Ungrouped_',
    position: 'before',
    y: 100,
  }
  picker.onListDrop({ preventDefault() {}, stopPropagation() {} })
  Assert.equal(picker.state.organization.repositoryOrder, undefined)
  Assert.equal(
    picker.state.organization.assignments[repositories[1].path],
    undefined
  )
  Assert.equal(picker.dropSlot, null)
  picker.updateOrganization(original)
})
test('group drag preview keeps virtualized headers in their layout slots', () => {
  const originalCreateElement = document.createElement
  const originalBody = document.body
  const originalOrganization = picker.state.organization
  const bodyChildren = []
  const sourceListItem = {
    style: { removeProperty() {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 29 }),
  }
  const targetListItem = {
    style: { removeProperty() {} },
    getBoundingClientRect: () => ({ top: 29, bottom: 58 }),
  }
  const sourceHeader = {
    dataset: { group: 'group-a' },
    closest: () => sourceListItem,
  }
  const targetHeader = {
    dataset: { group: 'group-b' },
    closest: () => targetListItem,
  }
  const scroll = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    querySelectorAll: selector =>
      selector ===
      '.filter-list-group-header[data-group], .repository-activity-row'
        ? [
            {
              dataset: { group: '_Working_' },
              closest: () => ({
                getBoundingClientRect: () => ({ top: 0, bottom: 10 }),
              }),
            },
            sourceHeader,
            targetHeader,
          ]
        : [],
  }
  const added = []
  let addCount = 0
  const dragList = {
    getBoundingClientRect: () => ({ top: 0 }),
    classList: {
      remove() {},
      add() {
        addCount++
      },
    },
    querySelector: selector =>
      selector === '.ReactVirtualized__Grid' ? scroll : null,
    querySelectorAll: selector =>
      selector === '.list-item' ? [sourceListItem, targetListItem] : [],
    appendChild: element => added.push(element),
  }
  document.body = { appendChild: element => bodyChildren.push(element) }
  document.createElement = () => {
    const element = {
      className: '',
      style: {},
      textContent: '',
      removed: false,
    }
    element.remove = () => {
      element.removed = true
    }
    return element
  }
  try {
    let dragImageCall
    const groupId = originalOrganization.groups[0].id
    picker.onGroupReorderStart({
      currentTarget: { dataset: { group: groupId } },
      dataTransfer: {
        setData() {},
        effectAllowed: '',
        setDragImage: (image, x, y) => {
          dragImageCall = { image, x, y }
        },
      },
      stopPropagation() {},
    })
    Assert.equal(bodyChildren.length, 1)
    Assert.equal(bodyChildren[0].className, 'repository-group-drag-image')
    Assert.equal(bodyChildren[0].textContent, 'shane')
    Assert.deepEqual(dragImageCall, { image: bodyChildren[0], x: 10, y: 13 })
    picker.onRepositoryDragEnd()
    Assert.equal(bodyChildren[0].removed, true)

    picker.draggedRepository = null
    picker.draggedGroup = 'group-a'
    picker.onListDragOver({
      currentTarget: dragList,
      clientY: 40,
      dataTransfer: { dropEffect: '' },
      preventDefault() {},
      stopPropagation() {},
    })
    picker.onRepositoryDragEnd()
    Assert.equal(addCount, 0)
    Assert.equal(sourceListItem.style.transform, undefined)
    Assert.equal(targetListItem.style.transform, undefined)
    Assert.equal(added.length, 1)
    Assert.equal(
      added[0].className,
      'repository-drop-placeholder repository-group-drop-placeholder'
    )
    Assert.equal(added[0].style.top, '28px')
    Assert.equal(added[0].textContent, '')
    picker.draggedGroup = 'group-a'
    picker.onListDragOver({
      currentTarget: dragList,
      clientY: 5,
      dataTransfer: { dropEffect: '' },
      preventDefault() {},
      stopPropagation() {},
    })
    Assert.equal(picker.dropSlot, null)
  } finally {
    document.createElement = originalCreateElement
    document.body = originalBody
    picker.onRepositoryDragEnd()
    picker.updateOrganization(originalOrganization)
  }
})
/** Depth-first search of a stubbed React element tree. */
const findElements = (node, predicate, found = []) => {
  if (Array.isArray(node)) {
    node.forEach(child => findElements(child, predicate, found))
  } else if (node && typeof node === 'object' && node.props) {
    if (predicate(node)) found.push(node)
    findElements(node.props.children, predicate, found)
  }
  return found
}
const hasClass = name => node =>
  typeof node.props.className === 'string' &&
  node.props.className.split(' ').includes(name)
/** Clean repositories whose latest commits make both of them Recent. */
const notifyRecent = (counts = [0, 0]) =>
  picker.activityMonitor.notify({
    repositories: new Map(
      repositories.map((r, i) => [
        activityKey(r.path),
        { ...snapshot(counts[i]), lastCommitAt: 500 - i * 100 },
      ])
    ),
    checking: false,
    completed: 2,
    total: 2,
  })
const section = id =>
  listElement().props.groups.find(group => group.identifier === id)
test('Working and Recent headers have no collapse toggle and are labeled', () => {
  picker.props = { ...props, filterText: '' }
  for (const [id, label] of [
    [WorkingGroup, 'Working'],
    [RecentGroup, 'Recent'],
  ]) {
    const header = picker.renderGroupHeader(id)
    Assert.equal(findElements(header, hasClass('repository-group-toggle')).length, 0)
    Assert.equal(header.props.draggable, false)
    Assert.ok(header.props.className.split(' ').includes('repository-derived-group'))
    Assert.ok(!header.props.className.split(' ').includes('repository-custom-group'))
    const title = findElements(header, hasClass('repository-group-title'))
    Assert.equal(title.length, 1)
    Assert.equal(
      findElements(title, hasClass('repository-group-label'))[0].props
        .children[0],
      label
    )
    Assert.ok(!header.props['aria-label'].includes('drag a repository here'))
  }
  const custom = picker.renderGroupHeader(picker.state.organization.groups[0].id)
  Assert.equal(findElements(custom, hasClass('repository-group-toggle')).length, 1)
  const ungrouped = picker.renderGroupHeader('_Ungrouped_')
  Assert.equal(findElements(ungrouped, hasClass('repository-group-toggle')).length, 1)
})
test('empty Working and Recent sections are hidden', () => {
  picker.props = { ...props, filterText: '' }
  const derived = () =>
    listElement()
      .props.groups.map(group => group.identifier)
      .filter(id => id === WorkingGroup || id === RecentGroup)
  notifyRecent([0, 0])
  Assert.deepEqual(derived(), [RecentGroup])
  Assert.equal(listElement().props.groups[0].identifier, RecentGroup)
  notifyRecent([1, 0])
  Assert.deepEqual(derived(), [WorkingGroup, RecentGroup])
  Assert.deepEqual(section(RecentGroup).items.map(r => r.id), ['recent:2'])
  notifyRecent([1, 1])
  Assert.deepEqual(derived(), [WorkingGroup])
  // Neither section has rows: no empty box or headings remain.
  picker.activityMonitor.notify({
    repositories: new Map(
      repositories.map(r => [activityKey(r.path), snapshot(0)])
    ),
    checking: false,
    completed: 2,
    total: 2,
  })
  Assert.deepEqual(derived(), [])
  Assert.ok(listElement().props.groups.length > 0)
  Assert.equal(picker.groupCounts.get(WorkingGroup), 0)
  Assert.equal(picker.groupCounts.get(RecentGroup), 0)
})
test('Recent rows open their repository, show the saved group, and highlight both copies', () => {
  let opened = null
  picker.props = {
    ...props,
    filterText: '',
    onSelectionChanged: repository => {
      opened = repository
    },
    dispatcher: { ...props.dispatcher, recordRepoClicked() {} },
  }
  picker.setState({ selectedItem: null })
  notifyRecent([0, 0])
  const recent = section(RecentGroup).items
  Assert.deepEqual(recent.map(r => r.id), ['recent:1', 'recent:2'])
  const saved = listElement()
    .props.groups.filter(g => g.identifier !== RecentGroup)
    .flatMap(g => g.items)
  Assert.deepEqual(saved.map(r => r.id).sort(), ['1', '2'])
  const savedRow = id => saved.find(r => r.id === id)
  const className = item => listElement().props.getItemClassName(item)

  // Without a keyboard selection the first copy of the selected repository is
  // the anchor; its other copy is highlighted too.
  Assert.equal(listElement().props.selectedItem.id, 'recent:1')
  Assert.equal(className(recent[0]), undefined)
  Assert.equal(className(savedRow('1')), 'repository-selected-duplicate')
  Assert.equal(className(recent[1]), undefined)
  Assert.equal(className(savedRow('2')), undefined)
  // The list maps the selection to the anchor row only, not the last copy.
  const list = new SectionFilterList(listElement().props)
  const selected = list.state.rows[list.state.selectedRow.section][list.state.selectedRow.row]
  Assert.equal(selected.item.id, 'recent:1')

  // Keyboard selection on the saved copy keeps that row as the anchor.
  picker.onListSelectionChanged(savedRow('1'))
  Assert.equal(listElement().props.selectedItem.id, '1')
  Assert.equal(className(recent[0]), 'repository-selected-duplicate')
  Assert.equal(className(savedRow('1')), undefined)

  // A selected Recent row follows its repository when it leaves Recent.
  picker.onListSelectionChanged(recent[1])
  Assert.equal(listElement().props.selectedItem.id, 'recent:2')
  notifyRecent([0, 1])
  Assert.equal(listElement().props.selectedItem.id, '2')
  Assert.equal(section(WorkingGroup).items[0].id, '2')
  notifyRecent([0, 0])

  // Activating a Recent row opens that repository.
  picker.suppressClickUntil = 0
  picker.onItemClick(recent[0], { kind: 'mouseclick' })
  Assert.equal(opened, repositories[0])

  // The row carries the saved group tag and rejects drops onto Recent.
  const element = picker.renderItem(recent[0], {})
  Assert.equal(element.props['data-owner-group'], RecentGroup)
  Assert.equal(element.props['data-item-id'], 'recent:1')
  Assert.equal(element.props.draggable, true)
  const tag = findElements(element, hasClass('repository-working-group'))
  Assert.equal(tag.length, 1)
  Assert.equal(tag[0].props.tooltip, `Group: ${recent[0].recentGroupName}`)
  Assert.match(
    picker.getItemAriaLabel(recent[0]),
    new RegExp(`^z-project, group ${recent[0].recentGroupName}, `)
  )
  Assert.equal(
    findElements(picker.renderItem(savedRow('1'), {}), hasClass('repository-working-group')).length,
    0
  )
  picker.setState({ selectedItem: null })
  picker.props = { ...props, filterText: '' }
})
test('Recent is never a repository or group drop target', () => {
  const original = picker.state.organization
  const group = original.groups[0].id
  picker.updateOrganization({
    ...original,
    assignments: { [repositories[0].path]: group },
  })
  const before = JSON.stringify(picker.state.organization)
  const event = dataset => ({
    currentTarget: {
      dataset,
      getBoundingClientRect: () => ({ top: 0, height: 29 }),
    },
    target: {
      closest: selector =>
        selector === '.repository-activity-row'
          ? { dataset: { ownerGroup: RecentGroup } }
          : null,
    },
    clientY: 20,
    dataTransfer: { dropEffect: '' },
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {},
  })

  // Repository drags onto the Recent heading, a Recent row, or its body.
  picker.draggedRepository = repositories[1].id
  const header = event({ group: RecentGroup })
  picker.onGroupDragOver(header)
  Assert.equal(header.dataTransfer.dropEffect, 'none')
  Assert.equal(header.prevented, undefined)
  Assert.equal(picker.state.dropGroup, null)
  picker.onGroupDrop(event({ group: RecentGroup }))
  Assert.equal(JSON.stringify(picker.state.organization), before)
  picker.draggedRepository = repositories[1].id
  const rowEvent = event({
    repositoryId: String(repositories[0].id),
    working: 'false',
    ownerGroup: RecentGroup,
  })
  picker.onRepositoryDragOver(rowEvent)
  Assert.equal(rowEvent.dataTransfer.dropEffect, 'none')
  picker.onRepositoryDrop(rowEvent)
  Assert.equal(JSON.stringify(picker.state.organization), before)
  picker.draggedRepository = repositories[1].id
  picker.onListDrop(event({}))
  Assert.equal(JSON.stringify(picker.state.organization), before)

  // Dragging a Recent row onto a custom group assigns its repository.
  picker.draggedRepository = repositories[1].id
  picker.onGroupDrop(event({ group }))
  Assert.equal(picker.state.organization.assignments[repositories[1].path], group)

  // Group reordering cannot target Recent either.
  picker.draggedGroup = group
  const groupDrag = event({ group: RecentGroup })
  picker.onGroupDragOver(groupDrag)
  Assert.equal(groupDrag.prevented, undefined)
  Assert.equal(picker.state.dropGroup, null)
  picker.onRepositoryDragEnd()
  picker.updateOrganization(original)
})
test('ticks use half the interval as their freshness window', () => {
  const before = picker.activityMonitor.refreshes
  tick()
  Assert.equal(picker.activityMonitor.refreshes, before + 1)
  Assert.deepEqual(picker.activityMonitor.refreshOptions.at(-1), {
    maxAge: 7500,
  })
})
test('inactive window does not start scheduled scans; focus forces one', () => {
  const before = picker.activityMonitor.refreshes
  document.hasFocus = () => false
  tick()
  Assert.equal(picker.activityMonitor.refreshes, before)
  listeners.get('focus')()
  Assert.equal(picker.activityMonitor.refreshes, before + 1)
  Assert.deepEqual(picker.activityMonitor.refreshOptions.at(-1), { maxAge: 0 })
})
test('unmount stops queued work and removes timer and listeners', () => {
  picker.componentWillUnmount()
  Assert.equal(picker.activityMonitor.stopped, true)
  Assert.equal(cleared, true)
  Assert.equal(listeners.size, 0)
})
console.log(`\n${passed}/${passed} UI wiring tests passed (stubbed React/DOM).`)
