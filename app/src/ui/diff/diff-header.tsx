import * as React from 'react'
import { PathLabel } from '../lib/path-label'
import { AppFileStatus } from '../../models/status'
import { IDiff, DiffType } from '../../models/diff'
import { Octicon, iconForStatus } from '../octicons'
import { mapStatus } from '../../lib/status'
import { DiffOptions } from './diff-options'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'

interface IDiffHeaderProps {
  readonly path: string
  readonly status: AppFileStatus
  readonly diff: IDiff | null

  /** Whether we should display side by side diffs. */
  readonly showSideBySideDiff: boolean

  /** Called when the user changes the side by side diffs setting. */
  readonly onShowSideBySideDiffChanged: (checked: boolean) => void

  /** Whether we should hide whitespace in diffs. */
  readonly hideWhitespaceInDiff: boolean

  /** Called when the user changes the hide whitespace in diffs setting. */
  readonly onHideWhitespaceInDiffChanged: (checked: boolean) => Promise<void>

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void

  /** Whether the file history panel is currently visible. */
  readonly fileHistoryOpen?: boolean

  /** Called when the file history panel should be toggled. */
  readonly onFileHistoryToggle?: () => void
}

/** Displays information about a file */
export class DiffHeader extends React.Component<IDiffHeaderProps, {}> {
  public render() {
    const status = this.props.status
    const fileStatus = mapStatus(status)

    return (
      <div className="header">
        <PathLabel path={this.props.path} status={this.props.status} />

        {this.renderFileHistoryToggle()}
        {this.renderDiffOptions()}

        <Octicon
          symbol={iconForStatus(status)}
          className={'status status-' + fileStatus.toLowerCase()}
          title={fileStatus}
        />
      </div>
    )
  }

  private renderFileHistoryToggle() {
    if (this.props.onFileHistoryToggle === undefined) {
      return null
    }

    const label = 'File history'
    return (
      <Button
        className="file-history-toggle"
        ariaLabel={label}
        ariaExpanded={this.props.fileHistoryOpen === true}
        tooltip={label}
        onClick={this.props.onFileHistoryToggle}
      >
        <Octicon symbol={octicons.history} />
      </Button>
    )
  }

  private renderDiffOptions() {
    if (this.props.diff?.kind === DiffType.Submodule) {
      return null
    }

    return (
      <DiffOptions
        isInteractiveDiff={true}
        onHideWhitespaceChangesChanged={
          this.props.onHideWhitespaceInDiffChanged
        }
        hideWhitespaceChanges={this.props.hideWhitespaceInDiff}
        onShowSideBySideDiffChanged={this.props.onShowSideBySideDiffChanged}
        showSideBySideDiff={this.props.showSideBySideDiff}
        onDiffOptionsOpened={this.props.onDiffOptionsOpened}
      />
    )
  }
}
