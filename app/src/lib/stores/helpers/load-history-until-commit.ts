/**
 * Load history batches until the given commit is listed.
 *
 * Loading stops when a batch adds no commits: the end of the history has been
 * reached, the commit is not reachable from the listed history, or another
 * request for the same batch is already in flight.
 *
 * @returns Whether the commit is listed.
 */
export async function loadHistoryUntilCommitIsListed(
  sha: string,
  getCommitSHAs: () => ReadonlyArray<string>,
  loadNextBatch: () => Promise<void>
): Promise<boolean> {
  let commitSHAs = getCommitSHAs()

  while (!commitSHAs.includes(sha)) {
    const previousCount = commitSHAs.length
    await loadNextBatch()
    commitSHAs = getCommitSHAs()

    if (commitSHAs.length <= previousCount) {
      return false
    }
  }

  return true
}
