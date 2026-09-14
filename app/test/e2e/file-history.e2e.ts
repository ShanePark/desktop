/* eslint-disable no-sync */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { ElectronApplication } from 'playwright'
import type { Page } from '@playwright/test'

import { dismissMoveToApplicationsDialog, expect, test } from './e2e-fixtures'
import { smokeRepoFileContents, smokeRepoPath } from './test-helpers'

const HistoryFileName = 'file-history-fixture.txt'
const CleanHistoryFileName = 'clean-history-fixture.txt'
const HistoryFirstCommit = 'Add file history fixture'
const HistorySecondCommit = 'Update file history fixture'
const HistoryDirtyCommit = 'Commit dirty file history fixture'

const HistoryFirstLine = 'First historical line.'
const HistorySecondLine = 'Second historical line.'
const HistoryCommittedLine = 'Committed history line.'
const CleanHistoryLine = 'Clean history line.'
const DirtyLine = 'Dirty working-tree line.'

interface IMainProcessE2EState {
  fileHistoryContextMenuLabels?: ReadonlyArray<string>
}

function runGit(args: ReadonlyArray<string>) {
  execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    stdio: 'ignore',
  })
}

function createFileHistoryRepository() {
  fs.rmSync(smokeRepoPath, { recursive: true, force: true })
  fs.mkdirSync(smokeRepoPath, { recursive: true })

  runGit(['init'])
  runGit(['config', 'user.name', 'GitHub Desktop E2E'])
  runGit(['config', 'user.email', 'desktop-e2e@example.com'])

  fs.writeFileSync(
    path.join(smokeRepoPath, 'README.md'),
    '# Preloaded GitHub Desktop E2E repository\n'
  )
  runGit(['add', 'README.md'])
  runGit(['commit', '-m', 'Preloaded repository'])

  const filePath = path.join(smokeRepoPath, HistoryFileName)

  fs.writeFileSync(filePath, `${smokeRepoFileContents}\n${HistoryFirstLine}\n`)
  runGit(['add', '--', HistoryFileName])
  runGit(['commit', '-m', HistoryFirstCommit])

  fs.appendFileSync(filePath, `${HistorySecondLine}\n`)
  runGit(['add', '--', HistoryFileName])
  runGit(['commit', '-m', HistorySecondCommit])

  fs.appendFileSync(filePath, `${HistoryCommittedLine}\n`)
  fs.writeFileSync(
    path.join(smokeRepoPath, CleanHistoryFileName),
    `${CleanHistoryLine}\n`
  )
  runGit(['add', '--', HistoryFileName, CleanHistoryFileName])
  runGit(['commit', '-m', HistoryDirtyCommit])

  fs.appendFileSync(filePath, `${DirtyLine}\n`)
}

const fileHistoryTest = test.extend<{}, { prepareRepository: () => void }>({
  prepareRepository: [
    async ({}, use) => {
      await use(createFileHistoryRepository)
    },
    { scope: 'worker' },
  ],
})

async function completeWelcomeAndOpenRepository(page: Page) {
  await page.waitForFunction(
    () =>
      (document.getElementById('desktop-app-container')?.innerHTML.length ??
        0) > 100,
    null,
    { timeout: 30000 }
  )

  const skipButton = page.locator('a.skip-button')
  await skipButton.waitFor({ state: 'visible', timeout: 30000 })
  await skipButton.click()

  const nameInput = page.locator('input[placeholder="Your Name"]')
  await nameInput.waitFor({ state: 'visible', timeout: 15000 })
  if ((await nameInput.inputValue()) === '') {
    await nameInput.fill('GitHub Desktop E2E')
  }

  const emailInput = page.locator('input[placeholder="your-email@example.com"]')
  if ((await emailInput.inputValue()) === '') {
    await emailInput.fill('desktop-e2e@example.com')
  }

  await page.locator('button:has-text("Finish")').click()
  await page.waitForSelector('#welcome', { state: 'hidden', timeout: 15000 })
  await dismissMoveToApplicationsDialog(page)

  const repoFile = page
    .locator(`//*[contains(normalize-space(), "${HistoryFileName}")]`)
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

  if (!(await repoFile.isVisible().catch(() => false))) {
    if (!(await addRepositoryDialog.isVisible().catch(() => false))) {
      await addButton.click()
    }

    await addRepositoryDialog.waitFor({ state: 'visible', timeout: 15000 })
    const pathInput = addRepositoryDialog.locator(
      'input[placeholder="repository path"]'
    )
    await pathInput.waitFor({ state: 'visible', timeout: 15000 })
    await pathInput.fill(smokeRepoPath)
    await addRepositoryDialog
      .locator(
        'button:has-text("Add Repository"), button:has-text("Add repository")'
      )
      .click()
  }

  await repoFile.waitFor({ state: 'visible', timeout: 15000 })
  await repoFile.click()
  await page.locator('.diff-container').waitFor({
    state: 'visible',
    timeout: 15000,
  })
}

