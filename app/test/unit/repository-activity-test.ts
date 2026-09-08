import { describe, it } from 'node:test'
import assert from 'node:assert'
import { execFile } from 'child_process'
import * as Path from 'path'
import { promisify } from 'util'

const run = promisify(execFile)

// These runners also work without Electron, making the feature testable when
// the older application's full native build dependencies are unavailable.
// They create and delete only temporary repositories, never user repositories.
describe('repository activity', () => {
  const runners = [
    ['test-repository-activity.cjs', '45/45 tests passed'],
    ['test-repository-activity-ui.cjs', '24/24 UI wiring tests passed'],
    ['test-repository-groups.cjs', '10/10 repository group tests passed'],
  ] as const

  for (const [script, expected] of runners) {
    it(`passes ${script}`, { timeout: 90000 }, async () => {
      const { stdout } = await run(
        process.execPath,
        [Path.resolve(__dirname, '../../../script', script)],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        }
      )
      assert.ok(stdout.includes(expected))
    })
  }
})
