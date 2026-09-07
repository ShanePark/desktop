import { createHash } from 'crypto'
import { promises as Fs } from 'fs'
import * as Path from 'path'

export interface IActivitySample {
  readonly lastCommitAt?: number | null
  readonly unpushedCount?: number
  readonly changedFilesCount: number
  readonly fingerprint: string
  /** A filesystem estimate, not a Git commit or last-opened timestamp. */
  readonly fileModifiedAt: number | null
}

export interface IRepositoryActivity extends IActivitySample {
  readonly lastChangedAt: number | null
  /** Zero means a restored, not yet revalidated cache entry. */
  readonly checkedAt: number
  readonly error: boolean
}

export interface IStatusPath {
  readonly status: string
  readonly path: string
  readonly oldPath?: string
}

export type ReadStatus = (path: string) => Promise<string>

export function activityKey(path: string): string {
  const absolute = Path.resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Parse porcelain v1 -z. In this format rename destinations precede sources. */
export function parseActivityStatus(
  output: string
): ReadonlyArray<IStatusPath> {
  if (output === '') {
    return []
  }
  if (!output.endsWith('\0')) {
    throw new Error('Incomplete repository status output')
  }

  const records = output.slice(0, -1).split('\0')
  const entries: IStatusPath[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const status = record.slice(0, 2)
    if (
      record.length < 4 ||
      record[2] !== ' ' ||
      !/^[ MADRCUT?!]{2}$/.test(status)
    ) {
      throw new Error('Unexpected repository status record')
    }
    const path = record.slice(3)
    const renamed = /[RC]/.test(status)
    const oldPath = renamed ? records[++i] : undefined
    if (renamed && !oldPath) {
      throw new Error('Incomplete rename status record')
    }
    if (status !== '!!' && status !== '  ') {
      entries.push({ status, path, oldPath })
    }
  }
  return entries
}

/** Reject paths outside the worktree, even if a status provider is malformed. */
function resolveStatusPath(root: string, path: string): string {
  if (Path.isAbsolute(path)) {
    throw new Error('Absolute path in repository status')
  }
  const absolute = Path.resolve(root, path)
  const relative = Path.relative(Path.resolve(root), absolute)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${Path.sep}`)
  ) {
    throw new Error('Path outside repository in status')
  }
  return absolute
}

/**
 * Read only paths Git reports as changed. No additional tree walk, file-content hashing,
 * index writes, fetches, or recursive filesystem watchers are needed.
 */
export async function sampleRepositoryActivity(
  root: string,
  readStatus: ReadStatus,
  now = Date.now()
): Promise<IActivitySample> {
  const entries = [...parseActivityStatus(await readStatus(root))].sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  )
  const details: string[] = new Array(entries.length)
  let fileModifiedAt: number | null = null
  let next = 0

  const inspect = async () => {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]
      const path = resolveStatusPath(root, entry.path)
      if (entry.oldPath !== undefined) {
        resolveStatusPath(root, entry.oldPath)
      }
      let metadata: ReadonlyArray<string | number>
      try {
        // lstat observes a symlink itself rather than its target.
        const stat = await Fs.lstat(path)
        if (stat.isDirectory()) {
          // A dirty submodule is one changed entry. Directory mtimes are not
          // evidence of the last edit inside it (nor are build-cache writes).
          metadata = ['directory', stat.mode]
        } else {
          metadata = [
            stat.mtimeMs,
            stat.ctimeMs,
            stat.size,
            stat.mode,
            stat.ino,
          ]
          const mtime = Math.min(now, stat.mtimeMs)
          if (Number.isFinite(mtime) && mtime > 0) {
            fileModifiedAt = Math.max(fileModifiedAt ?? 0, mtime)
          }
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          throw error
        }
        // Deleted files have no mtime. Do not substitute the repository
        // directory/index mtime or claim that they were just edited.
        metadata = ['missing']
      }
      details[index] = JSON.stringify([
        entry.status,
        entry.path,
        entry.oldPath,
        metadata,
      ])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(8, entries.length) }, inspect)
  )

  return {
    changedFilesCount: entries.length,
    fingerprint: createHash('sha256').update(details.join('\0')).digest('hex'),
    fileModifiedAt,
  }
}

/** Rechecking an unchanged dirty tree must never make it look newly edited. */
export function advanceActivity(
  previous: IRepositoryActivity | undefined,
  sample: IActivitySample,
  checkedAt: number
): IRepositoryActivity {
  let lastChangedAt: number | null = null
  if (sample.changedFilesCount > 0) {
    if (previous === undefined || previous.fingerprint === '') {
      lastChangedAt = sample.fileModifiedAt
    } else if (previous.fingerprint === sample.fingerprint) {
      lastChangedAt = previous.lastChangedAt ?? sample.fileModifiedAt
    } else {
      // Prefer real mtime evidence, so scan order after a long absence does
      // not reorder repositories by the time their status command finished.
      // Deletion/staging or timestamp-preserving edits need observation time.
      const mtime = sample.fileModifiedAt
      lastChangedAt =
        mtime !== null &&
        mtime > previous.checkedAt &&
        mtime > (previous.fileModifiedAt ?? 0)
          ? mtime
          : checkedAt
    }
  }
  lastChangedAt =
    Math.max(
      lastChangedAt ?? 0,
      sample.lastCommitAt ?? 0,
      sample.lastCommitAt !== undefined ? previous?.lastChangedAt ?? 0 : 0
    ) || null
  return { ...sample, lastChangedAt, checkedAt, error: false }
}
