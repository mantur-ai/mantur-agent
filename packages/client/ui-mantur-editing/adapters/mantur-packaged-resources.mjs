/** Resolve the packaged editor's declared resources without searching outside its installation. */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const directories = new Set(['web', 'remotionBundle', 'compositor'])
const names = ['server', 'web', 'remotionBundle', 'browserExecutable', 'ffmpeg', 'ffprobe', 'compositor', 'whisperCli', 'whisperServer']

/**
 * Read the target-specific manifest and reject absent, escaped or wrong-kind resources.
 * @param {string} root - Absolute installed editor resource directory.
 * @param {string} platform - Target operating system; defaults to this process.
 * @param {string} arch - Target CPU architecture; defaults to this process.
 * @returns {import('./mantur-packaged-resources.d.mts').PackagedResources} Verified absolute paths.
 */
export function resolvePackagedResources(root, platform = process.platform, arch = process.arch) {
  if (!isAbsolute(root)) throw new Error('Packaged editor resource root must be absolute')
  const canonical = realpathSync(root)
  const manifest = JSON.parse(readFileSync(join(canonical, 'manifest.json'), 'utf8'))
  if (manifest?.formatVersion !== 1 || manifest.platform !== platform || manifest.arch !== arch
    || !['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(`${platform}-${arch}`)) {
    throw new Error('Packaged editor manifest does not match this platform and format')
  }
  const paths = {}
  function resolveResource(name, value, directory = false) {
    if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')
      || value.split('/').some(part => part === '..' || part === '.' || !part)) {
      throw new Error(`Packaged editor manifest needs a contained relative path: ${name}`)
    }
    const target = realpathSync(join(canonical, value))
    const contained = relative(canonical, target)
    if (!contained || isAbsolute(contained) || contained === '..' || contained.startsWith(`..${sep}`)) {
      throw new Error(`Packaged editor resource escapes its installation: ${name}`)
    }
    const info = statSync(target)
    if (directory ? !info.isDirectory() : !info.isFile()) {
      throw new Error(`Packaged editor resource has the wrong file kind: ${name}`)
    }
    return target
  }
  for (const name of names) paths[name] = resolveResource(name, manifest.paths?.[name], directories.has(name))
  if (paths.whisperServer !== join(dirname(paths.whisperCli), `whisper-server${platform === 'win32' ? '.exe' : ''}`)) {
    throw new Error('Packaged whisper-server must be the declared sibling of whisper-cli')
  }
  for (const [name, child] of [['web', 'index.html'], ['web', 'mantur-theme.mjs'], ['remotionBundle', 'index.html']]) {
    resolveResource(`${name}/${child}`, `${manifest.paths[name]}/${child}`)
  }
  return paths
}
