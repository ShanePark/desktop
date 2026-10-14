# [GitHub Desktop](https://desktop.github.com/) — ShanePark Linux fork

This repository is [ShanePark's personal fork](https://github.com/ShanePark/desktop)
of [GitHub Desktop](https://desktop.github.com/), built and run locally on
Linux. GitHub Desktop is an open-source
[Electron](https://www.electronjs.org/)-based GitHub app written in
[TypeScript](https://www.typescriptlang.org) and [React](https://reactjs.org/).

The [original GitHub Desktop project](https://github.com/desktop/desktop)
remains the upstream reference for the product, its history, and its
contributor community. This fork is the working source for ShanePark's Linux
improvements.

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

The `linux` branch is this fork's main development branch. It is based on
upstream GitHub Desktop 3.6.5 with the repository workflow improvements
described above.

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

This fork does not publish release packages. Build and run it from source with
the workflow above.

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
