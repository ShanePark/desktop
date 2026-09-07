import * as React from 'react'
import { Button } from '../lib/button'
import { isActivitySort } from '../../lib/repository-activity/preferences'
import type { IActivityPreferences } from '../../lib/repository-activity/preferences'
import type { IActivityState } from '../../lib/repository-activity/monitor'

interface IActivityToolbarProps {
  readonly preferences: IActivityPreferences
  readonly activity: IActivityState
  readonly onChange: (preferences: IActivityPreferences) => void
  readonly onRefresh: () => void
}

export function RepositoryActivityToolbar(props: IActivityToolbarProps) {
  const { preferences, activity, onChange, onRefresh } = props
  const unavailable = [...activity.repositories.values()].filter(
    item => item.error
  ).length
  const onFilterChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...preferences, onlyUncommitted: event.currentTarget.checked })
  }
  const onSortChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const sort = event.currentTarget.value
    if (isActivitySort(sort)) {
      onChange({ ...preferences, sort })
    }
  }

  return (
    <div className="repository-activity-controls" aria-label="Repository activity">
      <label className="repository-activity-filter">
        <input
          type="checkbox"
          checked={preferences.onlyUncommitted}
          onChange={onFilterChanged}
        />
        Uncommitted only
      </label>
      <select
        aria-label="Sort repositories"
        value={preferences.sort}
        onChange={onSortChanged}
      >
        <option value="recent">Recent local changes</option>
        <option value="dirty-first">Uncommitted first</option>
        <option value="name">Name / original groups</option>
      </select>
      <Button
        onClick={onRefresh}
        disabled={activity.checking}
        tooltip="Check all listed working copies without fetching or changing files"
      >
        Refresh
      </Button>
      <div
        className="repository-activity-summary"
        role="status"
        aria-live="polite"
      >
        {activity.checking
          ? `Checking working copies: ${activity.completed}/${activity.total}`
          : `${activity.total} working copies checked`}
        {unavailable > 0 && ` · ${unavailable} unavailable`}
        {preferences.onlyUncommitted && (
          <span> Unchecked or unavailable working copies remain visible.</span>
        )}
      </div>
    </div>
  )
}
