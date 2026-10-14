import * as React from 'react'

import { Row } from '../lib/row'
import { Dialog, DialogContent, DefaultDialogFooter } from '../dialog'
import { encodePathAsUrl } from '../../lib/path'

const logoPath = __DARWIN__
  ? 'static/logo-64x64@2x.png'
  : 'static/windows-logo-64x64@2x.png'
const DesktopLogo = encodePathAsUrl(__dirname, logoPath)

interface IAboutProps {
  /**
   * Event triggered when the dialog is dismissed by the user in the
   * ways described in the Dialog component's dismissible prop.
   */
  readonly onDismissed: () => void

  /**
   * The name of the currently installed (and running) application
   */
  readonly applicationName: string

  /**
   * The currently installed (and running) version of the app.
   */
  readonly applicationVersion: string

  /**
   * The currently installed (and running) architecture of the app.
   */
  readonly applicationArchitecture: string
}

/**
 * A dialog that presents information about the
 * running application such as name and version.
 */
export class About extends React.Component<IAboutProps> {
  public render() {
    const name = this.props.applicationName
    const version = this.props.applicationVersion
    // In development the caller already passes the abbreviated SHA as the
    // version, so only show it once.
    const versionText = __DEV__
      ? `Build ${version}`
      : `Commit ${__SHA__.substring(0, 10)} · Version ${version}`
    const titleId = 'Dialog_about'

    return (
      <Dialog
        id="about"
        titleId={titleId}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row className="logo">
            <img
              src={DesktopLogo}
              alt="GitHub Desktop"
              width="64"
              height="64"
            />
          </Row>
          <h1 id={titleId}>About {name}</h1>
          <p className="no-padding">
            <span className="selectable-text">
              {versionText} ({this.props.applicationArchitecture})
            </span>
          </p>
        </DialogContent>
        <DefaultDialogFooter />
      </Dialog>
    )
  }
}
