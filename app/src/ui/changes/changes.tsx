import * as React from 'react'
import { DiffHeader } from '../diff/diff-header'
import {
  DiffSelection,
  IDiff,
  ImageDiffType,
  ITextDiff,
} from '../../models/diff'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { SeamlessDiffSwitcher } from '../diff/seamless-diff-switcher'
import { PopupType } from '../../models/popup'
import { FileHistoryPanel } from '../file-history'
import { getFileHistory, IFileHistoryEntry } from '../../lib/git/file-history'
import { getCommitDiff } from '../../lib/git/diff'
import { Account } from '../../models/account'
import { Emoji } from '../../lib/emoji'
import {
  DefaultMaxHeight,
  DefaultMinHeight,
} from '../resizable/vertical-resizable'

const DefaultFileHistoryHeight = 220

export interface IChangesProps {
  readonly repository: Repository
  readonly file: WorkingDirectoryFileChange
  readonly diff: IDiff | null
  readonly dispatcher: Dispatcher
  readonly imageDiffType: ImageDiffType

  /**
   * The current HEAD SHA. Changes passes this value to its history loader so
   * that a history list is refreshed after a branch checkout, pull, or commit.
   * It is optional for callers which do not keep the repository tip in their
   * props; the repository and file identity are still checked for every load.
   */
  // Used in the history request identity and componentDidUpdate.
  // eslint-disable-next-line react/no-unused-prop-types
  readonly headSHA?: string | null

  /** Optional metadata used when rendering commits in the history list. */
  readonly emoji?: Map<string, Emoji>
  readonly accounts?: ReadonlyArray<Account>
  readonly preferAbsoluteDates?: boolean
  readonly localCommitSHAs?: ReadonlyArray<string>
  readonly tagsToPush?: ReadonlyArray<string>
  readonly isLocalRepository?: boolean

  /** Whether a commit is in progress */
  readonly isCommitting: boolean
  readonly hideWhitespaceInDiff: boolean

  /**
   * Called when the user requests to open a binary file in an the
   * system-assigned application for said file type.
   */
  readonly onOpenBinaryFile: (fullPath: string) => void

  /** Called when the user requests to open a submodule. */
  readonly onOpenSubmodule: (fullPath: string) => void

  /**
   * Called when the user is viewing an image diff and requests
   * to change the diff presentation mode.
   */
  readonly onChangeImageDiffType: (type: ImageDiffType) => void

  /**
   * Whether we should show a confirmation dialog when the user
   * discards changes
   */
  readonly askForConfirmationOnDiscardChanges: boolean

  /**
   * Whether we should display side by side diffs.
   */
  readonly showSideBySideDiff: boolean

  /** Whether or not to show the diff check marks indicating inclusion in a commit */
  readonly showDiffCheckMarks: boolean

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void
}

interface IChangesState {
  readonly fileHistoryOpen: boolean
  readonly historyEntries: ReadonlyArray<IFileHistoryEntry>
  readonly selectedHistoryEntry: IFileHistoryEntry | null
  readonly historyDiff: IDiff | null
  readonly historyLoading: boolean
  readonly historyError: string | null
  readonly historyDiffError: string | null
  readonly historyHeight: number
}

type ChangedFile = WorkingDirectoryFileChange | CommittedFileChange

export class Changes extends React.Component<IChangesProps, IChangesState> {
  private historyRequestVersion = 0
  private historyDiffRequestVersion = 0

  public constructor(props: IChangesProps) {
    super(props)

    this.state = {
      fileHistoryOpen: false,
      historyEntries: [],
      selectedHistoryEntry: null,
      historyDiff: null,
      historyLoading: false,
      historyError: null,
      historyDiffError: null,
      historyHeight: DefaultFileHistoryHeight,
    }
  }

  public componentDidUpdate(prevProps: IChangesProps) {
    const previousFileKey = this.getHistoryFileKey(prevProps)
    const currentFileKey = this.getHistoryFileKey(this.props)
    const fileChanged = previousFileKey !== currentFileKey
    const requestChanged =
      this.getHistoryRequestKey(prevProps) !==
      this.getHistoryRequestKey(this.props)

    if (fileChanged) {
      this.invalidateHistoryRequests()

      if (this.state.fileHistoryOpen) {
        this.loadFileHistory()
      } else {
        this.setState({
          historyEntries: [],
          selectedHistoryEntry: null,
          historyDiff: null,
          historyLoading: false,
          historyError: null,
          historyDiffError: null,
        })
      }

      return
    }

    // The branch tip is part of the request identity. This keeps a history
    // list and a selected commit diff from silently referring to an old HEAD.
    if (this.state.fileHistoryOpen && requestChanged) {
      this.loadFileHistory()
      return
    }

    // A historical diff is generated with the same whitespace preference as
    // the regular Changes diff. Preserve the selected commit while reloading
    // its diff when the preference changes.
    if (
      this.state.fileHistoryOpen &&
      this.state.selectedHistoryEntry !== null &&
      prevProps.hideWhitespaceInDiff !== this.props.hideWhitespaceInDiff
    ) {
      this.loadHistoryDiff(this.state.selectedHistoryEntry)
    }
  }

