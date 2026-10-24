import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'

interface UpdateFile {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

interface MacUpdateInfo {
  readonly version: string
  readonly files: readonly UpdateFile[]
  readonly path: string
  readonly sha512: string
  readonly releaseDate?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseUpdateFile(value: unknown, source: string): UpdateFile {
  if (!isRecord(value)
    || typeof value.url !== 'string'
    || typeof value.sha512 !== 'string'
    || typeof value.size !== 'number') {
    throw new TypeError(`${source} contains an invalid update file`)
  }
  if (!/^[0-9A-Za-z._-]+$/.test(value.url)) {
    throw new TypeError(`${source} contains a GitHub-incompatible asset name: ${value.url}`)
  }
  return { url: value.url, sha512: value.sha512, size: value.size }
}

function readUpdateInfo(path: string): MacUpdateInfo {
  const value: unknown = yaml.load(readFileSync(path, 'utf8'))
  if (!isRecord(value)
    || typeof value.version !== 'string'
    || !Array.isArray(value.files)
    || typeof value.path !== 'string'
    || typeof value.sha512 !== 'string'
    || (value.releaseDate !== undefined && typeof value.releaseDate !== 'string')) {
    throw new TypeError(`${path} is not valid macOS update metadata`)
  }
  return {
    version: value.version,
    files: value.files.map(file => parseUpdateFile(file, path)),
    path: value.path,
    sha512: value.sha512,
    ...(value.releaseDate === undefined ? {} : { releaseDate: value.releaseDate }),
  }
}

function zipForArch(info: MacUpdateInfo, arch: 'arm64' | 'x64', source: string): UpdateFile {
  const suffix = `-${arch}.zip`
  const matches = info.files.filter(file => file.url.endsWith(suffix))
  const [match] = matches
  if (match === undefined || matches.length !== 1) {
    throw new TypeError(`${source} must contain exactly one ${arch} ZIP update file`)
  }
  return match
}

/**
 * Combine native macOS update metadata into the one channel file consumed by electron-updater.
 * @param arm64Path - Metadata emitted by the native Apple Silicon build.
 * @param x64Path - Metadata emitted by the native Intel build.
 * @param outputPath - Destination for the combined channel metadata file.
 * @returns the combined update metadata written to outputPath.
 */
export function mergeMacUpdateInfo(arm64Path: string, x64Path: string, outputPath: string): MacUpdateInfo {
  const arm64 = readUpdateInfo(arm64Path)
  const x64 = readUpdateInfo(x64Path)
  if (arm64.version !== x64.version) {
    throw new TypeError(`macOS update versions differ: ${arm64.version} and ${x64.version}`)
  }
  zipForArch(arm64, 'arm64', arm64Path)
  const x64Zip = zipForArch(x64, 'x64', x64Path)
  const files = [...x64.files, ...arm64.files]
  if (new Set(files.map(file => file.url)).size !== files.length) {
    throw new TypeError('macOS update metadata contains duplicate asset names')
  }

  const merged: MacUpdateInfo = {
    version: x64.version,
    files,
    path: x64Zip.url,
    sha512: x64Zip.sha512,
    ...(x64.releaseDate === undefined ? {} : { releaseDate: x64.releaseDate }),
  }
  writeFileSync(outputPath, yaml.dump(merged, { lineWidth: -1, noRefs: true }))
  return merged
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arm64Path, x64Path, outputPath] = process.argv.slice(2)
  if (arm64Path === undefined || x64Path === undefined || outputPath === undefined) {
    throw new TypeError('usage: desktop-release-update-info <arm64 metadata.yml> <x64 metadata.yml> <output metadata.yml>')
  }
  mergeMacUpdateInfo(arm64Path, x64Path, outputPath)
}
