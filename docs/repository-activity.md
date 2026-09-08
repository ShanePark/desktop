# Repository activity in the Linux fork

This feature is integrated into `ShanePark/desktop`'s `linux` branch, which
tracks upstream Desktop 3.6.5 and publishes the Linux package as
`3.6.5-linux1` with Electron 42.0.1. Development uses the pinned Node.js
24.15.0 runtime.
See [local development](local-development.md) for the fork's Git and Dock workflow.

## Using the repository picker

Open **Current Repository**. The list always shows these sections in order:

- **Working**: repositories with uncommitted changes or local commits not
  pushed from the current branch, regardless of their assigned group.
- **Your groups**: create groups using **Add → New group…**. A `shane` group is provided initially.
- **Ungrouped**: repositories that have not been assigned to a group.

Drag a repository onto a group heading (including an empty group), or use its
right-click **Move to group** menu. Dragging into Ungrouped removes an assignment.
Working is automatic and cannot be a manual drop target. A repository appears
once; its saved assignment is retained while it is Working, and restored once
its changes are committed and pushed. Use the group heading's **…** menu to
rename or delete a group. Deleting a group leaves all repositories registered
and moves its assignments to Ungrouped. Group names and assignments persist
across app restarts. Working rows show their saved group in a compact tag on
the left (or Ungrouped).

Creating or renaming a group opens a separate modal dialog with immediate
validation for empty, reserved, overly long, or duplicate names. Duplicate
matching ignores surrounding whitespace, case, and Unicode compatibility
variants. Cancel and Escape leave the group unchanged.

Drag a custom group heading to reorder groups; the
insertion line shows whether it will land above or below the target heading.
The **…** menu also has **Move group up/down**, and the focused heading accepts
Alt+Up/Down arrow keys. Group order is saved; Working and Ungrouped stay fixed at
the top and bottom.

The view options control sorting **within Working only**:

- **Recent changes** (default): newest estimated local edit or HEAD commit
  first, including clean repositories with unpublished commits. A commit no
  longer sends a recently edited repository back into alphabetical order.
- **Uncommitted first**: dirty working copies first, then alphabetically.
- **Name**: alphabetical order within Working.
- **Uncommitted only**: show staged, unstaged, untracked, and conflicted changes.
  Unpushed commits alone do not satisfy this explicit filter.

Name search composes with the filter. In activity modes it preserves activity
order instead of fuzzy relevance order. Empty headings stay available for
assignment when not filtering. Keyboard selection follows the repository ID
as activity updates or assignments move a row. Hover a row to see changed-file
and unpushed-commit counts and its activity time.

Unpushed counts compare the current HEAD with its configured upstream. Other
local branches do not affect Working. Without an upstream (including detached
HEAD), only current HEAD commits absent from known remote branches are counted.
This uses local remote-tracking refs, so pushes from another computer appear
after the usual fetch. A repository with no remote counts HEAD commits as
unpublished; an unborn branch has zero commits.

## Scanning and storage

Every registered repository path is scanned, not just the selected repository
or filtered rows. Separately registered linked worktrees are checked by their
own path. Scans run when the picker mounts, on window focus, when the registered
paths change, and every 15 seconds while the picker is mounted and
the document is visible and focused. This is polling, not continuous monitoring
while the picker is closed. An already started pass may finish after focus is
lost. Closing the picker cancels queued work and suppresses late UI callbacks;
at most two already running Git commands finish within their timeout.

The scanner uses bundled Git with porcelain v1 NUL-separated output, optional
index locking disabled, and fsmonitor hooks disabled for this read. It launches
at most two status commands at a time, each with a 15-second timeout and a
16-MiB output limit. File-stat concurrency is also bounded. There is no fetch,
staging, commit, reset, file-content hashing, or recursive filesystem watcher.
Only file paths reported as changed by Git are inspected, so ignored build output
does not promote a repository.

Settings and a bounded metadata cache are stored in this installation's
localStorage (`desktop.repository-activity.*.v1`). The cache contains local
paths, counts, timestamps and metadata fingerprints, not file contents or
credentials. Restored entries are unverified until checked again. Missing or
unreadable repositories are not treated as clean: they remain visible in the
Uncommitted-only filter, with an unavailable status. A failed pass does not
overwrite the previous known change count with zero.

Activity is keyed by the repository's current worktree path, so a linked
worktree is scanned and ordered using its own path. Group assignments and manual
`repositoryOrder` use `mainWorktreePath` as the canonical organization path
when it is available. Switching worktrees therefore preserves the repository's
group and manual position while keeping activity data separate for each
worktree.

