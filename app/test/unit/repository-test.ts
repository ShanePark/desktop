import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  Repository,
  getGitHubHtmlUrl,
  getRepositoryHtmlUrl,
} from '../../src/models/repository'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

describe('Repository', () => {
  describe('GitHub URL without API metadata', () => {
    const repository = new Repository('/repo', -1, null, false)

    for (const url of [
      'https://github.com/shiftkey/desktop.git',
      'https://github.com/shiftkey/desktop.git/',
      'git@github.com:shiftkey/desktop.git',
      'ssh://git@github.com/shiftkey/desktop.git',
      'https://GITHUB.COM/shiftkey/desktop',
      'https://user:password@github.com/shiftkey/desktop.git',
    ]) {
      it(`opens the repository for ${url}`, () => {
        assert.equal(
          getGitHubHtmlUrl(repository, { name: 'upstream', url }),
          'https://github.com/shiftkey/desktop'
        )
      })
    }

    for (const url of [
      'https://gitlab.com/shiftkey/desktop.git',
      'https://github.com.example.org/shiftkey/desktop.git',
      '/local/repository',
      'invalid',
    ]) {
      it(`does not treat ${url} as GitHub`, () => {
        assert.equal(
          getGitHubHtmlUrl(repository, { name: 'origin', url }),
          null
        )
      })
    }

    it('returns null without a remote', () => {
      assert.equal(getGitHubHtmlUrl(repository), null)
    })

    it('falls back when GitHub metadata has no HTML URL', () => {
      const repositoryWithIncompleteMetadata = new Repository(
        '/repo',
        -1,
        new GitHubRepository(
          'desktop',
          new Owner('shiftkey', 'https://api.github.com', -1),
          -1,
          null,
          null,
          null
        ),
        false
      )

      assert.equal(
        getGitHubHtmlUrl(repositoryWithIncompleteMetadata, {
          name: 'origin',
          url: 'git@github.com:shiftkey/desktop.git',
        }),
        'https://github.com/shiftkey/desktop'
      )
    })
  })

  describe('repository URL without API metadata', () => {
    const repository = new Repository('/repo', -1, null, false)

    for (const url of [
      'https://gitlab.com/group/subgroup/project.git',
      'http://gitlab.example.com/group/subgroup/project.git',
      'https://gitlab.example.com/group/my%20project.git',
      'git@gitlab.com:group/subgroup/project.git',
      'ssh://git@gitlab.com:2222/group/subgroup/project.git',
      'git:gitlab.com/group/subgroup/project.git',
    ]) {
      it(`opens the repository for ${url}`, () => {
        const expected = url.includes('my%20project')
          ? 'https://gitlab.example.com/group/my%20project'
          : `${url.startsWith('http://') ? 'http' : 'https'}://gitlab${
              url.startsWith('http://') ? '.example.com' : '.com'
            }/group/subgroup/project`
        assert.equal(
          getRepositoryHtmlUrl(repository, { name: 'origin', url }),
          expected
        )
      })
    }

    it('keeps GitHub remotes available through the generic helper', () => {
      assert.equal(
        getRepositoryHtmlUrl(repository, {
          name: 'origin',
          url: 'git@github.com:owner/project.git',
        }),
        'https://github.com/owner/project'
      )
    })

    it('returns null for malformed or missing remotes', () => {
      assert.equal(getRepositoryHtmlUrl(repository), null)
      assert.equal(
        getRepositoryHtmlUrl(repository, {
          name: 'origin',
          url: 'https://gitlab.com/group/',
        }),
        null
      )
    })
  })

  describe('name', () => {
    it('uses the last path component as the name', async () => {
      const repoPath = '/some/cool/path'
      const repository = new Repository(repoPath, -1, null, false)
      assert.equal(repository.name, 'path')
    })

    it('handles repository at root of the drive', async () => {
      const repoPath = 'T:\\'
      const repository = new Repository(repoPath, -1, null, false)
      assert.equal(repository.name, 'T:\\')
    })
  })
})
