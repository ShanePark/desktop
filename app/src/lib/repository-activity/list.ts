import {
  WorkingGroup,
  RecentGroup,
  Ungrouped,
  repositoryOrganizationPath,
} from './organization'
import type { IRepositoryOrganization } from './organization'
import { activityKey } from './status'
import type { IRepositoryActivity } from './status'
import type { IActivityPreferences } from './preferences'

export interface IActivityRow {
  readonly id: string
  readonly repository: {
    readonly id: number
    readonly path: string
    readonly name: string
    readonly mainWorktreePath?: string
  }
  readonly worktree?: { readonly type: string; readonly path: string } | null
  readonly text: ReadonlyArray<string>
  readonly aheadBehind?: {
    readonly ahead: number
    readonly behind: number
  } | null
  readonly changedFilesCount: number
  /**
   * When the app store observed `changedFilesCount` and `aheadBehind` for
   * `repository.path`, if it has.
   */
  readonly indicatorObservedAt?: number
  readonly needsDisambiguation: boolean
}

/** Prefix for the item ids of Recent rows, which duplicate saved rows. */
export const RecentItemIdPrefix = 'recent:'

/** The id of the saved row that a Recent row duplicates. */
export function savedItemId(id: string): string {
  return id.startsWith(RecentItemIdPrefix)
    ? id.slice(RecentItemIdPrefix.length)
    : id
}

/**
 * Recent tops up Working to this many rows, but never shows fewer than
 * `RecentMinimum` rows.
 */
export const RecentWorkingTotal = 5
export const RecentMinimum = 3

export interface IActivityListGroup<T, G> {
  readonly identifier: G
  readonly items: ReadonlyArray<T>
}

export function activityPath(row: IActivityRow): string {
  return row.worktree?.path ?? row.repository.path
}

function organizationPath(row: IActivityRow): string {
  return repositoryOrganizationPath(
    row.repository.path,
    row.repository.mainWorktreePath
  )
}

/**
 * The last known activity, including restored or failed checks that preserve
 * earlier values. A failure without an earlier baseline carries no data.
 */
function lastKnownActivity(
  activity: IRepositoryActivity | undefined
): IRepositoryActivity | undefined {
  return activity?.error && activity.fingerprint === '' ? undefined : activity
}

/** The newest known change or commit time, or zero when there is none. */
function activityTime(activity: IRepositoryActivity | undefined): number {
  return Math.max(activity?.lastChangedAt ?? 0, activity?.lastCommitAt ?? 0)
}

/**
 * Whether the row's app-store indicator is newer than the activity snapshot.
 * The app store refreshes it right after in-app commits, pushes, pulls and
 * discards. It describes the repository path, so it never applies to a row
 * whose activity is read from a different worktree path.
 */
export function indicatorIsNewer(
  row: IActivityRow,
  activity: IRepositoryActivity
): boolean {
  return (
    row.indicatorObservedAt !== undefined &&
    row.indicatorObservedAt > activity.checkedAt &&
    activityPath(row) === row.repository.path
  )
}

/**
 * Name mode retains original groups. Activity modes form a globally sorted
 * list. Optional worktree rows stay with their parent for navigation.
 */
