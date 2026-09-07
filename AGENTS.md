# Local UI development

The user reviews changes through the existing GitHub Desktop Dock icon.
After completing requested application changes, run `yarn build:local` to
build, deploy the Dock runtime, and restart the app for review. Confirm that
the build succeeds and the new runtime starts. Do not deploy after a failed
build. This command replaces this checkout's local runtime and restarts its
app; the user has requested this workflow.

See `docs/repository-activity.md` for launcher setup and runtime log paths.

On this Ubuntu machine, `/etc/apparmor.d/github-desktop-local` permits user
namespaces only for this checkout's `.local-desktop/release-*/github-desktop`.
Keep this path convention when deploying. Do not disable Electron's sandbox
or the system-wide user-namespace restriction. Validate launcher changes from
the desktop session, including an actual window and the app's AppArmor profile;
launching only from the agent environment previously masked a Dock failure.