  public componentWillUnmount() {
    this.invalidateHistoryRequests()
  }
  /**
   * Whether or not it's currently possible to change the line selection
   * of a diff. Changing selection is not possible while a commit is in
   * progress or if the user has opted to hide whitespace changes.
   */
  private get lineSelectionDisabled() {
    return (
      this.props.isCommitting ||
      this.props.hideWhitespaceInDiff ||
      this.state.selectedHistoryEntry !== null
    )
  }

  private onDiffLineIncludeChanged = (selection: DiffSelection) => {
    if (!this.lineSelectionDisabled) {
      const { repository, file } = this.props
      this.props.dispatcher.changeFileLineSelection(repository, file, selection)
    }
  }

  private onDiscardChanges = (
    diff: ITextDiff,
    diffSelection: DiffSelection
  ) => {
    if (
      this.lineSelectionDisabled ||
      this.state.selectedHistoryEntry !== null
    ) {
      return
    }

    if (this.props.askForConfirmationOnDiscardChanges) {
      this.props.dispatcher.showPopup({
        type: PopupType.ConfirmDiscardSelection,
        repository: this.props.repository,
        file: this.props.file,
        diff,
        selection: diffSelection,
      })
    } else {
      this.props.dispatcher.discardChangesFromSelection(
        this.props.repository,
        this.props.file.path,
        diff,
        diffSelection
      )
    }
  }

  private getHistoryPath(file: WorkingDirectoryFileChange): string {
    // A rename which only exists in the working tree cannot be followed from
    // its new path yet. Git can follow the committed old path instead.
    if (file.status.kind === AppFileStatusKind.Renamed) {
      return file.status.oldPath
    }

    return file.path
  }

  private getHistoryFileKey(props: IChangesProps = this.props): string {
    return [
      props.repository.hash,
      props.repository.path,
      props.file.path,
      this.getHistoryPath(props.file),
    ].join('\0')
  }

  private getHistoryRequestKey(props: IChangesProps = this.props): string {
    return [this.getHistoryFileKey(props), props.headSHA ?? ''].join('\0')
  }

  private isCurrentHistoryRequest(version: number, requestKey: string) {
    return (
      version === this.historyRequestVersion &&
      requestKey === this.getHistoryRequestKey()
    )
  }

  private isCurrentHistoryDiffRequest(version: number, requestKey: string) {
    return (
      version === this.historyDiffRequestVersion &&
      requestKey === this.getHistoryRequestKey()
    )
  }

  private invalidateHistoryRequests() {
    this.historyRequestVersion++
    this.historyDiffRequestVersion++
  }

  private invalidateHistoryDiffRequests() {
    this.historyDiffRequestVersion++
  }

  private loadFileHistory = async () => {
    const requestVersion = ++this.historyRequestVersion
    const requestKey = this.getHistoryRequestKey()

    this.setState({
      historyLoading: true,
      historyError: null,
      historyEntries: [],
      selectedHistoryEntry: null,
      historyDiff: null,
      historyDiffError: null,
    })

    try {
      const entries = await getFileHistory(
        this.props.repository,
        this.getHistoryPath(this.props.file)
      )

      if (!this.isCurrentHistoryRequest(requestVersion, requestKey)) {
        return
      }

      this.setState({
        historyEntries: entries,
        historyLoading: false,
        historyError: null,
      })
    } catch (error) {
      if (!this.isCurrentHistoryRequest(requestVersion, requestKey)) {
        return
      }

      this.setState({
        historyEntries: [],
        selectedHistoryEntry: null,
        historyDiff: null,
        historyLoading: false,
        historyError: this.getErrorMessage(error),
        historyDiffError: null,
      })
    }
  }

