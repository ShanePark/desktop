/**
 * E2E tests for GitHub Desktop using Playwright + Electron.
 *
 * These tests launch the real production-built app, interact with it
 * via Playwright, and verify core functionality end-to-end. Video and
 * trace recording behavior is configured in the shared Electron fixtures
 * (see ./e2e-fixtures), not directly in playwright.config.ts.
 */

import { test, expect, dismissMoveToApplicationsDialog } from './e2e-fixtures'
import {
  smokeRepoFileContents,
  smokeRepoFileName,
  smokeRepoPath,
  getSmokeRepoCurrentBranch,
  getSmokeRepoHeadMessage,
  getSmokeRepoStatus,
} from './test-helpers'
import type { Page } from '@playwright/test'

// All tests run sequentially in the same Electron session.
test.describe.configure({ mode: 'serial' })

async function failIfAppErrorDialogIsVisible(page: Page) {
  const appErrorDialog = page.locator('dialog#app-error')
  const isVisible = await appErrorDialog.isVisible().catch(() => false)

  if (!isVisible) {
    return
  }

  const title =
    (await appErrorDialog.locator('.dialog-header h1').textContent()) ?? ''
  const description =
    (await page
      .locator('#app-error-description')
      .textContent()
      .catch(() => null)) ?? ''

  throw new Error(
    `App error dialog blocked the E2E flow. Title: ${title.trim()} Description: ${description.trim()}`
  )
}

// ── Smoke tests ─────────────────────────────────────────────────────

test.describe('GitHub Desktop - App Launch', () => {
  test('should launch, complete welcome flow, commit, and switch branches', async ({
    mainWindow: page,
  }) => {
    // Wait for the React app to mount
    await page.waitForFunction(
      () =>
        (document.getElementById('desktop-app-container')?.innerHTML.length ??
          0) > 100,
      null,
      { timeout: 30000 }
    )

    // ── Welcome flow ────────────────────────────────────────────────
    const skipButton = page.locator('a.skip-button')
    await skipButton.waitFor({ state: 'visible', timeout: 30000 })
    await skipButton.click()

    const nameInput = page.locator('input[placeholder="Your Name"]')
    await nameInput.waitFor({ state: 'visible', timeout: 15000 })
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('GitHub Desktop E2E')
    }

    const emailInput = page.locator(
      'input[placeholder="your-email@example.com"]'
    )
    if ((await emailInput.inputValue()) === '') {
      await emailInput.fill('desktop-e2e@example.com')
    }

    await page.locator('button:has-text("Finish")').click()
    await page.waitForSelector('#welcome', { state: 'hidden', timeout: 15000 })

    await dismissMoveToApplicationsDialog(page)

    // ── Repository view ─────────────────────────────────────────────
    const repoFile = page
      .locator(`//*[contains(normalize-space(), "${smokeRepoFileName}")]`)
      .first()
    const addButton = page
      .locator(
        '//*[contains(normalize-space(), "Add an Existing Repository from your Local Drive") or contains(normalize-space(), "Add an Existing Repository from your local drive")]'
      )
      .first()
    const addRepositoryDialog = page.locator('dialog#add-existing-repository')

    await Promise.race([
      repoFile.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
      addRepositoryDialog
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => {}),
      addButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    ])

    await failIfAppErrorDialogIsVisible(page)

    if (!(await repoFile.isVisible().catch(() => false))) {
      if (!(await addRepositoryDialog.isVisible().catch(() => false))) {
        await addButton.click()
      }

      await addRepositoryDialog.waitFor({ state: 'visible', timeout: 15000 })
      const pathInput = addRepositoryDialog.locator(
        'input[placeholder="repository path"]'
      )
      await pathInput.waitFor({ state: 'visible', timeout: 15000 })
      if ((await pathInput.inputValue()) !== smokeRepoPath) {
        await pathInput.fill(smokeRepoPath)
      }
      await addRepositoryDialog
        .locator(
          'button:has-text("Add Repository"), button:has-text("Add repository")'
        )
        .click()
    }

    await repoFile.waitFor({ state: 'visible', timeout: 15000 })
    await repoFile.click()

    // ── Diff ────────────────────────────────────────────────────────
    const diffContainer = page.locator('.diff-container')
    await diffContainer.waitFor({ state: 'visible', timeout: 15000 })
    await expect(diffContainer).toContainText(smokeRepoFileContents, {
      timeout: 15000,
    })

    // ── Commit ──────────────────────────────────────────────────────
    const commitButton = page.locator(
      '[aria-label="Create commit"] .commit-button'
    )
    await commitButton.waitFor({ state: 'visible', timeout: 15000 })
    await dismissMoveToApplicationsDialog(page)
    await commitButton.click()

    await expect
      .poll(() => getSmokeRepoHeadMessage(), { timeout: 15000 })
      .toBe(`Create ${smokeRepoFileName}`)
    await expect.poll(() => getSmokeRepoStatus(), { timeout: 15000 }).toBe('')

    // ── Create branch ───────────────────────────────────────────────
    const initialBranch = getSmokeRepoCurrentBranch()
    const smokeBranch = 'smoke-branch'

    await dismissMoveToApplicationsDialog(page)
    await page.locator('.branch-button button').click()

    const newBranchBtn = page.locator('.new-branch-button')
    await newBranchBtn.waitFor({ state: 'visible', timeout: 15000 })
    await newBranchBtn.click()

    const createBranchDialog = page.locator('#create-branch')
    await createBranchDialog.waitFor({ state: 'visible', timeout: 15000 })
    const branchNameInput = createBranchDialog.locator('input').first()
    await branchNameInput.evaluate((el, value) => {
      const input = el as HTMLInputElement
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, smokeBranch)

    await createBranchDialog
      .locator(
        'button:has-text("Create Branch"), button:has-text("Create branch")'
      )
      .click()

    await expect
      .poll(() => getSmokeRepoCurrentBranch(), { timeout: 15000 })
      .toBe(smokeBranch)

    // ── Switch back ─────────────────────────────────────────────────
    await dismissMoveToApplicationsDialog(page)
    await page.locator('.branch-button button').click()

    await page
      .locator(
        `//div[contains(@class, "branches-list-item")]//div[contains(@class, "name") and normalize-space()="${initialBranch}"]`
      )
      .click()

    await expect
      .poll(() => getSmokeRepoCurrentBranch(), { timeout: 15000 })
      .toBe(initialBranch)
    await expect.poll(() => getSmokeRepoStatus(), { timeout: 15000 }).toBe('')
  })
})

// ── About dialog ────────────────────────────────────────────────────

test.describe('About dialog', () => {
  test('shows the current version', async ({ mainWindow: page }) => {
    await page.evaluate(() => {
      require('electron').ipcRenderer.emit('menu-event', {}, 'show-about')
    })

    const aboutDialog = page.locator('#about')
    await aboutDialog.waitFor({ state: 'visible', timeout: 5000 })

    const versionText = await aboutDialog
      .locator('.selectable-text')
      .textContent()
    expect(versionText).toMatch(/Version \d+\.\d+\.\d+/)
  })

  test('closes the About dialog', async ({ mainWindow: page }) => {
    await page.locator('#about button[type="submit"]').click()
    await page.locator('#about').waitFor({ state: 'hidden', timeout: 5000 })
  })
})
