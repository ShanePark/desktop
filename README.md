# [GitHub Desktop](https://desktop.github.com/) — ShanePark Linux fork

[![Upstream CI](https://github.com/shiftkey/desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/shiftkey/desktop/actions/workflows/ci.yml)

This repository is [ShanePark's working fork](https://github.com/ShanePark/desktop)
of [GitHub Desktop](https://desktop.github.com/), based on the Linux work in
[shiftkey/desktop](https://github.com/shiftkey/desktop). GitHub Desktop is an
open-source [Electron](https://www.electronjs.org/)-based GitHub app written in
[TypeScript](https://www.typescriptlang.org) and [React](https://reactjs.org/).

The [original GitHub Desktop project](https://github.com/desktop/desktop) and
the [shiftkey Linux fork](https://github.com/shiftkey/desktop) remain the
upstream references for the product, its history, and their contributor
communities. This fork is the working source for ShanePark's Linux improvements.

## Current fork work

The current work focuses on the Linux repository workflow:

- The repository picker can organize repositories into Working, custom groups,
  and Ungrouped, with activity sorting, filtering, persistence, and manual
  ordering.
- `View on GitHub` (`Ctrl+Shift+G`) can use a configured `github.com` remote as
  a fallback when GitHub API repository metadata is unavailable. HTTPS and SSH
  remotes are supported.

The behavior, storage details, local build workflow, and verification checks are
documented in [repository activity](docs/repository-activity.md).

## Development

The `linux` branch is this fork's main development branch. It combines the
3.4.12 Linux release base with the repository workflow improvements described
above.

Clone this fork and install its dependencies:

```sh
git clone git@github.com:ShanePark/desktop.git
cd desktop
git switch linux
yarn install
```

To build the Linux app, deploy this checkout's local Dock runtime, and restart
the app for review after a successful build, run:

```sh
yarn build:local
```

The [local development guide](docs/local-development.md) explains the fork's
Git workflow and Dock review setup. The [repository activity verification
notes](docs/repository-activity.md#verification) cover launcher details,
runtime logs, and feature-specific checks.

## Linux packages

Use the source build workflow above for this fork's changes.
For packaged upstream Linux builds and current
installation instructions, see the [shiftkey/desktop README](https://github.com/shiftkey/desktop)
and its [releases](https://github.com/shiftkey/desktop/releases). The AppImage,
Debian/RPM feeds, and other packages described there belong to those upstream
projects and are not releases of `ShanePark/desktop`.

## More information

For product-oriented information, setup, authentication, and configuration,
see the [upstream GitHub Desktop README](https://github.com/desktop/desktop#readme),
[desktop.github.com](https://desktop.github.com/), and the
[GitHub Desktop documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop).

For Linux limitations and workarounds, see the
[known issues](docs/known-issues.md#linux) document.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).
