import assert from 'node:assert'
import { before, describe, it, mock } from 'node:test'
import { resolve } from 'node:path'
import * as React from 'react'

import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { Repository } from '../../../src/models/repository'
import type { IFileHistoryPanelProps } from '../../../src/ui/file-history/file-history-panel'
import { fireEvent, render, screen } from '../../helpers/ui/render'

/**
 * FileHistoryPanel delegates rendering the history rows to the full history
 * list. Keep these tests focused on the panel's mapping from a selected
 * commit back to its file-history entry rather than on virtualization and
 * commit-row rendering (which have their own surface).
 */
interface ICommitListTestProps {
  readonly commitSHAs: ReadonlyArray<string>
  readonly commitLookup: Map<string, Commit>
  readonly onCommitsSelected?: (
    commits: ReadonlyArray<Commit>,
    isContiguous: boolean
  ) => void
  readonly emptyListMessage?: React.ReactNode
}

function TestCommitList({
  commitSHAs,
  commitLookup,
  onCommitsSelected,
  emptyListMessage,
}: ICommitListTestProps) {
  const firstCommit = commitSHAs[0]
    ? commitLookup.get(commitSHAs[0])
    : undefined

  return (
    <div data-testid="test-commit-list">
      {firstCommit === undefined ? (
        <div>{emptyListMessage}</div>
      ) : (
        <button
          type="button"
          onClick={() => onCommitsSelected?.([firstCommit], true)}
        >
          Select {firstCommit.summary}
        </button>
      )}
    </div>
  )
}

mock.module(resolve('app/src/ui/history/commit-list.tsx'), {
  namedExports: { CommitList: TestCommitList },
})

let FileHistoryPanel: React.ComponentType<IFileHistoryPanelProps>

before(async () => {
  FileHistoryPanel = (
    await import('../../../src/ui/file-history/file-history-panel')
  ).FileHistoryPanel
})

type FileHistoryEntry = IFileHistoryPanelProps['entries'][number]

const repository = new Repository('/tmp/file-history-test', 1, null, false)

function createCommit(sha: string, summary: string) {
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
    []
  )
}

function createEntry(commit: Commit): FileHistoryEntry {
  // The panel only relies on the commit identity. Keep the test independent
  // of additional metadata added to the history entry contract.
  return { commit } as FileHistoryEntry
}

function renderPanel(overrides: Partial<IFileHistoryPanelProps> = {}) {
  const firstCommit = createCommit(
    '1111111111111111111111111111111111111111',
    'First change'
  )
  const secondCommit = createCommit(
    '2222222222222222222222222222222222222222',
    'Second change'
  )
  const entries = [createEntry(firstCommit), createEntry(secondCommit)]

  const onHistoryHeightChanged = () => {}
  const onHistoryHeightReset = () => {}
  const onEntrySelected = () => {}

  const props: IFileHistoryPanelProps = {
    repository,
    path: 'src/example.ts',
    entries,
    selectedEntry: null,
    isLoading: false,
    historyHeight: 200,
    minimumHistoryHeight: 120,
    maximumHistoryHeight: 400,
    onHistoryHeightChanged,
    onHistoryHeightReset,
    onEntrySelected,
    children: <div data-testid="diff-view">Current diff</div>,
    ...overrides,
  }

  return { view: render(<FileHistoryPanel {...props} />), entries }
}

describe('FileHistoryPanel', () => {
  it('maps a selected commit back to the corresponding file history entry', () => {
    const selectedEntries: FileHistoryEntry[] = []
    const { entries } = renderPanel({
      onEntrySelected: entry => selectedEntries.push(entry),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select First change' }))

    assert.deepEqual(selectedEntries, [entries[0]])
  })

  it('returns to the working directory when the dirty row is clicked', () => {
    let returnCount = 0
    renderPanel({
      onReturnToWorkingDirectory: () => {
        returnCount++
      },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Dirty working directory changes' })
    )

    assert.equal(returnCount, 1)
  })

  it('marks the dirty row as selected when viewing current changes', () => {
    renderPanel({
      onReturnToWorkingDirectory: () => {},
      isWorkingDirectorySelected: true,
    })

    assert.equal(
      screen
        .getByRole('button', { name: 'Dirty working directory changes' })
        .getAttribute('aria-pressed'),
      'true'
    )
  })

  it('shows loading and empty history states', () => {
    const { view } = renderPanel({ entries: [], isLoading: true })

    assert.ok(screen.getByText('Loading file history…'))

    view.rerender(
      <FileHistoryPanel
        repository={repository}
        path="src/example.ts"
        entries={[]}
        selectedEntry={null}
        isLoading={false}
        historyHeight={200}
        minimumHistoryHeight={120}
        maximumHistoryHeight={400}
        onHistoryHeightChanged={() => {}}
        onHistoryHeightReset={() => {}}
        onEntrySelected={() => {}}
        children={<div data-testid="diff-view">Current diff</div>}
      />
    )

    assert.ok(screen.getByText('No history for this file'))
  })

  it('renders the history region and diff content together', () => {
    renderPanel({ onReturnToWorkingDirectory: () => {} })

    assert.ok(
      screen.getByRole('region', { name: 'File history for src/example.ts' })
    )
    assert.equal(screen.queryByText('File history'), null)
    assert.equal(screen.queryByText('src/example.ts'), null)
    assert.ok(screen.getByTestId('diff-view'))
  })
})
