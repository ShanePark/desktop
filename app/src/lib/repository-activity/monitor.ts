import { activityKey, advanceActivity } from './status'
import type { IActivitySample, IRepositoryActivity } from './status'

export interface IActivityState {
  readonly repositories: ReadonlyMap<string, IRepositoryActivity>
  readonly checking: boolean
  readonly completed: number
  readonly total: number
}

export interface IActivityRefreshOptions {
  /** Reuse successful checks newer than this many milliseconds. */
  readonly maxAge?: number
}

const noPriority = (): ReadonlyArray<string> => []

/** Bounded, coalesced scans; stopping cancels queued work and late notifications. */
export class RepositoryActivityMonitor {
  private paths: ReadonlyArray<string> = []
  private generation = 0
  private stopped = false
  private running: Promise<void> | null = null
  private followUp: Promise<void> | null = null
  private pendingMaxAge: number | null = null
  /** Invalidation sequence per key; cleared only by a later-started sample. */
  private invalidations = new Map<string, number>()
  private invalidationCount = 0
  private cache: ReadonlyMap<string, IRepositoryActivity>
  private priority: () => ReadonlyArray<string> = noPriority

  public constructor(
    private readonly sample: (path: string) => Promise<IActivitySample>,
    private readonly changed: (state: IActivityState) => void,
    initial: ReadonlyMap<string, IRepositoryActivity> = new Map(),
    private readonly concurrency = 4,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new Error('Activity scan concurrency must be between 1 and 8')
    }
    this.cache = initial
  }

  public setPaths(paths: ReadonlyArray<string>): boolean {
    const unique = [...new Map(paths.map(p => [activityKey(p), p])).values()]
    const oldKeys = this.paths.map(activityKey).sort()
    const newKeys = unique.map(activityKey).sort()
    const wanted = new Set(newKeys)
    if (
      JSON.stringify(oldKeys) === JSON.stringify(newKeys) &&
      [...this.cache.keys()].every(key => wanted.has(key))
    ) {
      return false
    }
    this.paths = unique
    this.generation++
    this.cache = new Map([...this.cache].filter(([key]) => wanted.has(key)))
    this.invalidations = new Map(
      [...this.invalidations].filter(([key]) => wanted.has(key))
    )
    return true
  }

  /**
   * Each pass checks the registered paths returned by `priority` first, in
   * that order, then the remaining paths in registration order. It is read
   * when a pass starts.
   */
  public setPriority(priority: () => ReadonlyArray<string>): void {
    this.priority = priority
  }

  /**
   * Treat these paths as stale until a sample started after this call
   * completes. Does not start a pass; call `refresh` afterwards.
   */
  public invalidate(paths: ReadonlyArray<string>): void {
    const known = new Set(this.paths.map(activityKey))
    for (const path of paths) {
      const key = activityKey(path)
      if (known.has(key)) {
        this.invalidations.set(key, ++this.invalidationCount)
      }
    }
  }

  public refresh(options: IActivityRefreshOptions = {}): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    const maxAge = options.maxAge ?? 0
    if (!Number.isFinite(maxAge) || maxAge < 0) {
      throw new Error('Activity freshness window must be a non-negative number')
    }
    if (this.running !== null) {
      // The running pass may have sampled some paths before this request, so
      // merge requests into one follow-up pass with the strictest window.
      this.pendingMaxAge = Math.min(this.pendingMaxAge ?? maxAge, maxAge)
      if (this.followUp === null) {
        const next = () => {
          const pending = this.pendingMaxAge ?? 0
          this.pendingMaxAge = null
          this.followUp = null
          return this.refresh({ maxAge: pending })
        }
        this.followUp = this.running.then(next, next)
      }
      return this.followUp
    }
    // Queue the pass so the running promise is assigned before any callback.
    this.running = Promise.resolve()
      .then(() => this.run(maxAge))
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  public stop(): void {
    this.stopped = true
    this.generation++
  }

  private async run(maxAge: number): Promise<void> {
    while (!this.stopped) {
      const generation = this.generation
      const paths = this.prioritizedPaths()
      const results = new Map(this.cache)
      // The invalidation sequence observed when each path's sample started.
      const sampledAfter = new Map<string, number>()
      let next = 0
      let completed = 0
      this.changed({
        repositories: this.cache,
        checking: true,
        completed,
        total: paths.length,
      })
      const worker = async () => {
        while (
          !this.stopped &&
          generation === this.generation &&
          next < paths.length
        ) {
          const path = paths[next++]
          const key = activityKey(path)
          const previous = this.cache.get(key)
          if (this.isFresh(key, previous, maxAge)) {
            completed++
            continue
          }
          sampledAfter.set(key, this.invalidationCount)
          let activity: IRepositoryActivity
          try {
            const sample = await this.sample(path)
            activity = advanceActivity(previous, sample, this.now())
          } catch {
            // An unavailable repository is not a clean repository. Preserve its
            // last known activity, but expose the failure to the view. Keep the
            // time those values were checked, so a newer app-store indicator
            // still replaces them.
            activity = {
              lastCommitAt: previous?.lastCommitAt,
              unpushedCount: previous?.unpushedCount,
              changedFilesCount: previous?.changedFilesCount ?? 0,
              fingerprint: previous?.fingerprint ?? '',
              fileModifiedAt: previous?.fileModifiedAt ?? null,
              lastChangedAt: previous?.lastChangedAt ?? null,
              checkedAt: previous?.checkedAt ?? this.now(),
              error: true,
            }
          }
          results.set(key, activity)
          completed++
          if (
            !this.stopped &&
            generation === this.generation &&
            this.hasMeaningfulChange(previous, activity)
          ) {
            // Publish a snapshot so changed repositories can move to Working
            // without exposing a map that later completions will mutate.
            this.changed({
              repositories: new Map(results),
              checking: true,
              completed,
              total: paths.length,
            })
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(this.concurrency, paths.length) }, worker)
      )
      if (this.stopped) {
        return
      }
      if (generation !== this.generation) {
        continue
      }
      this.cache = results
      for (const [key, sequence] of sampledAfter) {
        if ((this.invalidations.get(key) ?? Infinity) <= sequence) {
          this.invalidations.delete(key)
        }
      }
      this.changed({
        repositories: this.cache,
        checking: false,
        completed,
        total: paths.length,
      })
      return
    }
  }

  private prioritizedPaths(): ReadonlyArray<string> {
    const registered = new Map(this.paths.map(p => [activityKey(p), p]))
    const first = new Map<string, string>()
    for (const path of this.priority()) {
      const key = activityKey(path)
      const match = registered.get(key)
      if (match !== undefined && !first.has(key)) {
        first.set(key, match)
      }
    }
    return [
      ...first.values(),
      ...this.paths.filter(p => !first.has(activityKey(p))),
    ]
  }

  private hasMeaningfulChange(
    previous: IRepositoryActivity | undefined,
    next: IRepositoryActivity
  ): boolean {
    return (
      previous === undefined ||
      previous.changedFilesCount !== next.changedFilesCount ||
      previous.fingerprint !== next.fingerprint ||
      previous.fileModifiedAt !== next.fileModifiedAt ||
      previous.lastChangedAt !== next.lastChangedAt ||
      (previous.lastCommitAt ?? null) !== (next.lastCommitAt ?? null) ||
      (previous.unpushedCount ?? 0) !== (next.unpushedCount ?? 0) ||
      previous.error !== next.error
    )
  }

  private isFresh(
    key: string,
    activity: IRepositoryActivity | undefined,
    maxAge: number
  ): boolean {
    if (
      maxAge === 0 ||
      this.invalidations.has(key) ||
      activity === undefined ||
      activity.error ||
      activity.checkedAt <= 0
    ) {
      return false
    }

    const age = this.now() - activity.checkedAt
    return age >= 0 && age < maxAge
  }
}
