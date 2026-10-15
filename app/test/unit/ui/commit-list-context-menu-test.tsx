import assert from 'node:assert'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { resolve } from 'node:path'
import * as React from 'react'

import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import type { IMenuItem } from '../../../src/lib/menu-item'
import type { CommitList as CommitListType } from '../../../src/ui/history/commit-list'
import { gitHubRepoFixture } from '../../helpers/github-repo-builder'
import { captureClipboardWrites } from '../../helpers/ui/electron'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const ListWidth = 300
const ListHeight = 300

/** Reports a fixed size so the virtualized commit rows are rendered. */
class TestListResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    Object.defineProperty(target, 'offsetWidth', {
      configurable: true,
      value: ListWidth,
    })
    Object.defineProperty(target, 'offsetHeight', {
      configurable: true,
      value: ListHeight,
    })

    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    )
  }

  public unobserve() {}

  public disconnect() {}
}

const shownMenus = new Array<ReadonlyArray<IMenuItem>>()

mock.module(resolve('app/src/lib/menu-item.ts'), {
  namedExports: {
    showContextualMenu: async (items: ReadonlyArray<IMenuItem>) => {
      shownMenus.push(items)
    },
    getPlatformSpecificNameOrSymbolForModifier: (modifier: string) => modifier,
  },
})

let CommitList: typeof CommitListType

before(async () => {
  CommitList = (await import('../../../src/ui/history/commit-list')).CommitList
})

let originalResizeObserver: typeof ResizeObserver | undefined

beforeEach(() => {
  shownMenus.length = 0
  originalResizeObserver = window.ResizeObserver
  Object.assign(window, { ResizeObserver: TestListResizeObserver })
})

afterEach(() => {
  Object.assign(window, { ResizeObserver: originalResizeObserver })
})

const gitHubRepository = gitHubRepoFixture({
  owner: 'desktop',
  name: 'desktop',
})

function createCommit(sha: string, summary: string, tags: string[] = []) {
  const identity = new CommitIdentity(
    'Test User',
    'test@example.com',
    new Date('2026-01-01T00:00:00.000Z')
  )

  return new Commit(
    sha,
    sha.slice(0, 7),
    summary,
    '',
    identity,
    identity,
    [],
    [],
    tags
  )
}

const pushedCommit = createCommit(
  '1111111111111111111111111111111111111111',
  'Pushed change',
  ['v1.0.0', 'v1.0.1']
)
const localCommit = createCommit(
  '2222222222222222222222222222222222222222',
  'Local change'
)

type CommitListProps = React.ComponentProps<typeof CommitListType>

function renderCommitList(overrides: Partial<CommitListProps> = {}) {
  const commits = [pushedCommit, localCommit]
  const props: CommitListProps = {
    gitHubRepository,
    isLocalRepository: false,
    commitSHAs: commits.map(commit => commit.sha),
    commitLookup: new Map(commits.map(commit => [commit.sha, commit])),
    selectedSHAs: [],
    localCommitSHAs: [localCommit.sha],
    emoji: new Map(),
    accounts: [],
    preferAbsoluteDates: false,
    ...overrides,
  }

  return render(<CommitList {...props} />)
}

async function openContextMenu(summary: string) {
  const row = await waitFor(() => screen.getByText(summary))
  fireEvent.contextMenu(row)
  await waitFor(() => assert.equal(shownMenus.length, 1))
  return shownMenus[0]
}

function labels(items: ReadonlyArray<IMenuItem>) {
  return items.map(item => (item.type === 'separator' ? '-' : item.label))
}

function findItem(items: ReadonlyArray<IMenuItem>, label: string) {
  const item = items.find(candidate => candidate.label === label)
  assert.ok(item !== undefined, `expected a "${label}" menu item`)
  return item
}

describe('CommitList read-only context menu', () => {
  it('offers only navigation and copy actions for a pushed commit', async () => {
    const viewedInHistory = new Array<string>()
    const viewedOnGitHub = new Array<string>()
    renderCommitList({
      readOnlyContextMenu: true,
      onViewCommitInHistory: sha => viewedInHistory.push(sha),
      onViewCommitOnGitHub: sha => viewedOnGitHub.push(sha),
    })

    const items = await openContextMenu(pushedCommit.summary)

    assert.deepEqual(labels(items), [
      'View in history',
      '-',
      'Copy SHA',
      'Copy tags',
      'View on GitHub',
    ])
    assert.ok(items.every(item => item.enabled !== false))

    findItem(items, 'View in history').action?.()
    findItem(items, 'View on GitHub').action?.()
    assert.deepEqual(viewedInHistory, [pushedCommit.sha])
    assert.deepEqual(viewedOnGitHub, [pushedCommit.sha])

    const clipboard = captureClipboardWrites()
    try {
      findItem(items, 'Copy SHA').action?.()
      findItem(items, 'Copy tags').action?.()
    } finally {
      clipboard.restore()
    }
    assert.deepEqual(clipboard.writes, [pushedCommit.sha, 'v1.0.0 v1.0.1'])
  })

  it('omits tag and GitHub items that are unavailable', async () => {
    renderCommitList({
      readOnlyContextMenu: true,
      onViewCommitInHistory: () => {},
      onViewCommitOnGitHub: () => {},
    })

    const items = await openContextMenu(localCommit.summary)

    assert.deepEqual(labels(items), ['View in history', '-', 'Copy SHA'])
  })

  it('omits actions without a handler or a GitHub repository', async () => {
    renderCommitList({
      readOnlyContextMenu: true,
      gitHubRepository: null,
      onViewCommitOnGitHub: () => {},
    })

    const items = await openContextMenu(pushedCommit.summary)

    assert.deepEqual(labels(items), ['Copy SHA', 'Copy tags'])
  })

  it('keeps the full commit menu when the read-only menu is not requested', async () => {
    renderCommitList({ onViewCommitInHistory: () => {} })

    const items = await openContextMenu(pushedCommit.summary)

    assert.ok(labels(items).includes('Create branch from commit'))
    assert.ok(!labels(items).includes('View in history'))
    assert.deepEqual(labels(items).slice(-4), [
      '-',
      'Copy SHA',
      'Copy tags',
      'View on GitHub',
    ])
    assert.equal(findItem(items, 'Copy SHA').enabled, undefined)
    assert.equal(findItem(items, 'Copy tags').enabled, true)
    assert.equal(findItem(items, 'View on GitHub').enabled, true)

    shownMenus.length = 0
    const localItems = await openContextMenu(localCommit.summary)

    assert.equal(findItem(localItems, 'Copy SHA').enabled, undefined)
    assert.equal(findItem(localItems, 'Copy tag').enabled, false)
    assert.equal(findItem(localItems, 'View on GitHub').enabled, false)
  })
})
