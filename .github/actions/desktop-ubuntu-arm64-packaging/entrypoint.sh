#!/bin/sh

set -eu

git config --global --add safe.directory /github/workspace

yarn

yarn run postinstall

# Yarn installs optional dependencies for the host architecture. Add the
# target package explicitly because this container cross-compiles ARM64 while
# running on an x64 GitHub runner.
copilot_package='@github/copilot-linux-arm64'
copilot_version=$(node -p "require('./app/node_modules/@github/copilot/package.json').optionalDependencies['${copilot_package}']")
if [ ! -d "app/node_modules/${copilot_package}" ]; then
  (cd app && yarn add --force --optional --ignore-platform --ignore-scripts "${copilot_package}@${copilot_version}")
fi

yarn build:prod
yarn run package
