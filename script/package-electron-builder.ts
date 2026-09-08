/* eslint-disable no-sync */

import * as path from 'path'
import { promisify } from 'util'

const { Arch, build, Platform } =
  require('electron-builder') as typeof import('app-builder-lib')

import glob = require('glob')
const globPromise = promisify(glob)

import { getDistArchitecture, getDistPath, getDistRoot } from './dist-info'

function getArchitecture(): import('app-builder-lib').Arch {
  switch (getDistArchitecture()) {
    case 'arm64':
      return Arch.arm64
    default:
      return Arch.x64
  }
}

export async function packageElectronBuilder(): Promise<Array<string>> {
  const distPath = getDistPath()
  const distRoot = getDistRoot()

  const configPath = path.resolve(__dirname, 'electron-builder-linux.yml')

  await build({
    publish: 'never',
    prepackaged: distPath,
    config: configPath,
    targets: Platform.LINUX.createTarget(undefined, getArchitecture()),
  })

  const appImageInstaller = `${distRoot}/GitHubDesktop-linux-*.AppImage`

  const files = await globPromise(appImageInstaller)
  if (files.length !== 1) {
    return Promise.reject(
      `Expected one AppImage installer but instead found '${files.join(
        ', '
      )}' - exiting...`
    )
  }

  const appImageInstallerPath = files[0]

  return Promise.resolve([appImageInstallerPath])
}