export function projectActivityGroups<T extends IActivityRow, G>(
  groups: ReadonlyArray<IActivityListGroup<T, G>>,
  activities: ReadonlyMap<string, IRepositoryActivity>,
  preferences: IActivityPreferences,
  activityGroup: G,
  organization?: IRepositoryOrganization
): ReadonlyArray<IActivityListGroup<T, G>> {
  const snapshot = (row: T) => activities.get(activityKey(activityPath(row)))
  // Unverified and failed snapshots keep rows in place until a successful
  // check or a newer app-store indicator replaces them; the monitor still
  // treats them as stale.
  const newerSnapshot = (row: T) => {
    const activity = lastKnownActivity(snapshot(row))
    return activity === undefined || indicatorIsNewer(row, activity)
      ? undefined
      : activity
  }
  // The newest observation wins. Without an upstream the indicator cannot
  // count unpushed commits, so the snapshot's count is kept for that case.
  const changedFilesCount = (row: T) =>
    newerSnapshot(row)?.changedFilesCount ?? row.changedFilesCount
  const unpushedCount = (row: T) => {
    const activity = newerSnapshot(row)
    return activity === undefined
      ? row.aheadBehind?.ahead ??
          lastKnownActivity(snapshot(row))?.unpushedCount
      : activity.unpushedCount ?? row.aheadBehind?.ahead
  }
  const dirty = (row: T) => changedFilesCount(row) > 0

  const annotate = (row: T): T => {
    if (lastKnownActivity(snapshot(row)) === undefined) {
      return row
    }
    const ahead = unpushedCount(row)
    return {
      ...row,
      changedFilesCount: changedFilesCount(row),
      aheadBehind:
        ahead === undefined
          ? row.aheadBehind
          : { ahead, behind: row.aheadBehind?.behind ?? 0 },
    }
  }

  const families = (items: ReadonlyArray<T>): T[][] => {
    const byRepository = new Map<number, T[]>()
    for (const item of items) {
      const family = byRepository.get(item.repository.id) ?? []
      family.push(annotate(item))
      byRepository.set(item.repository.id, family)
    }
    return [...byRepository.values()].map(rows => {
      const root = rows.find(row => row.worktree?.type !== 'linked')
      return root === undefined
        ? rows
        : [root, ...rows.filter(row => row !== root)]
    })
  }

  if (preferences.sort === 'name' && organization === undefined) {
    return groups
      .map(group => ({ ...group, items: families(group.items).flat() }))
      .filter(group => group.items.length > 0)
  }

  // Recent groups can duplicate rows. Keep each saved row just once.
  const unique = new Map<string, T>()
  for (const group of groups) {
    for (const row of group.items) {
      if (!unique.has(row.id)) {
        unique.set(row.id, row)
      }
    }
  }

  const blocks = families([...unique.values()])
  const label = (row: T) => row.text[0] ?? row.repository.name
  const compareNames = (a: T, b: T) => {
    const name = label(a).localeCompare(label(b), undefined, {
      sensitivity: 'base',
    })
    return (
      name ||
      activityPath(a).localeCompare(activityPath(b)) ||
      a.id.localeCompare(b.id)
    )
  }
  const latest = (rows: ReadonlyArray<T>) =>
    rows.reduce((time, row) => Math.max(time, activityTime(snapshot(row))), 0)
  const compareRows = (a: T, b: T) => {
    const changed =
      preferences.sort === 'dirty-first' || !organization
        ? Number(dirty(b)) - Number(dirty(a))
        : 0
    const recent = preferences.sort === 'recent' ? latest([b]) - latest([a]) : 0
    return changed || recent || compareNames(a, b)
  }

  blocks.sort((a, b) => {
    const changed =
      preferences.sort === 'dirty-first' || !organization
        ? Number(b.some(dirty)) - Number(a.some(dirty))
        : 0
    const recent = preferences.sort === 'recent' ? latest(b) - latest(a) : 0
    return changed || recent || compareNames(a[0], b[0])
  })

  const rows = blocks.flatMap(block => {
    const root = block.find(row => row.worktree?.type !== 'linked')
    const children = block.filter(row => row !== root).sort(compareRows)
    return root === undefined ? children : [root, ...children]
  })
  if (rows.length === 0 && organization === undefined) {
    return []
  }
  // Owner grouping can no longer distinguish equal names.
  const names = new Map<string, Set<string>>()
  for (const row of rows) {
    const name = label(row).toLowerCase()
    const paths = names.get(name) ?? new Set<string>()
    paths.add(activityKey(activityPath(row)))
    names.set(name, paths)
  }
  const annotated = rows.map(row => ({
    ...row,
    needsDisambiguation:
      row.needsDisambiguation ||
      (names.get(label(row).toLowerCase())?.size ?? 0) > 1,
  }))
  if (organization === undefined) {
    return [{ identifier: activityGroup, items: annotated }]
  }
  // Working is a derived view. Keep active repositories here exclusively;
  // their saved assignments determine where they return when activity ends.
  const working = new Set(
    annotated
      .filter(row => dirty(row) || (unpushedCount(row) ?? 0) > 0)
      .map(row => row.repository.id)
  )
  const savedGroupName = (row: T) =>
    organization.groups.find(
      g => g.id === organization.assignments[organizationPath(row)]
    )?.name ?? 'Ungrouped'
  // Recent is also derived: the newest repositories outside Working, always
  // newest first. Unlike Working, its rows also remain in their saved group,
  // so they get distinct item ids while still referring to the same
  // repository.
  const recentLimit = Math.max(RecentWorkingTotal - working.size, RecentMinimum)
  const recent = annotated
    .filter(row => !working.has(row.repository.id) && latest([row]) > 0)
    .sort((a, b) => latest([b]) - latest([a]) || compareNames(a, b))
    .slice(0, recentLimit)
    .map(row => ({
      ...row,
      id: `${RecentItemIdPrefix}${row.id}`,
      recentGroupName: savedGroupName(row),
    }))
  const buckets = new Map<string, T[]>([
    [WorkingGroup, []],
    [RecentGroup, recent],
    ...organization.groups.map(g => [g.id, []] as [string, T[]]),
    [Ungrouped, []],
  ])
  for (const row of annotated) {
    const assigned = organization.assignments[organizationPath(row)]
    const target = assigned && buckets.has(assigned) ? assigned : Ungrouped
    if (working.has(row.repository.id)) {
      buckets.get(WorkingGroup)!.push({
        ...row,
        workingGroupName: savedGroupName(row),
      })
    } else {
      buckets.get(target)!.push(row)
    }
  }
  // `annotated` is already ordered by the selected activity filter. Keep that
  // order while assigning rows to their saved groups so every section follows
  // the same sort order.
  return [...buckets].map(([identifier, items]) => ({
    identifier: identifier as G,
    items:
      identifier === WorkingGroup || identifier === RecentGroup
        ? items
        : families(items).flatMap(block => {
            const root = block.find(row => row.worktree?.type !== 'linked')
            const children = block.filter(row => row !== root)
            return root ? [root, ...children] : children
          }),
  }))
}

