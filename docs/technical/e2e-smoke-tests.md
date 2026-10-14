# E2E Smoke Tests

This document explains the end-to-end smoke test harness added for GitHub
Desktop, what it covers, how it runs locally, and which repository files make
up the implementation.

## Overview

The smoke suite uses Playwright's Electron support to launch the real Desktop
application and drive a small set of critical user paths. The focus is not broad
UI coverage. The suite is intended to protect the app's highest-risk integration
boundaries:

- app startup and first-run flow
- opening an existing repository
- committing and switching branches
- opening the About dialog

The suite is deliberately small and runs serially in one Electron session. That
keeps it practical for iterative development.

## What The Suite Covers

The current smoke spec lives in `app/test/e2e/app-launch.e2e.ts` and covers:

- launching Desktop and completing the welcome flow
- opening the smoke repository from disk
- verifying the changed file appears in the diff
- creating a commit
- creating a branch and switching back
- opening the About dialog, verifying it shows a `Version x.y.z` line, and
  closing it

These tests intentionally mix UI assertions with repository-level verification by
checking Git state directly in the smoke repository.

## File Layout

The main files added or changed for the E2E harness are:

- `app/test/e2e/app-launch.e2e.ts`
  - the smoke suite itself
- `app/test/e2e/e2e-fixtures.ts`
  - Playwright/Electron fixtures, launch mode selection, tracing, video output,
    and Windows process cleanup
- `app/test/e2e/test-helpers.ts`
  - helpers for creating and validating the smoke test repository
- `app/test/e2e/playwright.config.ts`
  - Playwright configuration for the smoke suite

## How The App Is Launched

The fixture supports three effective launch modes.

### Installed app

If `DESKTOP_E2E_APP_PATH` is set, the fixture launches the executable at that
path, such as an app that has been packaged and installed.

### Packaged app

If `DESKTOP_E2E_APP_PATH` is not set and `DESKTOP_E2E_APP_MODE` is not set to
`unpackaged`, the fixture resolves the packaged app path from `dist` and launches
that executable directly.

This is the default E2E mode because it exercises production-like packaged
artifacts.

### Unpackaged app

If `DESKTOP_E2E_APP_MODE=unpackaged`, the fixture launches `out/main.js`
instead of a packaged executable.

This mode exists for local iteration. It avoids the need to fully package and
sign the app just to run the smoke suite while still using a production webpack
bundle and staged resources.

## Local Commands

The branch adds two ways to run the suite locally.

### Packaged mode

```bash
yarn test:e2e:packaged
```

This builds a packaged production app and then runs the E2E suite.

### Unpackaged mode

```bash
yarn test:e2e:unpackaged
```

This builds a production-configured staged app in `out/` and runs the same E2E
suite against `out/main.js`.

The unpackaged build path uses `DESKTOP_SKIP_PACKAGE=1` so `script/build.ts`
stages the app without invoking the final packaging step.

### Default alias

```bash
yarn test:e2e
```

This remains the packaged path and is equivalent to `yarn test:e2e:packaged`.

## Smoke Repository Setup

The suite uses a throwaway local Git repository created in the system temp
directory.

`app/test/e2e/test-helpers.ts` is responsible for:

- creating the repository
- initializing Git
- configuring a local author name and email
- creating an initial commit
- adding an uncommitted smoke file used by the tests

The tests then verify Desktop's behavior both through the UI and by checking the
repository state directly with Git commands.

## CI

This fork's CI workflows do not run the E2E suite. Run it locally with the
commands above.

## Windows-Specific Notes

The E2E fixtures kill lingering `Update.exe` and `GitHubDesktop.exe` process
trees during teardown on Windows to avoid hangs.

## Videos, Traces, and Diagnostics

The suite writes output to `playwright-videos`.

Artifacts include:

- Playwright videos recorded through the Electron fixture
- trace zip files saved from the Playwright context

The fixture also forwards renderer console errors and page errors to the job log
to make failures easier to diagnose when the app dies before Playwright can make
useful assertions.

## Limitations And Tradeoffs

- The suite is intentionally narrow. It protects critical integration paths, not
  the entire UI surface.
- Local unpackaged mode is meant for fast iteration, not as a perfect substitute
  for packaged/install-time validation.

## When To Use Which Mode

- Use `yarn test:e2e:unpackaged` when iterating locally on the smoke suite or
  nearby app behavior.
- Use `yarn test:e2e:packaged` when you need parity with the packaged runtime.
