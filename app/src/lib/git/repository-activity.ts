import { git } from './core'
import { sampleRepositoryActivity } from '../repository-activity/status'

/** Use Desktop's bundled Git; do not depend on a separately installed git. */
export async function readRepositoryActivity(path: string) {
  const sample = await sampleRepositoryActivity(path, async root => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const result = await git(
        [
          '--no-optional-locks',
          '-c',
          'core.fsmonitor=false',
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--ignore-submodules=none',
        ],
        root,
        'repository-activity',
        {
          isBackgroundTask: true,
          signal: controller.signal,
          maxBuffer: 16 * 1024 * 1024,
        }
      )
      return result.stdout
    } finally {
      clearTimeout(timeout)
    }
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const read = (args: string[], successExitCodes = new Set([0])) =>
    git(
      ['--no-optional-locks', ...args],
      path,
      'repository-activity-metadata',
      {
        isBackgroundTask: true,
        signal: controller.signal,
        maxBuffer: 1024 * 1024,
        successExitCodes,
      }
    )
  try {
    // Match the active branch: old local branches must not make it Working.
    // Remote refs are local snapshots; this scanner never contacts a server.
    const commit = await read(
      ['log', '-1', '--format=%ct', 'HEAD'],
      new Set([0, 128])
    )
    let unpushedCount = 0
    if (commit.exitCode === 0) {
      const upstream = await read(
        ['rev-parse', '--verify', '--quiet', '@{upstream}'],
        new Set([0, 1, 128])
      )
      const unpublished = await read([
        'rev-list',
        '--count',
        'HEAD',
        '--not',
        ...(upstream.exitCode === 0 ? [upstream.stdout.trim()] : ['--remotes']),
        '--',
      ])
      unpushedCount = Number(unpublished.stdout.trim())
    }
    const seconds = Number(commit.stdout.trim())
    return {
      ...sample,
      unpushedCount,
      lastCommitAt:
        commit.exitCode === 0 && seconds > 0
          ? Math.min(Date.now(), seconds * 1000)
          : null,
    }
  } finally {
    clearTimeout(timeout)
  }
}
