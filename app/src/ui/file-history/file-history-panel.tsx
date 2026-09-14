import * as React from 'react'

import { IFileHistoryEntry } from '../../lib/git/file-history'
import { Repository } from '../../models/repository'
import { Account } from '../../models/account'
import { Commit } from '../../models/commit'
import { CommitList } from '../history/commit-list'
import {
  DefaultMaxHeight,
  DefaultMinHeight,
  VerticalResizable,
} from '../resizable'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Emoji } from '../../lib/emoji'

export interface IFileHistoryPanelProps {
  readonly repository: Repository
  readonly path: string
  readonly entries: ReadonlyArray<IFileHistoryEntry>
  readonly selectedEntry: IFileHistoryEntry | null
  readonly isLoading: boolean
  readonly errorMessage?: string | null

  /** The height of the history list in pixels. */
  readonly historyHeight: number
  readonly minimumHistoryHeight?: number
  readonly maximumHistoryHeight?: number
  /** Keep this much room for the diff above the history list. */
  readonly minimumDiffHeight?: number
  readonly onHistoryHeightChanged: (height: number) => void
  readonly onHistoryHeightReset: () => void

  /** Called when the user selects a commit in the file history. */
  readonly onEntrySelected: (entry: IFileHistoryEntry) => void

  /** Called when the user wants to return to the working tree diff. */
  readonly onReturnToWorkingDirectory?: () => void

  /** Whether the working-directory row should be shown as selected. */
  readonly isWorkingDirectorySelected?: boolean

  /** The diff view rendered above the history list. */
  readonly children: React.ReactNode

  /** Optional display data reused by the regular history commit list. */
  readonly emoji?: Map<string, Emoji>
  readonly accounts?: ReadonlyArray<Account>
  readonly preferAbsoluteDates?: boolean
  readonly localCommitSHAs?: ReadonlyArray<string>
  readonly tagsToPush?: ReadonlyArray<string>
  readonly isLocalRepository?: boolean
}

export type IFileHistoryPanelData = Omit<
  IFileHistoryPanelProps,
  'repository' | 'path' | 'children'
>

/**
 * Displays a file's commit history below a diff. The diff itself is supplied
 * by the caller so this component can be used for both working-tree and
 * historical diffs.
 */
export class FileHistoryPanel extends React.Component<
  IFileHistoryPanelProps,
  { readonly availableHeight: number | null }
