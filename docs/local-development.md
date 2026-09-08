# Local development

This checkout is used to improve [ShanePark/desktop](https://github.com/ShanePark/desktop),
a personal fork of the Linux GitHub Desktop project.

## Git workflow

Use `origin` (`git@github.com:ShanePark/desktop.git`) as the fetch and push remote.
Working branches should track the same branch name on `origin`, rather than a
release branch from `shiftkey/desktop`. The main development branch is `linux`,
with upstream Desktop 3.6.5, the `3.6.5-linux1` package version, Electron
42.0.1, and the repository workflow improvements integrated. Node.js 24.15.0
is pinned for development. Create focused feature branches from `linux` for
subsequent work; each feature branch should push to its own matching branch on
`origin`.

To publish a new working branch after committing the intended changes:

```sh
git push -u origin HEAD
```

Historical upstream repositories remain useful references, but an `upstream`
remote is not required for daily work on this fork. Add one only when an upstream
synchronization is explicitly requested. Removing a remote does not remove local
commits or local branches.

## Build and review through the Dock

The user reviews application changes through the existing GitHub Desktop Dock
icon. After completing application changes, run:

```sh
yarn build:local
```

This builds the production app, deploys this checkout's local Dock runtime, and
restarts the app for review. Confirm both a successful build and that the new
runtime starts. Never deploy after a failed build; the command leaves the
previous runtime running if compilation fails. Documentation-only changes do
not require rebuilding the application.

The repository pins Yarn in `.yarnrc`. If the system `yarn` command resolves to
an unrelated program or Corepack fails to bootstrap, invoke the bundled version:

```sh
node vendor/yarn-1.21.1.js build:local
```

For launcher setup, deployment details, runtime log paths, and feature-specific
checks, see [repository activity](repository-activity.md#verification).

## Ubuntu sandbox and launcher verification

On this workstation, `/etc/apparmor.d/github-desktop-local` permits user namespaces
for this checkout's `.local-desktop/release-*/github-desktop`. Preserve that path
convention when deploying. Do not disable Electron's sandbox or the system-wide
user-namespace restriction.

Validate launcher changes from the desktop session. Confirm an actual app window
and `github-desktop-local (unconfined)` in the main process's
`/proc/PID/attr/current`. Launching only from the agent environment previously
masked a Dock failure. Runtime launch output is in `.local-desktop/launch.log`.
