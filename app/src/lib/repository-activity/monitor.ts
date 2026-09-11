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

/** Bounded, coalesced scans; stopping cancels queued work and late notifications. */
export class RepositoryActivityMonitor {
  private paths: ReadonlyArray<string> = []
  private generation = 0
  private stopped = false
  private running: Promise<void> | null = null
  private cache: ReadonlyMap<string, IRepositoryActivity>

  public constructor(
    private readonly sample: (path: string) => Promise<IActivitySample>,
    private readonly changed: (state: IActivityState) => void,
    initial: ReadonlyMap<string, IRepositoryActivity> = new Map(),
    private readonly concurrency = 2,
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
    return true
  }

  public refresh(options: IActivityRefreshOptions = {}): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    if (this.running !== null) {
      return this.running
    }
    const maxAge = options.maxAge ?? 0
    if (!Number.isFinite(maxAge) || maxAge < 0) {
      throw new Error('Activity freshness window must be a non-negative number')
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
      const paths = this.paths
      const results = new Map(this.cache)
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
          if (this.isFresh(previous, maxAge)) {
            completed++
            continue
          }
          try {
            const sample = await this.sample(path)
            results.set(key, advanceActivity(previous, sample, this.now()))
          } catch {
            // An unavailable repository is not a clean repository. Preserve its
            // last known activity, but expose the failure to the view.
            results.set(key, {
              lastCommitAt: previous?.lastCommitAt,
              unpushedCount: previous?.unpushedCount,
              changedFilesCount: previous?.changedFilesCount ?? 0,
              fingerprint: previous?.fingerprint ?? '',
              fileModifiedAt: previous?.fileModifiedAt ?? null,
              lastChangedAt: previous?.lastChangedAt ?? null,
              checkedAt: this.now(),
              error: true,
            })
          }
          completed++
          if (!this.stopped && generation === this.generation) {
            // Publish a snapshot so completed repositories can move to Working
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
      this.changed({
        repositories: this.cache,
        checking: false,
        completed,
        total: paths.length,
      })
      return
    }
  }

  private isFresh(
    activity: IRepositoryActivity | undefined,
    maxAge: number
  ): boolean {
    if (
      maxAge === 0 ||
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
