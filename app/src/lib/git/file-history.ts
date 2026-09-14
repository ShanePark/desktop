import { git, GitError } from './core'
import { parseRawUnfoldedTrailers } from './interpret-trailers'

import { Commit } from '../../models/commit'
import { CommitIdentity } from '../../models/commit-identity'
import { Repository } from '../../models/repository'
import {
  AppFileStatus,
  AppFileStatusKind,
  CommittedFileChange,
} from '../../models/status'

/** A commit and the change to the requested file made by that commit. */
export interface IFileHistoryEntry {
  readonly commit: Commit
  readonly file: CommittedFileChange
}

/**
 * Return the commits reachable from HEAD which changed `path`, newest first.
 *
 * Git's `--follow` option follows a single file through renames. The
 * `--diff-merges=first-parent` option makes a merge's file change match the
 * diff shown by getCommitDiff, while leaving traversal unrestricted so commits
 * brought in by a merged branch are still included in the history.
 */
export async function getFileHistory(
  repository: Repository,
  path: string
): Promise<ReadonlyArray<IFileHistoryEntry>> {
  if (path.length === 0) {
    // Avoid an empty pathspec matching every file, while still surfacing a
    // missing or invalid repository to callers.
    await git(['rev-parse', '--git-dir'], repository.path, 'getFileHistoryRepo')
    return []
  }

  const format = [
    '%H',
    '%h',
    '%s',
    '%b',
    '%an <%ae> %ad',
    '%cn <%ce> %cd',
    '%P',
    '%(trailers:unfold,only)',
    '%D',
  ].join('%x00')

  const args = [
    'log',
    'HEAD',
    '--follow',
    '--diff-merges=first-parent',
    '-M',
    '--name-status',
    '--date=raw',
    `--format=${format}%x00`,
    '--no-show-signature',
    '--no-color',
    '-z',
    '--',
    `:(top,literal)${path}`,
  ]

  const result = await git(args, repository.path, 'getFileHistory', {
    successExitCodes: new Set([0, 128]),
  })

  // `git log HEAD` exits with 128 when HEAD is unborn. Treat that the same as
  // an untracked path, which has no committed history.
  if (result.exitCode === 128) {
    if (await isUnbornHead(repository)) {
      return []
    }

    throw new GitError(result, args, '')
  }

  return parseFileHistory(result.stdout)
}

async function isUnbornHead(repository: Repository): Promise<boolean> {
  const headRef = await git(
    ['symbolic-ref', '--quiet', 'HEAD'],
    repository.path,
    'getFileHistoryHeadRef',
    {
      successExitCodes: new Set([0, 1, 128]),
    }
  )

  if (headRef.exitCode !== 0) {
    return false
  }

  const ref = headRef.stdout.trim()
  if (ref.length === 0) {
    return false
  }

  const refResult = await git(
    ['show-ref', '--verify', '--quiet', ref],
    repository.path,
    'getFileHistoryHeadRefValue',
    {
      successExitCodes: new Set([0, 1, 128]),
    }
  )

  return refResult.exitCode === 1
}

function parseFileHistory(stdout: string): ReadonlyArray<IFileHistoryEntry> {
  const tokens = stdout.split('\0')
  const entries = new Array<IFileHistoryEntry>()
  let ix = 0

  while (ix < tokens.length - 1) {
    const sha = tokens[ix++]

    // The output is NUL-delimited, but Git may leave an empty final token.
    // Ignore empty records rather than attempting to parse them as commits.
    if (sha.length === 0) {
      continue
    }

    const shortSha = tokens[ix++]
    const summary = tokens[ix++]
    const body = tokens[ix++]
    const author = tokens[ix++]
    const committer = tokens[ix++]
    const parents = tokens[ix++]
    const trailers = tokens[ix++]
    const refs = tokens[ix++]

    if (
      shortSha === undefined ||
      summary === undefined ||
      body === undefined ||
      author === undefined ||
      committer === undefined ||
      parents === undefined ||
      trailers === undefined ||
      refs === undefined
    ) {
      break
    }

    // The final NUL in the format and the newline Git places before a
    // name-status record result in one or more empty tokens here.
    while (ix < tokens.length && tokens[ix] === '') {
      ix++
    }

    const rawStatus = tokens[ix++]?.replace(/^\n+/, '')
    if (rawStatus === undefined || rawStatus.length === 0) {
      continue
    }

    const oldPath = /^R|^C/.test(rawStatus) ? tokens[ix++] : undefined
    const filePath = tokens[ix++]
    if (filePath === undefined) {
      break
    }

    const commit = new Commit(
      sha,
      shortSha,
      summary.substring(0, 100 * 1024),
      body.substring(0, 100 * 1024),
      CommitIdentity.parseIdentity(author),
      CommitIdentity.parseIdentity(committer),
      parents.length > 0 ? parents.split(' ') : [],
      parseRawUnfoldedTrailers(trailers, ':'),
      parseTags(refs)
    )

    const status = mapStatus(rawStatus, oldPath)
    const parentCommitish = commit.parentSHAs[0] ?? `${sha}^`
    const file = new CommittedFileChange(filePath, status, sha, parentCommitish)

    entries.push({ commit, file })
  }

  return entries
}

function parseTags(refs: string): ReadonlyArray<string> {
  return refs
    .split(', ')
    .flatMap(ref => (ref.startsWith('tag: ') ? ref.substring(5) : []))
}

function mapStatus(
  rawStatus: string,
  oldPath: string | undefined
): AppFileStatus {
  const status = rawStatus.trim()

  switch (status[0]) {
    case 'A':
      return { kind: AppFileStatusKind.New, submoduleStatus: undefined }
    case 'D':
      return { kind: AppFileStatusKind.Deleted, submoduleStatus: undefined }
    case 'R':
      return oldPath === undefined
        ? { kind: AppFileStatusKind.Modified, submoduleStatus: undefined }
        : {
            kind: AppFileStatusKind.Renamed,
            oldPath,
            renameIncludesModifications: status !== 'R100',
            submoduleStatus: undefined,
          }
    case 'C':
      return oldPath === undefined
        ? { kind: AppFileStatusKind.Modified, submoduleStatus: undefined }
        : {
            kind: AppFileStatusKind.Copied,
            oldPath,
            renameIncludesModifications: false,
            submoduleStatus: undefined,
          }
    default:
      return { kind: AppFileStatusKind.Modified, submoduleStatus: undefined }
  }
}
