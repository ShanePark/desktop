import { describe, it } from 'node:test'
import assert from 'node:assert'

import { loadHistoryUntilCommitIsListed } from '../../src/lib/stores/helpers/load-history-until-commit'

function createHistory(batches: ReadonlyArray<ReadonlyArray<string>>) {
  let commitSHAs: ReadonlyArray<string> = batches[0] ?? []
  let loadCount = 0

  return {
    getCommitSHAs: () => commitSHAs,
    loadNextBatch: async () => {
      loadCount++
      commitSHAs = [...commitSHAs, ...(batches[loadCount] ?? [])]
    },
    get loadCount() {
      return loadCount
    },
  }
}

describe('loadHistoryUntilCommitIsListed', () => {
  it('does not load more history when the commit is already listed', async () => {
    const history = createHistory([['a', 'b']])

    assert.equal(
      await loadHistoryUntilCommitIsListed(
        'b',
        history.getCommitSHAs,
        history.loadNextBatch
      ),
      true
    )
    assert.equal(history.loadCount, 0)
  })

  it('loads batches until the commit is listed', async () => {
    const history = createHistory([['a'], ['b'], ['c'], ['d']])

    assert.equal(
      await loadHistoryUntilCommitIsListed(
        'c',
        history.getCommitSHAs,
        history.loadNextBatch
      ),
      true
    )
    assert.equal(history.loadCount, 2)
  })

  it('stops when a batch adds no commits', async () => {
    const history = createHistory([['a'], ['b']])

    assert.equal(
      await loadHistoryUntilCommitIsListed(
        'missing',
        history.getCommitSHAs,
        history.loadNextBatch
      ),
      false
    )
    assert.equal(history.loadCount, 2)
  })
})