async function refreshRepository(page: Page) {
  await page.locator('#history-tab').click()
  await expect(page.locator('#compare-view')).toBeVisible({ timeout: 15000 })

  await page.locator('#changes-tab').click()
  await expect(page.locator('#changes-list')).toBeVisible({ timeout: 15000 })
}

function commitRow(page: Page, summary: string) {
  return page
    .locator('#commit-list .list-item')
    .filter({ hasText: summary })
    .first()
}

async function interceptFileHistoryContextMenu(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('show-contextual-menu')
    ipcMain.handle('show-contextual-menu', (_event, items) => {
      const labels = (items as ReadonlyArray<{ label?: string }>).map(
        item => item.label ?? ''
      )
      const state = globalThis as typeof globalThis & IMainProcessE2EState
      state.fileHistoryContextMenuLabels = labels

      const index = labels.findIndex(label => /file history/i.test(label))
      return index >= 0 ? [index] : null
    })
  })
}

async function getContextMenuLabels(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = globalThis as typeof globalThis & IMainProcessE2EState
    return state.fileHistoryContextMenuLabels ?? []
  })
}

fileHistoryTest.describe.configure({ mode: 'serial' })

fileHistoryTest(
  'shows per-file history from Changes and History',
  async ({ app, mainWindow: page }) => {
    await completeWelcomeAndOpenRepository(page)

    await refreshRepository(page)

    const changedFileRow = page
      .locator('#changes-list .list-item')
      .filter({ hasText: HistoryFileName })
      .first()
    await expect(changedFileRow).toBeVisible({ timeout: 15000 })
    await changedFileRow.click()

    const workingTreeDiff = page.locator('.diff-container').first()
    await expect(workingTreeDiff).toContainText(DirtyLine, { timeout: 15000 })

    const diffHeader = page.locator('.diff-container > .header').first()
    const closedHeaderBox = await diffHeader.boundingBox()
    if (closedHeaderBox === null) {
      throw new Error('Diff header is not measurable before opening history')
    }

    const changesHistoryToggle = page
      .locator('.diff-container .file-history-toggle')
      .first()
    await expect(changesHistoryToggle).toBeVisible()
    await expect(changesHistoryToggle).toHaveAttribute('aria-expanded', 'false')
    await changesHistoryToggle.click()

    const fileHistoryPanel = page.locator('.file-history-panel')
    await expect(fileHistoryPanel).toBeVisible({ timeout: 15000 })
    await expect(changesHistoryToggle).toHaveAttribute('aria-expanded', 'true')

    const openHeaderBox = await diffHeader.boundingBox()
    if (openHeaderBox === null) {
      throw new Error('Diff header is not measurable after opening history')
    }
    expect(openHeaderBox.y).toBe(closedHeaderBox.y)

    const historicalCommitRow = fileHistoryPanel
      .locator('#commit-list .list-item')
      .filter({ hasText: HistorySecondCommit })
      .first()
    await expect(historicalCommitRow).toBeVisible({ timeout: 15000 })
    await historicalCommitRow.click()
    await expect(historicalCommitRow).toHaveAttribute('aria-selected', 'true')

    const historicalDiff = fileHistoryPanel.locator(
      '.file-history-diff .diff-container'
    )
    await expect(historicalDiff).toContainText(HistorySecondLine, {
      timeout: 15000,
    })
    await expect(historicalDiff).not.toContainText(DirtyLine)
    await expect(historicalDiff.locator('input[type="checkbox"]')).toHaveCount(
      0
    )

    const changesDirtyRow = fileHistoryPanel.locator('.file-history-dirty-row')
    await expect(changesDirtyRow).toBeVisible()
    await expect(changesDirtyRow).toHaveClass(/list-item/)
    await expect(changesDirtyRow.locator('.summary')).toHaveText('Dirty')
    await expect(changesDirtyRow.locator('.byline')).toHaveText(
      'Working directory'
    )
    const changesDirtyRowBox = await changesDirtyRow.boundingBox()
    if (changesDirtyRowBox === null) {
      throw new Error('Dirty working directory row is not measurable')
    }
    expect(changesDirtyRowBox.height).toBe(50)
    await expect(
      fileHistoryPanel.locator('#commit-list .list-item')
    ).not.toHaveCount(0)
    await changesDirtyRow.click()
    await expect(historicalDiff).toContainText(DirtyLine, { timeout: 15000 })
    await page.screenshot({ path: '/tmp/file-history-dirty-e2e.png' })

    const resizeHandle = fileHistoryPanel.locator(
      '.vertical-resize-handle.handle-top'
    )
    const initialHeight = Number(
      await resizeHandle.getAttribute('aria-valuenow')
    )
    const minimumHeight = Number(
      await resizeHandle.getAttribute('aria-valuemin')
    )
    const maximumHeight = Number(
      await resizeHandle.getAttribute('aria-valuemax')
    )
    const resizeDelta = initialHeight + 30 <= maximumHeight ? 30 : -30
    const expectedHeight = Math.max(
      minimumHeight,
      Math.min(maximumHeight, initialHeight + resizeDelta)
    )
    const resizeBox = await resizeHandle.boundingBox()

    if (resizeBox === null) {
      throw new Error('File history resize handle is not measurable')
    }

    await page.mouse.move(
      resizeBox.x + resizeBox.width / 2,
      resizeBox.y + resizeBox.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      resizeBox.x + resizeBox.width / 2,
      resizeBox.y + resizeBox.height / 2 - resizeDelta
    )
    await page.mouse.up()
    await expect(resizeHandle).toHaveAttribute(
      'aria-valuenow',
      String(expectedHeight)
    )

    await page.locator('#history-tab').click()
    await expect(page.locator('#compare-view')).toBeVisible({ timeout: 15000 })

    const latestCommitRow = commitRow(page, HistoryDirtyCommit)
    await expect(latestCommitRow).toBeVisible({ timeout: 15000 })
    await latestCommitRow.click()

    const dirtyHistoryFileRow = page
      .locator('#history .commit-details .file-list .list-item')
      .filter({ hasText: HistoryFileName })
      .first()
    await expect(dirtyHistoryFileRow).toBeVisible({ timeout: 15000 })
    await dirtyHistoryFileRow.click()

    const historyDirtyToggle = page
      .locator('.diff-container .file-history-toggle')
      .first()
    await historyDirtyToggle.click()
    const historyDirtyPanel = page.locator('.file-history-panel')
    await expect(historyDirtyPanel).toBeVisible({ timeout: 15000 })
    const historyDirtyRow = historyDirtyPanel.locator('.file-history-dirty-row')
    await expect(historyDirtyRow).toBeVisible()
    await expect(historyDirtyRow).toHaveClass(/list-item/)
    await expect(historyDirtyRow.locator('.summary')).toHaveText('Dirty')
    await expect(historyDirtyRow.locator('.byline')).toHaveText(
      'Working directory'
    )
    await historyDirtyRow.click()
    await expect(page.locator('#changes-list')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.diff-container').first()).toContainText(
      DirtyLine,
      { timeout: 15000 }
    )

    await page.locator('#history-tab').click()
    await expect(page.locator('#compare-view')).toBeVisible({ timeout: 15000 })
    await commitRow(page, HistoryDirtyCommit).click()

    const cleanFileRow = page
      .locator('#history .commit-details .file-list .list-item')
      .filter({ hasText: CleanHistoryFileName })
      .first()
    await expect(cleanFileRow).toBeVisible({ timeout: 15000 })
    await cleanFileRow.click()

    await interceptFileHistoryContextMenu(app)
    await cleanFileRow.click({ button: 'right' })

    await expect
      .poll(async () => {
        const labels = await getContextMenuLabels(app)
        return labels.some(label => /file history/i.test(label))
      })
      .toBe(true)

    await expect(page.locator('.file-history-panel')).toBeVisible({
      timeout: 15000,
    })

    const cleanFileHistoryPanel = page.locator('.file-history-panel')
    await expect(
      cleanFileHistoryPanel.locator('.file-history-dirty-row')
    ).toHaveCount(0)
    await expect(
      cleanFileHistoryPanel.locator('.file-history-list-path')
    ).toHaveCount(0)
    await expect(
      cleanFileHistoryPanel.locator('#commit-list .list-item')
    ).toHaveCount(1)
    await expect(
      cleanFileHistoryPanel.locator('#commit-list .list-item').first()
    ).toContainText(HistoryDirtyCommit)
    await expect(cleanFileHistoryPanel).toContainText(CleanHistoryFileName)

    await page.screenshot({ path: '/tmp/file-history-e2e.png' })
  }
)