  private loadHistoryDiff = async (entry: IFileHistoryEntry) => {
    const requestVersion = ++this.historyDiffRequestVersion
    const requestKey = this.getHistoryRequestKey()

    this.setState({
      selectedHistoryEntry: entry,
      historyDiff: null,
      historyDiffError: null,
    })

    try {
      const diff = await getCommitDiff(
        this.props.repository,
        entry.file,
        entry.commit.sha,
        this.props.hideWhitespaceInDiff
      )

      if (
        !this.isCurrentHistoryDiffRequest(requestVersion, requestKey) ||
        this.state.selectedHistoryEntry?.commit.sha !== entry.commit.sha
      ) {
        return
      }

      this.setState({
        historyDiff: diff,
        historyDiffError: null,
      })
    } catch (error) {
      if (
        !this.isCurrentHistoryDiffRequest(requestVersion, requestKey) ||
        this.state.selectedHistoryEntry?.commit.sha !== entry.commit.sha
      ) {
        return
      }

      this.setState({
        historyDiff: null,
        historyDiffError: this.getErrorMessage(error),
      })
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private onFileHistoryToggle = () => {
    if (this.state.fileHistoryOpen) {
      // Closing the panel always returns to the working-tree diff. This also
      // prevents staging controls from remaining active for a hidden commit.
      this.invalidateHistoryRequests()
      this.setState({
        fileHistoryOpen: false,
        historyEntries: [],
        selectedHistoryEntry: null,
        historyDiff: null,
        historyLoading: false,
        historyError: null,
        historyDiffError: null,
      })
      return
    }

    this.setState({ fileHistoryOpen: true })
    this.loadFileHistory()
  }

  private onEntrySelected = (entry: IFileHistoryEntry) => {
    if (
      this.state.fileHistoryOpen &&
      !this.state.historyLoading &&
      this.state.historyEntries.some(
        candidate => candidate.commit.sha === entry.commit.sha
      )
    ) {
      this.loadHistoryDiff(entry)
    }
  }

  private onReturnToWorkingDirectory = () => {
    // Keep an in-flight history list request alive. Returning to the dirty
    // diff only cancels the historical diff request; cancelling both would
    // leave the list in a permanent loading state when its response arrives.
    this.invalidateHistoryDiffRequests()
    this.setState({
      selectedHistoryEntry: null,
      historyDiff: null,
      historyDiffError: null,
    })
  }

  private onHistoryHeightChanged = (height: number) => {
    this.setState({
      historyHeight: Math.max(
        DefaultMinHeight,
        Math.min(DefaultMaxHeight, height)
      ),
    })
  }

  private onHistoryHeightReset = () => {
    this.setState({ historyHeight: DefaultFileHistoryHeight })
  }

  private renderDiffView(
    file: ChangedFile,
    diff: IDiff | null,
    readOnly: boolean,
    diffError: string | null
  ) {
    return (
      <div className="diff-container">
        <DiffHeader
          path={file.path}
          status={file.status}
          diff={diff}
          showSideBySideDiff={this.props.showSideBySideDiff}
          onShowSideBySideDiffChanged={this.onShowSideBySideDiffChanged}
          hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
          onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
          onDiffOptionsOpened={this.props.onDiffOptionsOpened}
          fileHistoryOpen={this.state.fileHistoryOpen}
          onFileHistoryToggle={this.onFileHistoryToggle}
        />

        {diffError !== null ? (
          <div className="file-history-error" role="alert">
            {diffError}
          </div>
        ) : (
          <SeamlessDiffSwitcher
            repository={this.props.repository}
            imageDiffType={this.props.imageDiffType}
            file={file}
            readOnly={readOnly}
            onIncludeChanged={
              readOnly ? undefined : this.onDiffLineIncludeChanged
            }
            onDiscardChanges={readOnly ? undefined : this.onDiscardChanges}
            diff={diff}
            hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
            showSideBySideDiff={this.props.showSideBySideDiff}
            showDiffCheckMarks={
              readOnly ? false : this.props.showDiffCheckMarks
            }
            askForConfirmationOnDiscardChanges={
              readOnly
                ? undefined
                : this.props.askForConfirmationOnDiscardChanges
            }
            onOpenBinaryFile={this.props.onOpenBinaryFile}
            onOpenSubmodule={this.props.onOpenSubmodule}
            onChangeImageDiffType={this.props.onChangeImageDiffType}
            onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
          />
        )}
      </div>
    )
  }

  public render() {
    const selectedEntry = this.state.selectedHistoryEntry
    const isViewingHistory = selectedEntry !== null
    const diffView = this.renderDiffView(
      selectedEntry?.file ?? this.props.file,
      isViewingHistory ? this.state.historyDiff : this.props.diff,
      isViewingHistory,
      isViewingHistory ? this.state.historyDiffError : null
    )

    if (!this.state.fileHistoryOpen) {
      return diffView
    }

    return (
      <div className="diff-container">
        <FileHistoryPanel
          repository={this.props.repository}
          path={this.props.file.path}
          entries={this.state.historyEntries}
          selectedEntry={selectedEntry}
          isLoading={this.state.historyLoading}
          errorMessage={this.state.historyError}
          historyHeight={this.state.historyHeight}
          minimumHistoryHeight={DefaultMinHeight}
          maximumHistoryHeight={DefaultMaxHeight}
          onHistoryHeightChanged={this.onHistoryHeightChanged}
          onHistoryHeightReset={this.onHistoryHeightReset}
          onEntrySelected={this.onEntrySelected}
          onReturnToWorkingDirectory={this.onReturnToWorkingDirectory}
          isWorkingDirectorySelected={selectedEntry === null}
          emoji={this.props.emoji}
          accounts={this.props.accounts}
          preferAbsoluteDates={this.props.preferAbsoluteDates}
          localCommitSHAs={this.props.localCommitSHAs}
          tagsToPush={this.props.tagsToPush}
          isLocalRepository={this.props.isLocalRepository}
        >
          {diffView}
        </FileHistoryPanel>
      </div>
    )
  }

  private onShowSideBySideDiffChanged = (showSideBySideDiff: boolean) => {
    this.props.dispatcher.onShowSideBySideDiffChanged(showSideBySideDiff)
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    return this.props.dispatcher.onHideWhitespaceInChangesDiffChanged(
      hideWhitespaceInDiff,
      this.props.repository
    )
  }
}
