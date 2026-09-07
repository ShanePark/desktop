import * as React from 'react'

import { RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryGroupIdentifier,
  KnownRepositoryGroup,
  makeRecentRepositoriesGroup,
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
import { TooltippedContent } from '../lib/tooltipped-content'
import memoizeOne from 'memoize-one'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
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

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')

const recentRepositoriesThreshold = 7

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
  readonly newRepositoryMenuExpanded: boolean
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<IFilterListGroup<IRepositoryListItem>>,
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

  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
    ) =>
      repositories === null
        ? []
        : groupRepositories(repositories, localRepositoryStateLookup)
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
    document.addEventListener('visibilitychange', this.refreshVisibleActivity)
    this.activityTimer = window.setInterval(this.refreshVisibleActivity, 15000)
  }

  public componentDidUpdate(previous: IRepositoriesListProps) {
    if (previous.selectedRepository !== this.props.selectedRepository) {
      this.setState({ selectedItem: null })
    }
    if (previous.repositories !== this.props.repositories) {
      if (this.updateActivityPaths()) {
        this.refreshActivity()
      }
    }
  }

  public componentWillUnmount() {
    this.activityMonitor.stop()
    window.clearInterval(this.activityTimer)
    window.removeEventListener('focus', this.refreshActivity)
    document.removeEventListener('visibilitychange', this.refreshVisibleActivity)
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
      activity={this.state.activity}
      onChange={this.onActivityPreferencesChanged}
      onRefresh={this.refreshActivity}
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
    if (activity.changedFilesCount === 0) {
      return 'No uncommitted changes'
    }
    const time =
      activity.lastChangedAt === null
        ? 'last change time unknown'
        : `last local change ${new Date(
            activity.lastChangedAt
          ).toLocaleString()} (estimated)`
    return `${activity.changedFilesCount} changed files; ${time}`
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const repository = item.repository
    return (
      <div
        key={repository.id}
        className="repository-activity-row"
        title={this.getActivityDescription(item)}
      >
        <RepositoryListItem
          repository={repository}
          needsDisambiguation={item.needsDisambiguation}
          matches={matches}
          aheadBehind={item.aheadBehind}
          changedFilesCount={item.changedFilesCount}
        />
      </div>
    )
  }

  private getGroupLabel(identifier: RepositoryGroupIdentifier) {
    if (identifier === '_LocalActivity_') {
      return 'Local working copies'
    } else if (identifier === KnownRepositoryGroup.Enterprise) {
      return 'Enterprise'
    } else if (identifier === KnownRepositoryGroup.NonGitHub) {
      return 'Other'
    } else {
      return identifier
    }
  }

  private renderGroupHeader = (id: string) => {
    const identifier = id as RepositoryGroupIdentifier
    const label = this.getGroupLabel(identifier)

    return (
      <TooltippedContent
        key={identifier}
        className="filter-list-group-header"
        tooltip={label}
        onlyWhenOverflowed={true}
        tagName="div"
      >
        {label}
      </TooltippedContent>
    )
  }

  private onItemClick = (item: IRepositoryListItem) => {
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
      repository: item.repository,
      shellLabel: this.props.shellLabel,
    })

    showContextualMenu(items)
  }

  private getItemAriaLabel = (item: IRepositoryListItem) =>
    `${item.repository.name}, ${this.getActivityDescription(item)}`
  private getGroupAriaLabelGetter =
    (groups: ReadonlyArray<IFilterListGroup<IRepositoryListItem>>) =>
    (group: number) =>
      groups[group].identifier

  public render() {
    const baseGroups = this.getRepositoryGroups(
      this.props.repositories,
      this.props.localRepositoryStateLookup
    )

    const originalGroups =
      this.props.repositories.length > recentRepositoriesThreshold
        ? [
            makeRecentRepositoriesGroup(
              this.props.recentRepositories,
              this.props.repositories,
              this.props.localRepositoryStateLookup
            ),
            ...baseGroups,
          ]
        : baseGroups

    const groups = projectActivityGroups(
      originalGroups,
      this.state.activity.repositories,
      this.state.activityPreferences,
      '_LocalActivity_'
    )
    const selectedItem =
      groups
        .flatMap(group => group.items)
        .find(item => item.id === this.state.selectedItem?.id) ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    return (
      <div className="repository-list">
        <SectionFilterList<IRepositoryListItem>
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.props.filterText}
          onFilterTextChanged={this.props.onFilterTextChanged}
          renderItem={this.renderItem}
          renderGroupHeader={this.renderGroupHeader}
          onItemClick={this.onItemClick}
          onSelectionChanged={this.onListSelectionChanged}
          renderPreList={this.renderActivityToolbar}
          preserveItemOrder={this.state.activityPreferences.sort !== 'name'}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={groups}
          invalidationProps={{
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

  private onListSelectionChanged = (selectedItem: IRepositoryListItem | null) => {
    this.setState({ selectedItem })
  }

  private renderPostFilter = () => {
    return (
      <Button
        className="new-repository-button"
        onClick={this.onNewRepositoryButtonClick}
        ariaExpanded={this.state.newRepositoryMenuExpanded}
      >
        Add
        <Octicon symbol={octicons.triangleDown} />
      </Button>
    )
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
}