/**
 * The paths an activity pass should check first: the selected repository,
 * then the Working rows of `projected`, then the other rows by last known
 * activity, newest first. Rows without known activity are left out, so the
 * monitor checks them last in registration order.
 */
export function activityScanPriority<T extends IActivityRow, G>(
  projected: ReadonlyArray<IActivityListGroup<T, G>>,
  activities: ReadonlyMap<string, IRepositoryActivity>,
  selectedPath: string | null
): ReadonlyArray<string> {
  const time = (row: T) =>
    activityTime(activities.get(activityKey(activityPath(row))))
  const byTime = (rows: ReadonlyArray<T>) =>
    [...rows].sort((a, b) => time(b) - time(a))
  const working = projected.find(g => g.identifier === WorkingGroup)
  const others = projected
    .filter(g => g !== working)
    .flatMap(g => g.items)
    .filter(row => time(row) > 0)
  return [
    ...(selectedPath === null ? [] : [selectedPath]),
    ...byTime(working?.items ?? []).map(activityPath),
    ...byTime(others).map(activityPath),
  ]
}

/** Restore activity order after text matching has ranked results by score. */
export function preserveActivityOrder<
  T extends { readonly item: { readonly id: string } }
>(matches: ReadonlyArray<T>, rowIds: ReadonlyArray<string>): ReadonlyArray<T> {
  const ranks = new Map(rowIds.map((id, index) => [id, index]))
  return [...matches].sort(
    (a, b) =>
      (ranks.get(a.item.id) ?? Number.MAX_SAFE_INTEGER) -
      (ranks.get(b.item.id) ?? Number.MAX_SAFE_INTEGER)
  )
}
