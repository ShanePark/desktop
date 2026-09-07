import * as React from 'react'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { RadioButton } from '../lib/radio-button'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import type {
  ActivitySort,
  IActivityPreferences,
} from '../../lib/repository-activity/preferences'

interface IActivityToolbarProps {
  readonly preferences: IActivityPreferences
  readonly onChange: (preferences: IActivityPreferences) => void
}

interface IActivityToolbarState {
  readonly isPopoverOpen: boolean
}

export class RepositoryActivityToolbar extends React.Component<
  IActivityToolbarProps,
  IActivityToolbarState
> {
  private buttonRef: HTMLButtonElement | null = null

  public constructor(props: IActivityToolbarProps) {
    super(props)
    this.state = { isPopoverOpen: false }
  }

  private onButtonRef = (button: HTMLButtonElement | null) => {
    this.buttonRef = button
  }

  private togglePopover = () => {
    this.setState(previous => ({ isPopoverOpen: !previous.isPopoverOpen }))
  }

  private closePopover = () => {
    this.setState({ isPopoverOpen: false })
  }

  private onSortChanged = (sort: ActivitySort) => {
    this.props.onChange({ ...this.props.preferences, sort })
  }

  private onFilterChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.onChange({
      ...this.props.preferences,
      onlyUncommitted: event.currentTarget.checked,
    })
  }

  private renderPopover() {
    if (!this.state.isPopoverOpen) {
      return null
    }

    const { preferences } = this.props
    return (
      <Popover
        className="repository-activity-options-popover"
        anchor={this.buttonRef}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        onClickOutside={this.closePopover}
        ariaLabelledby="repository-activity-options-header"
      >
        <h3 id="repository-activity-options-header">View options</h3>
        <fieldset>
          <legend>Sort by</legend>
          <RadioButton<ActivitySort>
            value="recent"
            checked={preferences.sort === 'recent'}
            label="Recent changes"
            onSelected={this.onSortChanged}
          />
          <RadioButton<ActivitySort>
            value="dirty-first"
            checked={preferences.sort === 'dirty-first'}
            label="Uncommitted first"
            onSelected={this.onSortChanged}
          />
          <RadioButton<ActivitySort>
            value="name"
            checked={preferences.sort === 'name'}
            label="Name"
            onSelected={this.onSortChanged}
          />
        </fieldset>
        <fieldset>
          <Checkbox
            value={
              preferences.onlyUncommitted ? CheckboxValue.On : CheckboxValue.Off
            }
            label="Uncommitted only"
            onChange={this.onFilterChanged}
          />
        </fieldset>
      </Popover>
    )
  }

  public render() {
    const { preferences } = this.props
    return (
      <div className="repository-activity-options">
        <Button
          className={`repository-activity-options-button${
            preferences.onlyUncommitted ? ' filter-active' : ''
          }`}
          size="small"
          onClick={this.togglePopover}
          onButtonRef={this.onButtonRef}
          ariaLabel="Repository view options"
          ariaExpanded={this.state.isPopoverOpen}
          ariaHaspopup="dialog"
          tooltip="Repository view options"
        >
          <Octicon symbol={octicons.filter} />
        </Button>
        {this.renderPopover()}
      </div>
    )
  }
}