> {
  private readonly emptyEmoji = new Map<string, Emoji>()
  private readonly panelRef = React.createRef<HTMLDivElement>()
  private readonly resizeObserver: ResizeObserver | null

  public constructor(props: IFileHistoryPanelProps) {
    super(props)

    this.state = { availableHeight: null }

    const ResizeObserverClass: typeof ResizeObserver | undefined = (
      window as any
    ).ResizeObserver
    this.resizeObserver = ResizeObserverClass
      ? new ResizeObserverClass(this.onPanelResized)
      : null
  }

  public componentDidMount() {
    const panel = this.panelRef.current
    if (panel === null) {
      return
    }

    this.resizeObserver?.observe(panel)
    this.updateAvailableHeight(panel.clientHeight)
  }

  public componentWillUnmount() {
    this.resizeObserver?.disconnect()
  }

  private onPanelResized = (entries: ReadonlyArray<ResizeObserverEntry>) => {
    const entry = entries.find(item => item.target === this.panelRef.current)
    if (entry !== undefined) {
      this.updateAvailableHeight(entry.contentRect.height)
    }
  }

  private updateAvailableHeight(height: number) {
    const availableHeight = Math.max(0, Math.floor(height))
    if (this.state.availableHeight !== availableHeight) {
      this.setState({ availableHeight })
    }
  }

  private get maximumHistoryHeight() {
    const configuredMaximum =
      this.props.maximumHistoryHeight ?? DefaultMaxHeight
    const minimumHistory = this.props.minimumHistoryHeight ?? DefaultMinHeight
    const minimumDiff = this.props.minimumDiffHeight ?? DefaultMinHeight
    const availableMaximum =
      this.state.availableHeight === null
        ? configuredMaximum
        : this.state.availableHeight - minimumDiff

    return Math.max(
      minimumHistory,
      Math.min(configuredMaximum, availableMaximum)
    )
  }

  private get commitSHAs(): ReadonlyArray<string> {
    return this.props.entries.map(entry => entry.commit.sha)
  }

  private get commitLookup(): Map<string, Commit> {
    return new Map(
      this.props.entries.map(entry => [entry.commit.sha, entry.commit])
    )
  }

  private onCommitsSelected = (commits: ReadonlyArray<Commit>) => {
    const commit = commits[0]
    if (commit === undefined) {
      return
    }

    const entry = this.props.entries.find(
      candidate => candidate.commit.sha === commit.sha
    )
    if (entry !== undefined) {
      this.props.onEntrySelected(entry)
    }
  }

  private renderHistoryList() {
    if (this.props.errorMessage && this.props.entries.length === 0) {
      return (
        <div className="file-history-error" role="alert">
          {this.props.errorMessage}
        </div>
      )
    }

    const selectedSHA = this.props.selectedEntry?.commit.sha

    return (
      <CommitList
        gitHubRepository={this.props.repository.gitHubRepository}
        isLocalRepository={this.props.isLocalRepository ?? true}
        commitLookup={this.commitLookup}
        commitSHAs={this.commitSHAs}
        selectedSHAs={selectedSHA === undefined ? [] : [selectedSHA]}
        localCommitSHAs={this.props.localCommitSHAs ?? []}
        tagsToPush={this.props.tagsToPush ?? []}
        emoji={this.props.emoji ?? this.emptyEmoji}
        accounts={this.props.accounts ?? []}
        preferAbsoluteDates={this.props.preferAbsoluteDates ?? false}
        selectionMode="single"
        onCommitsSelected={this.onCommitsSelected}
        emptyListMessage={
          this.props.isLoading
            ? 'Loading file history…'
            : 'No history for this file'
        }
      />
    )
  }

  private renderHistoryError() {
    if (!this.props.errorMessage || this.props.entries.length === 0) {
      return null
    }

    return (
      <div className="file-history-error" role="alert">
        {this.props.errorMessage}
      </div>
    )
  }

  private renderWorkingDirectoryRow() {
    if (this.props.onReturnToWorkingDirectory === undefined) {
      return null
    }

    const isSelected = this.props.isWorkingDirectorySelected === true

    return (
      <button
        type="button"
        className={`list-item file-history-dirty-row${
          isSelected ? ' selected' : ''
        }`}
        aria-label="Dirty working directory changes"
        aria-pressed={isSelected}
        onClick={this.props.onReturnToWorkingDirectory}
      >
        <div className="commit">
          <div className="info">
            <div className="summary">Dirty</div>
            <div className="description">
              <Octicon
                className="status status-modified file-history-dirty-status"
                symbol={octicons.diffModified}
              />
              <div className="byline">Working directory</div>
            </div>
          </div>
        </div>
      </button>
    )
  }

  public render() {
    return (
      <div className="file-history-panel" ref={this.panelRef}>
        <div className="file-history-diff">{this.props.children}</div>
        <VerticalResizable
          height={this.props.historyHeight}
          minimumHeight={this.props.minimumHistoryHeight}
          maximumHeight={this.maximumHistoryHeight}
          handlePosition="top"
          onResize={this.props.onHistoryHeightChanged}
          onReset={this.props.onHistoryHeightReset}
          description="File history"
        >
          <div className="file-history-list-container">
            <div
              className="file-history-list"
              role="region"
              aria-label={`File history for ${this.props.path}`}
              aria-busy={this.props.isLoading}
            >
              {this.renderWorkingDirectoryRow()}
              {this.renderHistoryError()}
              {this.renderHistoryList()}
            </div>
          </div>
        </VerticalResizable>
      </div>
    )
  }
}
