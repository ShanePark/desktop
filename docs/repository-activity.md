# Repository activity in the Linux fork

This feature targets `ShanePark/desktop`'s `linux` branch. It does not replace
this fork with Desktop Plus or upgrade the application's dependencies.

## Using the repository picker

Open **Current Repository**. The controls above the name search provide:

- **Uncommitted only**: show staged, unstaged, untracked, and conflicted changes.
  Commits waiting to be pushed do not, by themselves, satisfy this filter.
- **Recent local changes** (default): put dirty working copies first, newest
  estimated local change first, then clean working copies alphabetically.
- **Uncommitted first**: dirty working copies first, alphabetically within each
  category.
- **Name / original groups**: restore the original owner/Enterprise/Other and
  Recent groups and original text-search relevance ordering.
- **Refresh**: recheck all registered working copies without a network fetch.

Name search composes with the status filter. In activity sort modes, search
keeps activity order instead of replacing it with fuzzy relevance order.
Activity modes flatten owner groups and remove duplicate Recent rows; they do
not change the saved repository list. Hover a row for its estimated change
time or an explanation that its status/time is unavailable. Keyboard selection
is tracked by row ID across refreshes, rather than by its changing position.

## Scanning and storage

Every registered repository path is scanned, not just the selected repository
or filtered rows. Separately registered linked worktrees are checked by their
own path. Scans run when the picker mounts, on window focus, when the registered
paths change, manually, and every 15 seconds while the picker is mounted and
the document is visible and focused. This is polling, not continuous monitoring
while the picker is closed. An already started pass may finish after focus is
lost. Closing the picker cancels queued work and suppresses late UI callbacks;
at most two already running Git commands finish within their timeout.

The scanner uses bundled Git with porcelain v1 NUL-separated output, optional
index locking disabled, and fsmonitor hooks disabled for this read. It launches
at most two status commands at a time, each with a 15-second timeout and a
16-MiB output limit. File-stat concurrency is also bounded. There is no fetch,
staging, commit, reset, file-content hashing, or recursive filesystem watcher.
Only paths reported as changed by Git are inspected, so ignored build output
does not promote a repository.

Settings and a bounded metadata cache are stored in this installation's
localStorage (`desktop.repository-activity.*.v1`). The cache contains local
paths, counts, timestamps and metadata fingerprints, not file contents or
credentials. Restored entries are unverified until checked again. Missing or
unreadable repositories are not treated as clean: they remain visible in the
Uncommitted-only filter, with an unavailable status. A failed pass does not
overwrite the previous known change count with zero.

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
history of human edits, nor is it commit time or the last time a repo was opened.
An initially discovered deletion has no recoverable timestamp and sorts after
dirty entries with known times. Directory/index mtimes are not used as a false
proxy. Dirty submodules count as changes, but repeated edits inside an already
dirty submodule cannot be timed from its parent entry; register the submodule
itself to monitor its files independently.

## Verification

With this repository's dependencies installed, run:

```sh
node script/test-repository-activity.cjs
node script/test-repository-activity-ui.cjs
yarn test:unit --runInBand app/test/unit/repository-activity-test.ts
yarn compile:dev
```

The first runner has 45 checks, including real temporary Git repositories,
repeat edits, staged changes, deletions, renames, ignored output, symlinks,
worktrees, persistence, sorting, failures and concurrency. The second has 10
wiring checks that execute the modified TSX with stubbed React/DOM and Git
services; it is not a real Electron GUI test. The Jest adapter includes both
runners in the normal unit suite.

Before merging, validate the full Electron build and actual UI on Linux:
check multiple projects edited in an external editor, name filtering while
sorted, selection/keyboard navigation, unavailable repositories, and scrolling
with a large repository list. This change does not address inherited Electron
or other dependency maintenance in the older Linux fork.
