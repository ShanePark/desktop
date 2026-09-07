import { activityKey } from './status'
import type { IActivityStorage } from './preferences'

export const WorkingGroup = '_Working_'
export const Ungrouped = '_Ungrouped_'
export const RepositoryGroupsChangedEvent = 'repository-groups-changed'
const StorageKey = 'desktop.repository-groups.v1'

export interface IRepositoryOrganization {
  readonly groups: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly assignments: Readonly<Record<string, string>>
}

export function readRepositoryOrganization(
  storage: IActivityStorage
): IRepositoryOrganization {
  try {
    const raw = storage.getItem(StorageKey)
    if (raw !== null && raw.length < 4 * 1024 * 1024) {
      const value = JSON.parse(raw)
      if (
        Array.isArray(value?.groups) &&
        typeof value.assignments === 'object' &&
        value.assignments !== null
      ) {
        const ids = new Set<string>()
        const groups = value.groups
          .filter((g: { id: string; name: string }) => {
            if (
              !g ||
              typeof g.id !== 'string' ||
              !/^group-[a-zA-Z0-9-]+$/.test(g.id) ||
              ids.has(g.id) ||
              typeof g.name !== 'string' ||
              !g.name.trim() ||
              g.name.length > 80
            ) {
              return false
            }
            ids.add(g.id)
            return true
          })
          .map((g: { id: string; name: string }) => ({
            id: g.id,
            name: g.name.trim(),
          }))
        const assignments = Object.fromEntries(
          Object.entries(value.assignments).filter(
            ([path, id]) =>
              path.length > 0 && typeof id === 'string' && ids.has(id)
          )
        )
        return { groups, assignments: assignments as Record<string, string> }
      }
    }
  } catch {
    /* Invalid storage must not prevent opening repositories. */
  }
  return { groups: [{ id: 'group-shane', name: 'shane' }], assignments: {} }
}

export function saveRepositoryOrganization(
  storage: IActivityStorage,
  value: IRepositoryOrganization
) {
  storage.setItem(StorageKey, JSON.stringify(value))
}

export function assignRepository(
  value: IRepositoryOrganization,
  path: string,
  group: string
): IRepositoryOrganization {
  if (group !== Ungrouped && !value.groups.some(g => g.id === group)) {
    return value
  }
  const assignments = { ...value.assignments }
  if (group === Ungrouped) {
    delete assignments[activityKey(path)]
  } else {
    assignments[activityKey(path)] = group
  }
  return { ...value, assignments }
}

export function removeRepositoryGroup(
  value: IRepositoryOrganization,
  id: string
): IRepositoryOrganization {
  return {
    groups: value.groups.filter(g => g.id !== id),
    assignments: Object.fromEntries(
      Object.entries(value.assignments).filter(([, group]) => group !== id)
    ),
  }
}

/** Use the same normalization at input time and immediately before saving. */
export function validateRepositoryGroupName(
  value: IRepositoryOrganization,
  name: string,
  id: string | null = null
): string | null {
  const normalized = name.normalize('NFKC').trim().toLowerCase()
  if (!normalized) {
    return 'Enter a group name.'
  }
  if (name.trim().length > 80) {
    return 'Use 80 characters or fewer.'
  }
  if (['working', 'ungrouped'].includes(normalized)) {
    return 'This name is reserved. Choose another group name.'
  }
  if (
    value.groups.some(
      g =>
        g.id !== id &&
        g.name.normalize('NFKC').trim().toLowerCase() === normalized
    )
  ) {
    return 'A group with this name already exists.'
  }
  return null
}

/** Reorder custom groups only; fixed sections never enter the saved array. */
export function moveRepositoryGroup(
  value: IRepositoryOrganization,
  id: string,
  target: string,
  position: 'before' | 'after' = 'before'
): IRepositoryOrganization {
  const group = value.groups.find(g => g.id === id)
  if (
    !group ||
    id === target ||
    (target !== Ungrouped && !value.groups.some(g => g.id === target))
  ) {
    return value
  }
  const groups = value.groups.filter(g => g.id !== id)
  const index =
    target === Ungrouped
      ? groups.length
      : groups.findIndex(g => g.id === target) + (position === 'after' ? 1 : 0)
  groups.splice(index, 0, group)
  return { ...value, groups }
}
