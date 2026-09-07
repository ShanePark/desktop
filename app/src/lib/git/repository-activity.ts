import { git } from './core'
import { sampleRepositoryActivity } from '../repository-activity/status'

/** Use Desktop's bundled Git; do not depend on a separately installed git. */
export function readRepositoryActivity(path: string) {
  return sampleRepositoryActivity(path, async root => {
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
}
