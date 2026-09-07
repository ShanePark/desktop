import { WorkingGroup, Ungrouped } from './organization'
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
  }
  readonly worktree?: { readonly type: string; readonly path: string } | null
  readonly text: ReadonlyArray<string>
  readonly aheadBehind?: {
    readonly ahead: number
    readonly behind: number
  } | null
  readonly changedFilesCount: number
  readonly needsDisambiguation: boolean
}

export interface IActivityListGroup<T, G> {
  readonly identifier: G
  readonly items: ReadonlyArray<T>
}

export function activityPath(row: IActivityRow): string {
  return row.worktree?.path ?? row.repository.path
}

export function activityIsUnknown(
  activity: IRepositoryActivity | undefined
): boolean {
  return activity === undefined || activity.error || activity.checkedAt === 0
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
  const dirty = (row: T) =>
    (snapshot(row)?.changedFilesCount ?? row.changedFilesCount) > 0
  const include = (row: T) =>
    !preferences.onlyUncommitted ||
    row.repository.id < 0 ||
    dirty(row) ||
    activityIsUnknown(snapshot(row))

  const annotate = (row: T): T => {
    const activity = snapshot(row)
    if (activity === undefined || activity.error || activity.checkedAt === 0) {
      return row
    }
    return {
      ...row,
      changedFilesCount: activity.changedFilesCount,
      aheadBehind:
        activity.unpushedCount === undefined
          ? row.aheadBehind
          : {
              ahead: activity.unpushedCount,
              behind: row.aheadBehind?.behind ?? 0,
            },
    }
  }

  const families = (items: ReadonlyArray<T>): T[][] => {
    const byRepository = new Map<number, T[]>()
    for (const item of items) {
      const family = byRepository.get(item.repository.id) ?? []
      family.push(annotate(item))
      byRepository.set(item.repository.id, family)
    }
    return [...byRepository.values()]
      .map(rows => {
        const visible = rows.filter(include)
        if (visible.length === 0) {
          return []
        }
        const root = rows.find(row => row.worktree?.type !== 'linked')
        // Keep a clean parent as context for a matching linked worktree.
        return root === undefined
          ? visible
          : [root, ...visible.filter(row => row !== root)]
      })
      .filter(rows => rows.length > 0)
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
    rows.reduce(
      (time, row) =>
        Math.max(
          time,
          snapshot(row)?.lastChangedAt ?? 0,
          snapshot(row)?.lastCommitAt ?? 0
        ),
      0
    )
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
  // Each repository appears once. Working takes precedence over its saved
  // group, which remains assigned when it becomes clean and pushed again.
  const working = new Set(
    annotated
      .filter(
        row =>
          dirty(row) ||
          (snapshot(row)?.unpushedCount ?? row.aheadBehind?.ahead ?? 0) > 0
      )
      .map(row => row.repository.id)
  )
  const buckets = new Map<string, T[]>([
    [WorkingGroup, []],
    ...organization.groups.map(g => [g.id, []] as [string, T[]]),
    [Ungrouped, []],
  ])
  for (const row of annotated) {
    const assigned = organization.assignments[activityKey(row.repository.path)]
    const target = working.has(row.repository.id)
      ? WorkingGroup
      : assigned && buckets.has(assigned)
      ? assigned
      : Ungrouped
    buckets
      .get(target)!
      .push({
        ...row,
        workingGroupName:
          target === WorkingGroup
            ? organization.groups.find(g => g.id === assigned)?.name ??
              'Ungrouped'
            : undefined,
      })
  }
  return [...buckets].map(([identifier, items]) => ({
    identifier: identifier as G,
    items,
  }))
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
