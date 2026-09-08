import * as React from 'react'
import { TooltippedContent } from '../lib/tooltipped-content'

import { commitGrammar, RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
} from './group-repositories'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { IMenuItem } from '../../lib/menu-item'
import { PopupType } from '../../models/popup'
import { encodePathAsUrl } from '../../lib/path'
import memoizeOne from 'memoize-one'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { enableWorktreeSupport } from '../../lib/feature-flag'
import { SectionFilterList } from '../lib/section-filter-list'
import { RepositoryActivityToolbar } from './repository-activity-toolbar'
import { readRepositoryActivity } from '../../lib/git/repository-activity'
import {
  RepositoryActivityMonitor,
  IActivityState,
} from '../../lib/repository-activity/monitor'
import {
  IActivityPreferences,
  readActivityPreferences,
  saveActivityPreferences,
  readActivityCache,
  saveActivityCache,
} from '../../lib/repository-activity/preferences'
import { activityKey } from '../../lib/repository-activity/status'
import { projectActivityGroups } from '../../lib/repository-activity/list'
import {
  IRepositoryOrganization,
  readRepositoryOrganization,
  saveRepositoryOrganization,
  assignRepository,
  removeRepositoryGroup,
  moveRepositoryGroup,
  moveRepository,
  toggleRepositoryGroup,
  repositoryOrganizationPath,
  WorkingGroup,
  RepositoryGroupsChangedEvent,
  Ungrouped,
} from '../../lib/repository-activity/organization'

import {
  findRepositoryDropSlot,
  IRepositoryDropSlot,
} from '../../lib/repository-activity/drag'
import { assertNever } from '../../lib/fatal-error'
import { IAheadBehind } from '../../models/branch'

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')

type RepositoryGroupIdentifier = RepositoryListGroup | string

function repositoryOrganizationKey(repository: Repositoryish): string {
  return repositoryOrganizationPath(
    repository.path,
    repository instanceof Repository ? repository.mainWorktreePath : undefined
  )
}

interface IRepositoriesListProps {
  readonly selectedRepository: Repositoryish | null
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly recentRepositories: ReadonlyArray<number>

  /** A cache of the latest repository state values, keyed by the repository id */
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Called when a repository has been selected. */
  readonly onSelectionChanged: (repository: Repositoryish) => void

  /** Whether the user has enabled the setting to confirm removing a repository from the app */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the default web browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be shown in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string

  /** The callback to fire when the filter text has changed */
  readonly onFilterTextChanged: (text: string) => void

  /** The text entered by the user to filter their repository list */
  readonly filterText: string

  readonly dispatcher: Dispatcher
}

