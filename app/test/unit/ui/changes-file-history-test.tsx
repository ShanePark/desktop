import assert from 'node:assert'
import { before, beforeEach, describe, it, mock } from 'node:test'
import { resolve } from 'node:path'
import * as React from 'react'

import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import {
  DiffSelection,
  DiffSelectionType,
  DiffType,
} from '../../../src/models/diff'
import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  CommittedFileChange,
  WorkingDirectoryFileChange,
} from '../../../src/models/status'
import type { IFileHistoryEntry } from '../../../src/lib/git/file-history'
import type { IChangesProps } from '../../../src/ui/changes/changes'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

interface IDiffHeaderTestProps {
  readonly onFileHistoryToggle?: () => void
}

function TestDiffHeader({ onFileHistoryToggle }: IDiffHeaderTestProps) {
  return (
    <button type="button" onClick={onFileHistoryToggle}>
      File history
    </button>
  )
}

interface ISeamlessDiffSwitcherTestProps {
  readonly readOnly: boolean
  readonly diff: unknown
}

function TestSeamlessDiffSwitcher({
  readOnly,
  diff,
}: ISeamlessDiffSwitcherTestProps) {
  return (
    <div data-testid="test-diff">
      {readOnly ? 'Historical diff' : 'Current diff'}
      {diff === null ? ' (loading)' : ''}
    </div>
  )
}

interface IFileHistoryPanelTestProps {
  readonly entries: ReadonlyArray<IFileHistoryEntry>
  readonly isLoading: boolean
  readonly onEntrySelected: (entry: IFileHistoryEntry) => void
  readonly onReturnToWorkingDirectory?: () => void
  readonly children: React.ReactNode
}

function TestFileHistoryPanel({
  entries,
  isLoading,
  onEntrySelected,
  onReturnToWorkingDirectory,
  children,
}: IFileHistoryPanelTestProps) {
  return (
    <div data-testid="test-file-history-panel">
      {isLoading && <div>Loading file history…</div>}
      {onReturnToWorkingDirectory !== undefined && (
        <button type="button" onClick={onReturnToWorkingDirectory}>
          Dirty
        </button>
      )}
      {entries.map(entry => (
        <button
          key={entry.commit.sha}
          type="button"
          onClick={() => onEntrySelected(entry)}
        >
          {entry.commit.summary}
        </button>
      ))}
      {children}
    </div>
  )
}

interface IHistoryRequest {
  readonly resolve: (entries: ReadonlyArray<IFileHistoryEntry>) => void
  readonly reject: (error: Error) => void
}

const historyRequests = new Array<IHistoryRequest>()

async function getFileHistory(): Promise<ReadonlyArray<IFileHistoryEntry>> {
  return await new Promise((resolve, reject) => {
    historyRequests.push({ resolve, reject })
  })
}

async function getCommitDiff() {
  return { kind: DiffType.Binary }
}

mock.module(resolve('app/src/ui/diff/diff-header.tsx'), {
  namedExports: { DiffHeader: TestDiffHeader },
})
mock.module(resolve('app/src/ui/diff/seamless-diff-switcher.tsx'), {
  namedExports: { SeamlessDiffSwitcher: TestSeamlessDiffSwitcher },
})
mock.module(resolve('app/src/ui/file-history/index.ts'), {
  namedExports: { FileHistoryPanel: TestFileHistoryPanel },
})
mock.module(resolve('app/src/lib/git/file-history.ts'), {
  namedExports: { getFileHistory },
})
mock.module(resolve('app/src/lib/git/diff.ts'), {
  namedExports: { getCommitDiff },
})

let Changes: React.ComponentType<IChangesProps>

before(async () => {
  Changes = (await import('../../../src/ui/changes/changes')).Changes
})

beforeEach(() => {
  historyRequests.length = 0
})

const repository = new Repository(
  '/tmp/changes-file-history-test',
  1,
  null,
  false
)
const currentFile = new WorkingDirectoryFileChange(
  'src/example.ts',
  { kind: AppFileStatusKind.Modified },
  DiffSelection.fromInitialSelection(DiffSelectionType.All)
)

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

function createEntry(sha: string, summary: string, path = currentFile.path) {
  const commit = createCommit(sha, summary)
  const file = new CommittedFileChange(
    path,
    { kind: AppFileStatusKind.Modified },
    commit.sha,
    `${commit.sha}^`
  )

  return { commit, file }
}

function createChangesProps(file = currentFile): IChangesProps {
  return {
    repository,
    file,
    diff: { kind: DiffType.Binary },
    dispatcher: {} as IChangesProps['dispatcher'],
    imageDiffType: 0,
    isCommitting: false,
    hideWhitespaceInDiff: false,
    onOpenBinaryFile: () => {},
    onOpenSubmodule: () => {},
    onChangeImageDiffType: () => {},
    askForConfirmationOnDiscardChanges: false,
    showSideBySideDiff: false,
    showDiffCheckMarks: true,
    onDiffOptionsOpened: () => {},
  }
}

function renderChanges(file = currentFile) {
  const props = createChangesProps(file)
  const view = render(<Changes {...props} />)

  return { view, props }
}

describe('Changes file history', () => {
  it('reloads history after closing and reopening while the first request is pending', async () => {
    renderChanges()

    fireEvent.click(screen.getByRole('button', { name: 'File history' }))
    await waitFor(() => assert.equal(historyRequests.length, 1))

    fireEvent.click(screen.getByRole('button', { name: 'File history' }))
    fireEvent.click(screen.getByRole('button', { name: 'File history' }))

    await waitFor(() => assert.equal(historyRequests.length, 2))
    assert.ok(screen.getByText('Loading file history…'))
  })

  it('keeps the history list request alive when returning to current changes', async () => {
    renderChanges()

    fireEvent.click(screen.getByRole('button', { name: 'File history' }))
    await waitFor(() => assert.equal(historyRequests.length, 1))

    fireEvent.click(screen.getByRole('button', { name: 'Dirty' }))
    const entry = createEntry(
      '1111111111111111111111111111111111111111',
      'First change'
    )
    historyRequests[0].resolve([entry])

    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: entry.commit.summary }))
    )
    assert.equal(screen.queryByText('Loading file history…'), null)
  })

  it('clears entries immediately when the selected file changes', async () => {
    const { view, props } = renderChanges()

    fireEvent.click(screen.getByRole('button', { name: 'File history' }))
    await waitFor(() => assert.equal(historyRequests.length, 1))

    const firstEntry = createEntry(
      '1111111111111111111111111111111111111111',
      'First change'
    )
    historyRequests[0].resolve([firstEntry])
    await waitFor(() =>
      screen.getByRole('button', { name: firstEntry.commit.summary })
    )

    const nextFile = new WorkingDirectoryFileChange(
      'src/other.ts',
      { kind: AppFileStatusKind.Modified },
      DiffSelection.fromInitialSelection(DiffSelectionType.All)
    )
    view.rerender(<Changes {...props} file={nextFile} />)

    await waitFor(() => assert.equal(historyRequests.length, 2))
    assert.equal(
      screen.queryByRole('button', { name: firstEntry.commit.summary }),
      null
    )
  })
})
