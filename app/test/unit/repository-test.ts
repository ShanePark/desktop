import { Repository, getGitHubHtmlUrl } from '../../src/models/repository'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

describe('Repository', () => {
  describe('GitHub URL without API metadata', () => {
    const repository = new Repository('/repo', -1, null, false)

    it.each([
      'https://github.com/shiftkey/desktop.git',
      'https://github.com/shiftkey/desktop.git/',
      'git@github.com:shiftkey/desktop.git',
      'ssh://git@github.com/shiftkey/desktop.git',
      'https://GITHUB.COM/shiftkey/desktop',
      'https://user:password@github.com/shiftkey/desktop.git',
    ])('opens the repository for %s', url => {
      expect(getGitHubHtmlUrl(repository, { name: 'upstream', url })).toBe(
        'https://github.com/shiftkey/desktop'
      )
    })

    it.each([
      'https://gitlab.com/shiftkey/desktop.git',
      'https://github.com.example.org/shiftkey/desktop.git',
      '/local/repository',
      'invalid',
    ])('does not treat %s as GitHub', url => {
      expect(getGitHubHtmlUrl(repository, { name: 'origin', url })).toBeNull()
    })

    it('returns null without a remote', () => {
      expect(getGitHubHtmlUrl(repository)).toBeNull()
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

      expect(
        getGitHubHtmlUrl(repositoryWithIncompleteMetadata, {
          name: 'origin',
          url: 'git@github.com:shiftkey/desktop.git',
        })
      ).toBe('https://github.com/shiftkey/desktop')
    })
  })

  describe('name', () => {
    it('uses the last path component as the name', async () => {
      const repoPath = '/some/cool/path'
      const repository = new Repository(repoPath, -1, null, false)
      expect(repository.name).toBe('path')
    })

    it('handles repository at root of the drive', async () => {
      const repoPath = 'T:\\'
      const repository = new Repository(repoPath, -1, null, false)
      expect(repository.name).toBe('T:\\')
    })
  })
})
