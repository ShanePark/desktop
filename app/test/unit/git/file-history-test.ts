import { describe, it } from 'node:test'
import assert from 'node:assert'
import { writeFile } from 'fs/promises'
import * as Path from 'path'
import { exec } from 'dugite'

import { getCommitDiff } from '../../../src/lib/git/diff'
import { getFileHistory } from '../../../src/lib/git/file-history'
import { Repository } from '../../../src/models/repository'
import { DiffType } from '../../../src/models/diff'
import { AppFileStatusKind } from '../../../src/models/status'
import {
  setupEmptyRepository,
  setupEmptyDirectory,
  setupFixtureRepository,
} from '../../helpers/repositories'
import { makeCommit, switchTo } from '../../helpers/repository-scaffolding'

describe('git/file-history', () => {
  it('follows renames back to the root commit', async t => {
    const path = await setupFixtureRepository(t, 'rename-history-detection')
    const repository = new Repository(path, -1, null, false)

    const history = await getFileHistory(repository, 'NEWER.md')

    assert.deepEqual(
      history.map(entry => entry.commit.summary),
      ['rename with modified text', 'rename with 100% accuracy', 'added a file']
    )
    assert.deepEqual(
      history.map(entry => entry.file.path),
      ['NEWER.md', 'NEW.md', 'OLD.md']
    )
    assert.deepEqual(history[0]?.file.status, {
      kind: AppFileStatusKind.Renamed,
      oldPath: 'NEW.md',
      renameIncludesModifications: true,
      submoduleStatus: undefined,
    })
    assert.deepEqual(history[1]?.file.status, {
      kind: AppFileStatusKind.Renamed,
      oldPath: 'OLD.md',
      renameIncludesModifications: false,
      submoduleStatus: undefined,
    })
    assert.equal(history[2]?.file.status.kind, AppFileStatusKind.New)

    for (const entry of history) {
      const diff = await getCommitDiff(repository, entry.file, entry.commit.sha)
      assert.notEqual(diff.kind, DiffType.Unrenderable)
    }
  })

  it('returns an empty history for an unborn or untracked path', async t => {
    const repository = await setupEmptyRepository(t)

    assert.deepEqual(await getFileHistory(repository, 'unborn.txt'), [])

    await writeFile(Path.join(repository.path, 'untracked.txt'), 'untracked\n')
    assert.deepEqual(await getFileHistory(repository, 'untracked.txt'), [])
  })

  it('does not hide errors for a missing repository', async t => {
    const repository = await setupEmptyDirectory(t)

    await assert.rejects(() => getFileHistory(repository, 'file.txt'))
  })

  it('includes a deleted file and its earlier history', async t => {
    const repository = await setupEmptyRepository(t)

    await makeCommit(repository, {
      entries: [{ path: 'removed.txt', contents: 'before\n' }],
      commitMessage: 'add removed file',
    })
    await makeCommit(repository, {
      entries: [{ path: 'removed.txt', contents: null }],
      commitMessage: 'remove file',
    })

    const history = await getFileHistory(repository, 'removed.txt')

    assert.deepEqual(
      history.map(entry => entry.commit.summary),
      ['remove file', 'add removed file']
    )
    assert.equal(history[0]?.file.status.kind, AppFileStatusKind.Deleted)
    assert.equal(history[1]?.file.status.kind, AppFileStatusKind.New)
  })

  it('preserves paths containing whitespace and newlines', async t => {
    const repository = await setupEmptyRepository(t)
    const filePath = 'file with spaces\nand-a-newline.txt'

    await writeFile(Path.join(repository.path, filePath), 'contents\n')
    await exec(['add', '--', filePath], repository.path)
    await exec(['commit', '-m', 'add special path'], repository.path)

    const history = await getFileHistory(repository, filePath)

    assert.equal(history.length, 1)
    assert.equal(history[0]?.file.path, filePath)
    assert.equal(history[0]?.file.status.kind, AppFileStatusKind.New)
  })

  it('treats wildcard characters in a filename literally', async t => {
    const repository = await setupEmptyRepository(t)
    const literalPath = '[x]*.txt'

    await writeFile(Path.join(repository.path, literalPath), 'literal\n')
    await exec(['add', '--', literalPath], repository.path)
    await exec(['commit', '-m', 'add literal path'], repository.path)

    // This path would be matched by the wildcard pathspec `[x]*.txt` if the
    // history query did not opt in to Git's literal pathspec mode.
    const decoyPath = 'x-decoy.txt'
    await writeFile(Path.join(repository.path, decoyPath), 'decoy\n')
    await exec(['add', '--', decoyPath], repository.path)
    await exec(['commit', '-m', 'add decoy path'], repository.path)

    const history = await getFileHistory(repository, literalPath)

    assert.deepEqual(
      history.map(entry => entry.commit.summary),
      ['add literal path']
    )
    assert.equal(history[0]?.file.path, literalPath)
  })

  it('limits history to commits reachable from the current HEAD', async t => {
    const repository = await setupEmptyRepository(t)

    await makeCommit(repository, {
      entries: [{ path: 'reachable.txt', contents: 'base\n' }],
      commitMessage: 'base',
    })
    await exec(['branch', 'feature'], repository.path)

    await makeCommit(repository, {
      entries: [{ path: 'reachable.txt', contents: 'main\n' }],
      commitMessage: 'main change',
    })

    await switchTo(repository, 'feature')
    await makeCommit(repository, {
      entries: [{ path: 'reachable.txt', contents: 'feature\n' }],
      commitMessage: 'unmerged feature change',
    })

    await switchTo(repository, 'master')
    const history = await getFileHistory(repository, 'reachable.txt')

    assert.deepEqual(
      history.map(entry => entry.commit.summary),
      ['main change', 'base']
    )
  })

  it('includes merged commits while using the first parent for merge diffs', async t => {
    const repository = await setupEmptyRepository(t)
    const initial = 'base-1\nbase-2\nbase-3\nbase-4\nbase-5\n'

    await makeCommit(repository, {
      entries: [{ path: 'merged.txt', contents: initial }],
      commitMessage: 'base',
    })
    await exec(['branch', 'feature'], repository.path)

    await makeCommit(repository, {
      entries: [
        {
          path: 'merged.txt',
          contents: 'main-1\nbase-2\nbase-3\nbase-4\nbase-5\n',
        },
      ],
      commitMessage: 'main change',
    })

    await switchTo(repository, 'feature')
    await makeCommit(repository, {
      entries: [
        {
          path: 'merged.txt',
          contents: 'base-1\nbase-2\nbase-3\nbase-4\nfeature-5\n',
        },
      ],
      commitMessage: 'feature change',
    })

    await switchTo(repository, 'master')
    await exec(
      ['merge', '--no-ff', '-m', 'merge feature', 'feature'],
      repository.path
    )

    const history = await getFileHistory(repository, 'merged.txt')
    assert.equal(history[0]?.commit.summary, 'merge feature')
    assert.equal(history.at(-1)?.commit.summary, 'base')
    assert.deepEqual(
      new Set(history.slice(1, -1).map(entry => entry.commit.summary)),
      new Set(['main change', 'feature change'])
    )

    const mergeEntry = history[0]
    assert(mergeEntry !== undefined)
    assert.equal(
      mergeEntry.file.parentCommitish,
      mergeEntry.commit.parentSHAs[0]
    )

    const mergeDiff = await getCommitDiff(
      repository,
      mergeEntry.file,
      mergeEntry.commit.sha
    )
    assert.equal(mergeDiff.kind, DiffType.Text)
    assert(mergeDiff.kind === DiffType.Text)
    assert.match(mergeDiff.text, /^\+feature-5$/m)
  })
})
