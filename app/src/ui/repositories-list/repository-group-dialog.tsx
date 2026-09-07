import * as React from 'react'
import { randomBytes } from 'crypto'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  OkCancelButtonGroup,
} from '../dialog'
import { TextBox } from '../lib/text-box'
import {
  IRepositoryOrganization,
  readRepositoryOrganization,
  saveRepositoryOrganization,
  validateRepositoryGroupName,
  RepositoryGroupsChangedEvent,
} from '../../lib/repository-activity/organization'

interface IRepositoryGroupDialogProps {
  readonly groupId: string | null
  readonly onDismissed: () => void
}

interface IRepositoryGroupDialogState {
  readonly name: string
  readonly organization: IRepositoryOrganization
  readonly edited: boolean
  readonly saveError: string | null
}

export class RepositoryGroupDialog extends React.Component<
  IRepositoryGroupDialogProps,
  IRepositoryGroupDialogState
> {
  public constructor(props: IRepositoryGroupDialogProps) {
    super(props)
    const organization = readRepositoryOrganization(localStorage)
    this.state = {
      name: organization.groups.find(g => g.id === props.groupId)?.name ?? '',
      organization,
      edited: false,
      saveError: null,
    }
  }

  private onNameChanged = (name: string) => {
    this.setState({ name, edited: true, saveError: null })
  }

  private save = () => {
    // Re-read before writing so an intervening assignment or newly created
    // group is neither overwritten nor allowed to introduce a duplicate name.
    const organization = readRepositoryOrganization(localStorage)
    const { groupId } = this.props
    const name = this.state.name.trim()
    const error = validateRepositoryGroupName(organization, name, groupId)
    if (error) {
      this.setState({ organization, edited: true, saveError: error })
      return
    }
    if (groupId !== null && !organization.groups.some(g => g.id === groupId)) {
      this.setState({
        saveError:
          'This group no longer exists. Close this dialog and create a new group.',
      })
      return
    }
    const groups =
      groupId === null
        ? [
            ...organization.groups,
            { id: `group-${randomBytes(12).toString('hex')}`, name },
          ]
        : organization.groups.map(g => (g.id === groupId ? { ...g, name } : g))
    try {
      saveRepositoryOrganization(localStorage, { ...organization, groups })
    } catch {
      this.setState({
        saveError: 'Could not save this group. Please try again.',
      })
      return
    }
    window.dispatchEvent(new Event(RepositoryGroupsChangedEvent))
    this.props.onDismissed()
  }

  public render() {
    const validation = validateRepositoryGroupName(
      this.state.organization,
      this.state.name,
      this.props.groupId
    )
    const error =
      this.state.saveError ?? (this.state.edited ? validation : null)
    const creating = this.props.groupId === null
    return (
      <Dialog
        id="repository-group-dialog"
        title={creating ? 'New repository group' : 'Rename repository group'}
        ariaDescribedBy="repository-group-description"
        onDismissed={this.props.onDismissed}
        onSubmit={this.save}
        backdropDismissable={false}
      >
        <DialogContent>
          <p id="repository-group-description">
            Keep related repositories together with a group of your own.
          </p>
          <TextBox
            label="Group name"
            value={this.state.name}
            onValueChanged={this.onNameChanged}
            placeholder="e.g. Personal, Work, Experiments"
            autoFocus={true}
            ariaDescribedBy={
              error ? 'repository-group-validation' : 'repository-group-hint'
            }
          />
          <div className="repository-group-feedback">
            {error ? (
              <p
                id="repository-group-validation"
                className="error"
                role="alert"
              >
                {error}
              </p>
            ) : (
              <p id="repository-group-hint" className="description">
                Drag repositories onto the group heading to add them.
              </p>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={creating ? 'Create group' : 'Save name'}
            okButtonDisabled={validation !== null}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