## Meaning of recent

Git status does not provide change timestamps. Initial ordering estimates the
latest change from the modification times of currently changed files. Later
scans compare path/status and mtime/ctime/size/mode/inode fingerprints, so editing
the same already-dirty file is detected even if the changed-file count is equal.
Unchanged rescans never move a working copy to the top just because it was read.

When possible, a newer file mtime is used even after the picker was closed.
Otherwise an observed fingerprint change uses its observation time. Thus
staging, deletion, permission changes, timestamp-preserving edits, checkout,
restore, or external tools can affect this **estimate**. It is not a precise
history of human edits or the last time a repo was opened. The ordering also
uses the current HEAD committer timestamp and retains previously observed local
activity when a working copy becomes clean.
An initially discovered deletion has no recoverable timestamp and sorts after
dirty entries with known times. Directory/index mtimes are not used as a false
proxy. Dirty submodules count as changes, but repeated edits inside an already
dirty submodule cannot be timed from its parent entry; register the submodule
itself to monitor its files independently.

## Verification

### Local development with the Dock icon

Run `yarn build:local` after a set of UI changes is ready to review. This builds
the production app, replaces the local Dock runtime only after a successful
build, and restarts the app automatically. A failed build leaves the Dock app
running with the previous version. This is an explicit build command, not a
watcher that rebuilds on every file save.

For initial setup, run `python3 script/local-desktop.py install` after a
successful production build. It updates the existing
`github-desktop-local.desktop` launcher, preserving its Dock pin, and starts
the app. The Dock uses `.local-desktop/current`, separate from `dist`, so
rebuilding does not remove the running app's files. To deploy an already built
app again, run `python3 script/local-desktop.py deploy`.

Every deploy refreshes the same launcher before restarting the app. Its stable
`github-desktop-local.desktop` filename keeps the existing Dock pin, while
`StartupWMClass` is read from `app/package.json` so it matches Electron's
Linux window class.

Runtime files and launch output (`.local-desktop/launch.log`) are ignored by
Git. Deployment retains the preceding runtime and asks only this checkout's
GitHub Desktop process to exit before starting the new version.

On this Ubuntu workstation, `/etc/apparmor.d/github-desktop-local` grants
`userns` to
`/home/shane/Documents/git/shane/desktop/.local-desktop/release-*/github-desktop`.
This administrator-approved AppArmor exception lets Chromium use its namespace
sandbox when started from the Dock. It persists across reboots and covers new
local releases without another administrator prompt. Moving this checkout
requires updating the exception. The system-wide namespace restriction remains
enabled; the launcher does not add `--no-sandbox`.

A `FATAL:setuid_sandbox_host` error in the user journal indicates the exception
is missing or does not match the executable path. An agent-launched process
alone is not a valid Dock check because it can inherit a different AppArmor
profile. Confirm a visible window and `github-desktop-local (unconfined)` in
the main process's `/proc/PID/attr/current` when checking this workstation.

With this repository's dependencies installed, run:

```sh
node script/test-repository-activity.cjs
node script/test-repository-activity-ui.cjs
node script/test-repository-groups.cjs
node script/test.mjs app/test/unit/repository-activity-test.ts
python3 script/test-local-desktop.py
yarn compile:dev
```

The direct runners currently cover 45 repository activity checks, 24 UI wiring
checks, and 10 repository group checks. The UI runner uses stubbed React, DOM,
and Git services; it is not a real Electron GUI test. The activity unit test
invokes all three runners through the repository's Node.js test runner.

Before merging, validate the full Electron build and actual UI on Linux:
check multiple projects edited in an external editor, name filtering while
sorted, selection/keyboard navigation, unavailable repositories, and scrolling
with a large repository list.

Group headings show a chevron and repository count, with indented repository rows.
Click a heading to collapse or expand it. Visibility, custom group order and
repository assignments are saved together and restored on restart. Searching
temporarily reveals matching repositories in collapsed groups; clearing search
restores the saved visibility. Heading toggles are inactive during search.

Drag a custom group heading to reorder groups (or use Alt+Up/Down while its
heading is focused, or its menu). There is no separate drag handle. Drag a
repository above or below another to save its position and, across groups,
its membership. Working alone uses the Sort by setting; custom groups and
Ungrouped retain manual order, including after searching or returning from
Working. New repositories follow saved entries in name order.

Dragging resolves the nearest insertion slot across the whole list, including
row gaps and group bodies. Rows shift apart around a visible drop placeholder.
Dropping commits that previewed slot; leaving the list or cancelling clears it.
