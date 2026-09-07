import type { IRepositoryActivity } from './status'

export type ActivitySort = 'name' | 'dirty-first' | 'recent'
export interface IActivityPreferences {
  readonly onlyUncommitted: boolean
  readonly sort: ActivitySort
}

export interface IActivityStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const PreferencesKey = 'desktop.repository-activity.preferences.v1'
const CacheKey = 'desktop.repository-activity.cache.v1'
const MaximumEntries = 5000

export function isActivitySort(value: string): value is ActivitySort {
  return value === 'name' || value === 'dirty-first' || value === 'recent'
}

export function readActivityPreferences(
  storage: IActivityStorage
): IActivityPreferences {
  try {
    const value = JSON.parse(storage.getItem(PreferencesKey) ?? 'null')
    if (
      value !== null &&
      typeof value === 'object' &&
      isActivitySort(value.sort)
    ) {
      return {
        sort: value.sort,
        onlyUncommitted: value.onlyUncommitted === true,
      }
    }
  } catch {
    // Restricted or malformed storage must not make the repository list fail.
  }
  return { sort: 'recent', onlyUncommitted: false }
}

export function saveActivityPreferences(
  storage: IActivityStorage,
  preferences: IActivityPreferences
): void {
  try {
    storage.setItem(PreferencesKey, JSON.stringify(preferences))
  } catch {
    // Keep the in-memory setting when storage is unavailable or full.
  }
}

function isTimestamp(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= Date.now())
  )
}

export function readActivityCache(
  storage: IActivityStorage
): ReadonlyMap<string, IRepositoryActivity> {
  const result = new Map<string, IRepositoryActivity>()
  try {
    const raw = storage.getItem(CacheKey)
    if (raw === null || raw.length > 4 * 1024 * 1024) {
      return result
    }
    const values = JSON.parse(raw)
    if (!Array.isArray(values)) {
      return result
    }
    for (const entry of values.slice(0, MaximumEntries)) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        continue
      }
      const [path, value] = entry
      if (
        typeof path !== 'string' ||
        path.length === 0 ||
        path.length > 32768 ||
        value === null ||
        typeof value !== 'object' ||
        !Number.isInteger(value.changedFilesCount) ||
        value.changedFilesCount < 0 ||
        typeof value.fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
        !isTimestamp(value.lastChangedAt) ||
        !isTimestamp(value.fileModifiedAt)
      ) {
        continue
      }
      result.set(path, {
        lastCommitAt: isTimestamp(value.lastCommitAt)
          ? value.lastCommitAt
          : null,
        unpushedCount:
          Number.isInteger(value.unpushedCount) && value.unpushedCount >= 0
            ? value.unpushedCount
            : 0,
        changedFilesCount: value.changedFilesCount,
        fingerprint: value.fingerprint,
        fileModifiedAt: value.fileModifiedAt,
        lastChangedAt: value.lastChangedAt,
        checkedAt: 0,
        error: false,
      })
    }
  } catch {
    // A cache is optional; it must never prevent opening a repository.
  }
  return result
}

export function saveActivityCache(
  storage: IActivityStorage,
  cache: ReadonlyMap<string, IRepositoryActivity>
): void {
  try {
    const entries = [...cache]
      .filter(([, item]) => /^[a-f0-9]{64}$/.test(item.fingerprint))
      .slice(0, MaximumEntries)
    storage.setItem(CacheKey, JSON.stringify(entries))
  } catch {
    // No repository contents or credentials are persisted here.
  }
}