interface IRepositoriesListState {
  readonly selectedItem: IRepositoryListItem | null
  readonly activity: IActivityState
  readonly activityPreferences: IActivityPreferences
  readonly organization: IRepositoryOrganization
  readonly groupError: string | null
  readonly dropPosition: 'before' | 'after' | null
  readonly dropRepository?: number | null
  readonly dropGroup: string | null
  readonly newRepositoryMenuExpanded: boolean
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryGroupIdentifier>
  >,
  selectedRepository: Repositoryish | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.repository.id === selectedRepository.id) {
          return item
        }
      }
    }
  }

  return null
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  private readonly activityMonitor: RepositoryActivityMonitor
  private activityTimer: number | undefined
  private draggedRepository: number | null = null
  private draggedGroup: string | null = null
  private dropSlot: IRepositoryDropSlot | null = null
  private dragList: HTMLDivElement | null = null
  private groupDragImage: HTMLDivElement | null = null
  private groupCounts = new Map<string, number>()
  private suppressClickUntil = 0

  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
      recentRepositories: ReadonlyArray<number>
    ) =>
      repositories === null
        ? []
        : groupRepositories(
            repositories,
            localRepositoryStateLookup,
            recentRepositories
          )
  )

  /**
   * A memoized function for finding the selected list item based
   * on an IAPIRepository instance. The selected item will not be
   * recomputed as long as the provided list of repositories and
   * the selected data object is equal to the last time the method
   * was called (reference equality).
   *
   * See findMatchingListItem for more details.
   */
  private getSelectedListItem = memoizeOne(findMatchingListItem)

  public constructor(props: IRepositoriesListProps) {
    super(props)

    const initialActivity = readActivityCache(localStorage)
    this.state = {
      selectedItem: null,
      organization: readRepositoryOrganization(localStorage),
      groupError: null,
      dropGroup: null,
      dropPosition: null,
      newRepositoryMenuExpanded: false,
      activityPreferences: readActivityPreferences(localStorage),
      activity: {
        repositories: initialActivity,
        checking: false,
        completed: 0,
        total: 0,
      },
    }
    this.activityMonitor = new RepositoryActivityMonitor(
      readRepositoryActivity,
      activity => {
        if (!activity.checking) {
          saveActivityCache(localStorage, activity.repositories)
        }
        this.setState({ activity })
      },
      initialActivity
    )
  }

  public componentDidMount() {
    this.updateActivityPaths()
    this.refreshActivity()
    window.addEventListener('focus', this.refreshActivity)
    window.addEventListener(RepositoryGroupsChangedEvent, this.onGroupsChanged)
    document.addEventListener('visibilitychange', this.refreshVisibleActivity)
    this.activityTimer = window.setInterval(this.refreshVisibleActivity, 15000)
  }

  public componentDidUpdate(prevProps: IRepositoriesListProps) {
    if (prevProps.selectedRepository !== this.props.selectedRepository) {
      this.setState({ selectedItem: null })
    }
    if (prevProps.repositories !== this.props.repositories) {
      if (this.updateActivityPaths()) {
        this.refreshActivity()
      }
    }
  }

  public componentWillUnmount() {
    this.clearDropPreview()
    this.clearGroupDragImage()
    this.activityMonitor.stop()
    window.clearInterval(this.activityTimer)
    window.removeEventListener('focus', this.refreshActivity)
    window.removeEventListener(
      RepositoryGroupsChangedEvent,
      this.onGroupsChanged
    )
    document.removeEventListener(
      'visibilitychange',
      this.refreshVisibleActivity
    )
  }

  private updateActivityPaths() {
    // Scan all registered working copies, not only the selected repository
    // or the subset currently matching the text/status filters.
    return this.activityMonitor.setPaths(
      this.props.repositories
        .filter((r): r is Repository => r instanceof Repository)
        .map(r => r.path)
    )
  }

  private refreshActivity = () => {
    void this.activityMonitor.refresh()
  }

  private refreshVisibleActivity = () => {
    if (document.visibilityState !== 'hidden' && document.hasFocus()) {
      this.refreshActivity()
    }
  }

  private onActivityPreferencesChanged = (
    activityPreferences: IActivityPreferences
  ) => {
    saveActivityPreferences(localStorage, activityPreferences)
    this.setState({ activityPreferences, selectedItem: null })
  }

  private renderActivityToolbar = () => (
    <RepositoryActivityToolbar
      preferences={this.state.activityPreferences}
      onChange={this.onActivityPreferencesChanged}
    />
  )

  private getActivityDescription(item: IRepositoryListItem) {
    const activity = this.state.activity.repositories.get(
      activityKey(item.repository.path)
    )
    if (activity === undefined || activity.checkedAt === 0) {
      return 'Local activity: waiting for status check'
    }
    if (activity.error) {
      return 'Local activity: unavailable (not treated as clean)'
    }
    const time =
      activity.lastChangedAt === null
        ? 'last change time unknown'
        : `last local change ${new Date(
            activity.lastChangedAt
          ).toLocaleString()} (estimated)`
    return `${activity.changedFilesCount} changed files; ${
      activity.unpushedCount ?? 0
    } unpushed commits; ${time}`
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const repository = item.repository
    return (
      <div
        key={repository.id}
        className={`repository-activity-row ${
          this.state.dropRepository === repository.id
            ? `repository-insert-${this.state.dropPosition}`
            : ''
        }`}
        data-repository-id={repository.id}
        data-working={item.workingGroupName !== undefined}
        data-owner-group={
          item.workingGroupName !== undefined
            ? WorkingGroup
            : this.state.organization.assignments[
                repositoryOrganizationKey(repository)
              ] ?? Ungrouped
        }
        onDragOver={this.onRepositoryDragOver}
        onDragLeave={this.onGroupDragLeave}
        onDrop={this.onRepositoryDrop}
        draggable={repository instanceof Repository}
        onDragStart={this.onRepositoryDragStart}
        onDragEnd={this.onRepositoryDragEnd}
      >
        {item.workingGroupName !== undefined && (
          <TooltippedContent
            className="repository-working-group"
            tooltip={`Group: ${item.workingGroupName}`}
          >
            <span>{item.workingGroupName}</span>
          </TooltippedContent>
        )}
        <TooltippedContent
          className="repository-activity-tooltip"
          tooltip={this.getActivityDescription(item)}
          tagName="div"
        >
          <RepositoryListItem
            repository={repository}
            needsDisambiguation={item.needsDisambiguation}
            matches={matches}
            aheadBehind={item.aheadBehind}
            changedFilesCount={item.changedFilesCount}
          />
        </TooltippedContent>
      </div>
    )
  }

  private getAheadBehindTooltip = (aheadBehind: IAheadBehind | null) => {
    if (aheadBehind === null) {
      return null
    }

    const { ahead, behind } = aheadBehind

    if (behind === 0 && ahead === 0) {
      return null
    }

    return (
      'The currently checked out branch is' +
      (behind ? ` ${commitGrammar(behind)} behind ` : '') +
      (behind && ahead ? 'and' : '') +
      (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
      'its tracked branch.'
    )
  }

  private renderRowFocusTooltip = (
    item: IRepositoryListItem
  ): JSX.Element | string | null => {
    const { repository, aheadBehind, changedFilesCount } = item
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repository.name
    const aheadBehindTooltip = this.getAheadBehindTooltip(aheadBehind)
    const hasChanges = changedFilesCount > 0
    const uncommittedChangesTooltip = hasChanges
      ? `There are uncommitted changes in this repository.`
      : null

    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0

    return (
      <div className="repository-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {realName}
          {alias && <> ({alias})</>}
        </div>
        <div>
          <div className="label">Path: </div>
          {repository.path}
        </div>
        {aheadBehindTooltip && (
          <div>
            <div className="label">
              <div className="ahead-behind">
                {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
                {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
              </div>
            </div>
            {aheadBehindTooltip}
          </div>
        )}
        {uncommittedChangesTooltip && (
          <div>
            <div className="label">
              <span className="change-indicator-wrapper">
                <Octicon symbol={octicons.dotFill} />
              </span>
            </div>
            {uncommittedChangesTooltip}
          </div>
        )}
      </div>
    )
  }

  private getGroupLabel(identifier: RepositoryGroupIdentifier) {
    if (typeof identifier === 'string') {
      if (identifier === WorkingGroup) {
        return 'Working'
      }
      if (identifier === Ungrouped) {
        return 'Ungrouped'
      }
      const custom = this.state.organization.groups.find(
        group => group.id === identifier
      )
      if (custom) {
        return custom.name
      }
      if (identifier === '_LocalActivity_') {
        return 'Local working copies'
      }
      return identifier
    }

    const { kind } = identifier
    if (kind === 'enterprise') {
      return identifier.host
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return identifier.owner.login
    } else if (kind === 'recent') {
      return 'Recent'
    } else {
      return assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private getGroupIdentifierKey = (identifier: RepositoryGroupIdentifier) =>
    typeof identifier === 'string' ? identifier : getGroupKey(identifier)

  private renderGroupHeader = (identifier: RepositoryGroupIdentifier) => {
    const id = this.getGroupIdentifierKey(identifier)
    const label = this.getGroupLabel(identifier)

    if (typeof identifier !== 'string') {
      return (
        <TooltippedContent
          key={id}
          className="filter-list-group-header"
          tooltip={label}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          {label}
        </TooltippedContent>
      )
    }

    const searching = this.props.filterText.length > 0
    const collapsed =
      !searching && (this.state.organization.collapsed ?? []).includes(id)
    const isCustomGroup = this.state.organization.groups.some(
      group => group.id === id
    )
    const canDrop = id !== WorkingGroup

    return (
      <div
        key={id}
        className={`filter-list-group-header${
          isCustomGroup ? ' repository-custom-group' : ''
        } ${
          this.state.dropGroup === id
            ? this.state.dropPosition
              ? `group-insert-${this.state.dropPosition}`
              : 'drop-target'
            : ''
        }`}
        role="group"
        aria-label={
          canDrop
            ? `${label} — drag a repository here to assign it`
            : 'Uncommitted changes or unpushed commits on the current branch'
        }
        data-group={id}
        draggable={isCustomGroup}
        onDragStart={this.onGroupReorderStart}
        onDragEnd={this.onRepositoryDragEnd}
        onDragOver={this.onGroupDragOver}
        onDragLeave={this.onGroupDragLeave}
        onDrop={this.onGroupDrop}
      >
        <TooltippedContent
          className="repository-group-header-tooltip"
          tooltip={label}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          <button
            type="button"
            className="repository-group-toggle"
            data-group={id}
            aria-expanded={!collapsed}
            aria-disabled={searching}
            aria-label={
              searching
                ? `${label}, expanded while searching`
                : `${collapsed ? 'Expand' : 'Collapse'} ${label}`
            }
            onClick={this.onGroupToggle}
            onKeyDown={this.onGroupReorderKeyDown}
          >
            <Octicon
              symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
            />
            <span className="repository-group-label">{label}</span>
            <span className="repository-group-count">
              {this.groupCounts.get(id) ?? 0}
            </span>
          </button>
        </TooltippedContent>
        {isCustomGroup && (
          <button
            type="button"
            className="repository-group-menu"
            aria-label={`Manage ${label} group`}
            data-group={id}
            onClick={this.onGroupMenu}
          >
            …
          </button>
        )}
      </div>
    )
  }

  private onGroupToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const id = event.currentTarget.dataset.group
    if (id && !this.props.filterText && Date.now() >= this.suppressClickUntil) {
      this.updateOrganization(
        toggleRepositoryGroup(this.state.organization, id)
      )
    }
  }

  private onRepositoryDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    const id = Number(event.currentTarget.dataset.repositoryId)
    if (!this.props.repositories.some(r => r.id === id)) {
      return
    }
    this.draggedRepository = id
    event.dataTransfer.setData('application/x-desktop-repository', String(id))
    event.dataTransfer.effectAllowed = 'move'
  }

  private onRepositoryDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const id = Number(event.currentTarget.dataset.repositoryId)
    if (
      this.draggedRepository === null ||
      this.draggedRepository === id ||
      event.currentTarget.dataset.working === 'true'
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const dropPosition =
      event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (
      this.state.dropRepository !== id ||
      this.state.dropPosition !== dropPosition
    ) {
      this.setState({ dropRepository: id, dropPosition, dropGroup: null })
    }
  }

  private onRepositoryDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const source = this.props.repositories.find(
      r => r.id === this.draggedRepository
    )
    const target = this.props.repositories.find(
      r => r.id === Number(event.currentTarget.dataset.repositoryId)
    )
    if (source && target && event.currentTarget.dataset.working !== 'true') {
      const rect = event.currentTarget.getBoundingClientRect()
      const group =
        this.state.organization.assignments[
          repositoryOrganizationKey(target)
        ] ?? Ungrouped
      const fallback = [...this.props.repositories]
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
            a.path.localeCompare(b.path)
        )
        .map(repositoryOrganizationKey)
      this.updateOrganization(
        moveRepository(
          this.state.organization,
          repositoryOrganizationKey(source),
          repositoryOrganizationKey(target),
          group,
          event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
          fallback
        )
      )
    }
    this.onRepositoryDragEnd()
  }

  private onRepositoryDragEnd = () => {
    this.clearDropPreview()
    this.clearGroupDragImage()
    this.dropSlot = null
    this.dragList = null
    this.draggedRepository = null
    this.draggedGroup = null
    this.suppressClickUntil = Date.now() + 300
    this.setState({ dropGroup: null, dropPosition: null, dropRepository: null })
  }

  private onGroupDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const id = event.currentTarget.dataset.group
    if (
      id &&
      id !== WorkingGroup &&
      (this.draggedRepository !== null || this.draggedGroup !== null)
    ) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const dropPosition =
        this.draggedGroup === null
          ? null
          : id === Ungrouped || event.clientY < rect.top + rect.height / 2
          ? 'before'
          : 'after'
      if (
        this.state.dropGroup !== id ||
        this.state.dropPosition !== dropPosition
      ) {
        this.setState({ dropGroup: id, dropPosition, dropRepository: null })
      }
    }
  }

  private onGroupDragLeave = () =>
    this.setState({ dropGroup: null, dropPosition: null, dropRepository: null })

  private onGroupDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const id = event.currentTarget.dataset.group
    const repository = this.props.repositories.find(
      r => r.id === this.draggedRepository
    )
    if (id && this.draggedGroup !== null) {
      const rect = event.currentTarget.getBoundingClientRect()
      const position =
        id === Ungrouped || event.clientY < rect.top + rect.height / 2
          ? 'before'
          : 'after'
      this.updateOrganization(
        moveRepositoryGroup(
          this.state.organization,
          this.draggedGroup,
          id,
          position
        )
      )
    } else if (id && id !== WorkingGroup && repository) {
      this.assignGroup(repositoryOrganizationKey(repository), id)
    }
    this.onRepositoryDragEnd()
  }

  private onGroupReorderStart = (event: React.DragEvent<HTMLDivElement>) => {
    const id = event.currentTarget.dataset.group
    if (!id || !this.state.organization.groups.some(g => g.id === id)) {
      return
    }
    event.stopPropagation()
    this.draggedGroup = id
    this.draggedRepository = null
    event.dataTransfer.setData('application/x-desktop-repository-group', id)
    event.dataTransfer.effectAllowed = 'move'
    this.clearGroupDragImage()
    const image = document.createElement('div')
    image.className = 'repository-group-drag-image'
    image.textContent = this.getGroupLabel(id as RepositoryGroupIdentifier)
    document.body.appendChild(image)
    this.groupDragImage = image
    event.dataTransfer.setDragImage(image, 10, 13)
  }

  private moveGroup = (id: string, direction: 'up' | 'down') => {
    const index = this.state.organization.groups.findIndex(g => g.id === id)
    if (index < 0) {
      return
    }
    const target =
      this.state.organization.groups[index + (direction === 'up' ? -1 : 1)]
    if (target) {
      this.updateOrganization(
        moveRepositoryGroup(
          this.state.organization,
          id,
          target.id,
          direction === 'up' ? 'before' : 'after'
        )
      )
    }
  }

  private onGroupReorderKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const id = event.currentTarget.dataset.group
    if (
      id &&
      event.altKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault()
      event.stopPropagation()
      const list = event.currentTarget.closest('.repository-list')
      this.moveGroup(id, event.key === 'ArrowUp' ? 'up' : 'down')
      this.setState({}, () =>
        list
          ?.querySelector<HTMLButtonElement>(
            `button.repository-group-toggle[data-group="${id}"]`
          )
          ?.focus()
      )
    }
  }

  private onGroupMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const id = event.currentTarget.dataset.group
    if (!id) {
      return
    }
    const index = this.state.organization.groups.findIndex(g => g.id === id)
    void showContextualMenu([
      {
        label: 'Move group up',
        enabled: index > 0,
        action: () => this.moveGroup(id, 'up'),
      },
      {
        label: 'Move group down',
        enabled:
          index >= 0 && index < this.state.organization.groups.length - 1,
        action: () => this.moveGroup(id, 'down'),
      },
      { type: 'separator' },
      {
        label: 'Rename group…',
        action: () =>
          this.props.dispatcher.showPopup({
            type: PopupType.RepositoryGroupEditor,
            groupId: id,
          }),
      },
      {
        label: 'Delete group (keep repositories)',
        action: () =>
          this.updateOrganization(
            removeRepositoryGroup(this.state.organization, id)
          ),
      },
    ])
  }

  private onGroupsChanged = () => {
    this.setState({
      organization: readRepositoryOrganization(localStorage),
      groupError: null,
    })
  }

  private clearDropPreview = () => {
    this.dragList?.classList.remove('repository-drag-active')
    this.dragList?.querySelectorAll<HTMLElement>('.list-item').forEach(row => {
      row.style.removeProperty('transform')
    })
    this.dragList?.querySelector('.repository-drop-placeholder')?.remove()
  }

  private clearGroupDragImage = () => {
    this.groupDragImage?.remove()
    this.groupDragImage = null
  }

  private onListDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    this.clearDropPreview()
    this.dropSlot = null
  }

  private onListDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (this.draggedRepository === null && this.draggedGroup === null) {
      return
    }
    event.stopPropagation()
    this.dragList = event.currentTarget
    this.clearDropPreview()
    const scroll = event.currentTarget.querySelector<HTMLElement>(
      '.ReactVirtualized__Grid'
    )
    if (!scroll) {
      return
    }
    const viewport = scroll.getBoundingClientRect()
    if (event.clientY < viewport.top || event.clientY > viewport.bottom) {
      this.dropSlot = null
      return
    }
    if (event.clientY < viewport.top + 36) {
      scroll.scrollTop -= 18
    } else if (event.clientY > viewport.bottom - 36) {
      scroll.scrollTop += 18
    }
    const elements = Array.from(
      scroll.querySelectorAll<HTMLElement>(
        '.repository-custom-group, .repository-activity-row'
      )
    )
    const rows = elements.map(element => {
      const rect = (
        element.closest<HTMLElement>('.list-item') ?? element
      ).getBoundingClientRect()
      return {
        top: rect.top,
        bottom: rect.bottom,
        group: element.dataset.ownerGroup ?? element.dataset.group!,
        repositoryId:
          element.dataset.repositoryId === undefined
            ? undefined
            : Number(element.dataset.repositoryId),
      }
    })
    const slot = findRepositoryDropSlot(
      rows,
      event.clientY,
      this.draggedGroup,
      this.draggedRepository
    )
    this.dropSlot = slot
    if (!slot) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    // Group headers live in nested virtualized grids; moving those cells while
    // overflow is visible causes duplicate or clipped headers.
    if (this.draggedRepository !== null) {
      this.dragList.classList.add('repository-drag-active')
      // Shift row wrappers, leaving their layout positions stable for hit testing.
      elements.forEach((element, index) => {
        const row = element.closest<HTMLElement>('.list-item')
        if (row) {
          row.style.transform = `translateY(${
            rows[index].top >= slot.y - 1 ? 14 : -14
          }px)`
        }
      })
    }
    const groupDrag = this.draggedGroup !== null
    const placeholder = document.createElement('div')
    placeholder.className = `repository-drop-placeholder${
      groupDrag ? ' repository-group-drop-placeholder' : ''
    }`
    placeholder.style.top = `${
      slot.y - this.dragList.getBoundingClientRect().top - (groupDrag ? 1 : 13)
    }px`
    if (!groupDrag) {
      placeholder.textContent = 'Move repository here'
    }
    this.dragList.appendChild(placeholder)
  }

  private onListDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (this.draggedRepository === null && this.draggedGroup === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const slot = this.dropSlot
    if (slot) {
      const source = this.props.repositories.find(
        r => r.id === this.draggedRepository
      )
      const target = this.props.repositories.find(
        r => r.id === slot.repositoryId
      )
      if (this.draggedGroup !== null) {
        this.updateOrganization(
          moveRepositoryGroup(
            this.state.organization,
            this.draggedGroup,
            slot.group,
            slot.position
          )
        )
      } else if (source && target) {
        const fallback = [...this.props.repositories]
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, undefined, {
                sensitivity: 'base',
              }) || a.path.localeCompare(b.path)
          )
          .map(repositoryOrganizationKey)
        this.updateOrganization(
          moveRepository(
            this.state.organization,
            repositoryOrganizationKey(source),
            repositoryOrganizationKey(target),
            slot.group,
            slot.position,
            fallback
          )
        )
      } else if (source) {
        this.assignGroup(repositoryOrganizationKey(source), slot.group)
      }
    }
    this.onRepositoryDragEnd()
  }

  private updateOrganization = (organization: IRepositoryOrganization) => {
    try {
      saveRepositoryOrganization(localStorage, organization)
      this.setState({ organization, groupError: null })
      return true
    } catch {
      this.setState({
        groupError: 'Could not save repository groups. Please try again.',
      })
      return false
    }
  }

  private assignGroup = (path: string, group: string) => {
    this.updateOrganization(
      assignRepository(this.state.organization, path, group)
    )
  }

  private onCreateGroup = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.RepositoryGroupEditor,
      groupId: null,
    })
  }

  private renderGroupError = () =>
    this.state.groupError ? (
      <div className="repository-group-error" role="alert">
        {this.state.groupError}
      </div>
    ) : null

  private onItemClick = (item: IRepositoryListItem) => {
    if (Date.now() < this.suppressClickUntil) {
      return
    }
    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)
    this.props.onSelectionChanged(item.repository)
  }

  private onItemContextMenu = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

    const items = generateRepositoryListContextMenu({
      onRemoveRepository: this.props.onRemoveRepository,
      onShowRepository: this.props.onShowRepository,
      onOpenInShell: this.props.onOpenInShell,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      externalEditorLabel: this.props.externalEditorLabel,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onViewOnGitHub: this.props.onViewOnGitHub,
      onCreateWorktree: enableWorktreeSupport()
        ? this.onCreateWorktree
        : undefined,
      onShowWorktrees: enableWorktreeSupport()
        ? this.onShowWorktrees
        : undefined,
      repository: item.repository,
      shellLabel: this.props.shellLabel,
    })

    showContextualMenu([
      {
        label: 'Move to group',
        submenu: [
          ...this.state.organization.groups.map(g => ({
            label: g.name,
            action: () =>
              this.assignGroup(
                repositoryOrganizationKey(item.repository),
                g.id
              ),
          })),
          {
            label: 'Ungrouped',
            action: () =>
              this.assignGroup(
                repositoryOrganizationKey(item.repository),
                Ungrouped
              ),
          },
        ],
      },
      { type: 'separator' },
      ...items,
    ])
  }

  private getItemAriaLabel = (item: IRepositoryListItem) =>
    `${item.repository.name}${
      item.workingGroupName ? `, group ${item.workingGroupName}` : ''
    }, ${this.getActivityDescription(item)}`
  private getGroupAriaLabelGetter =
    (
      groups: ReadonlyArray<
        IFilterListGroup<IRepositoryListItem, RepositoryGroupIdentifier>
      >
    ) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  public render() {
    const originalGroups = this.getRepositoryGroups(
      this.props.repositories,
      this.props.localRepositoryStateLookup,
      this.props.recentRepositories
    )

    const groups = projectActivityGroups<
      IRepositoryListItem,
      RepositoryGroupIdentifier
    >(
      originalGroups,
      this.state.activity.repositories,
      this.state.activityPreferences,
      '_LocalActivity_',
      this.state.organization
    )
    this.groupCounts = new Map(
      groups.map(group => [
        this.getGroupIdentifierKey(group.identifier),
        group.items.length,
      ])
    )
    const selectedItem =
      groups
        .flatMap(group => group.items)
        .find(item => item.id === this.state.selectedItem?.id) ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    return (
      <div
        className="repository-list"
        onDragOverCapture={this.onListDragOver}
        onDropCapture={this.onListDrop}
        onDragLeave={this.onListDragLeave}
      >
        <SectionFilterList<IRepositoryListItem, RepositoryGroupIdentifier>
          renderPreList={this.renderGroupError}
          showEmptyGroups={!this.state.activityPreferences.onlyUncommitted}
          collapsedGroupIds={new Set(this.state.organization.collapsed ?? [])}
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.props.filterText}
          onFilterTextChanged={this.props.onFilterTextChanged}
          renderItem={this.renderItem}
          renderRowFocusTooltip={this.renderRowFocusTooltip}
          renderGroupHeader={this.renderGroupHeader}
          onItemClick={this.onItemClick}
          onSelectionChanged={this.onListSelectionChanged}
          preserveItemOrder={true}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={groups}
          invalidationProps={{
            organization: this.state.organization,
            dropGroup: this.state.dropGroup,
            dropRepository: this.state.dropRepository,
            dropPosition: this.state.dropPosition,
            activity: this.state.activity,
            activityPreferences: this.state.activityPreferences,
            repositories: this.props.repositories,
            filterText: this.props.filterText,
          }}
          onItemContextMenu={this.onItemContextMenu}
          getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
          getItemAriaLabel={this.getItemAriaLabel}
        />
      </div>
    )
  }

  private onListSelectionChanged = (
    selectedItem: IRepositoryListItem | null
  ) => {
    this.setState({ selectedItem })
  }

  private renderPostFilter = () => {
    return (
      <React.Fragment>
        {this.renderActivityToolbar()}
        <Button
          className="new-repository-button"
          onClick={this.onNewRepositoryButtonClick}
          ariaExpanded={this.state.newRepositoryMenuExpanded}
          onKeyDown={this.onNewRepositoryButtonKeyDown}
        >
          Add
          <Octicon symbol={octicons.triangleDown} />
        </Button>
      </React.Fragment>
    )
  }

  private onNewRepositoryButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      this.onNewRepositoryButtonClick()
    }
  }

  private renderNoItems = () => {
    return (
      <div className="no-items no-results-found">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />
        <div className="title">
          {this.state.activityPreferences.onlyUncommitted
            ? 'No uncommitted repositories match the current filters'
            : "Sorry, I can't find that repository"}
        </div>

        <div className="protip">
          ProTip! Press{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut darwinKeys={['⌘', 'O']} keys={['Ctrl', 'O']} />
          </div>{' '}
          to quickly add a local repository, and{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut
              darwinKeys={['⇧', '⌘', 'O']}
              keys={['Ctrl', 'Shift', 'O']}
            />
          </div>{' '}
          to clone from anywhere within the app
        </div>
      </div>
    )
  }

  private onNewRepositoryButtonClick = () => {
    const items: IMenuItem[] = [
      { label: 'New group…', action: this.onCreateGroup },
      { type: 'separator' },
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: this.onCloneRepository,
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: this.onCreateNewRepository,
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: this.onAddExistingRepository,
      },
    ]

    this.setState({ newRepositoryMenuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ newRepositoryMenuExpanded: false })
    })
  }

  private onCloneRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onAddExistingRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private onCreateNewRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateRepository })
  }

  private onChangeRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })
  }

  private onRemoveRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.changeRepositoryAlias(repository, null)
  }

  private onCreateWorktree = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository,
    })
  }

  private onShowWorktrees = (repository: Repository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.showWorktreesFoldout()
  }
}
