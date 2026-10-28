/** Compare isolated native directory deletion calls before rebuilding the Windows candidate. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const script = fileURLToPath(import.meta.url)
const nodeVersion = '24.18.1'
const electronVersion = '43.4.0'
const browserRmOptions = { maxRetries: 2, recursive: true, force: true, retryDelay: 100 }
const comparisons = [
  { alphabet: 'ascii', method: 'rmSync' },
  { alphabet: 'chinese', method: 'rmSync' },
  { alphabet: 'chinese', method: 'rmAsync' },
  { alphabet: 'chinese', method: 'unlinkRmdirSync' },
]
const cases = ['node', 'electron'].flatMap(runtime => comparisons.map(comparison => ({
  runtime, ...comparison, name: `${runtime}-${comparison.alphabet}-${comparison.method}`,
})))

function removeWithUnlinkAndRmdir(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) removeWithUnlinkAndRmdir(child)
    else fs.unlinkSync(child)
  }
  fs.rmdirSync(directory)
}

/**
 * Create and delete only a new case-owned tree, recording entry and return independently.
 * @param {string} directory New absolute case directory; existing directories are refused.
 * @param {{alphabet: string, method: string}} comparison One of the declared deletion comparisons.
 * @param {(event: object) => void} record Synchronous diagnostic writer.
 * @returns {Promise<void>} Resolves only after the tested directory is actually absent.
 */
export async function runCleanupCase(directory, comparison, record) {
  assert(isAbsolute(directory), 'Cleanup case requires an absolute owned directory')
  assert(comparisons.some(value => value.alphabet === comparison.alphabet && value.method === comparison.method), 'Unknown comparison')
  await mkdir(directory)
  const profile = join(directory, 'workspace', comparison.alphabet === 'chinese' ? '剪辑' : 'editing',
    'windows-native', comparison.alphabet === 'chinese' ? '工程' : 'project', '.mantur-runtime-probe',
    'tmp', 'puppeteer_dev_chrome_profile-probe')
  await mkdir(join(profile, 'Default', 'Cache', 'Cache_Data'), { recursive: true })
  await writeFile(join(profile, 'DevToolsActivePort'), 'probe-only')
  await writeFile(join(profile, 'Default', 'Cache', 'Cache_Data', 'entry'), 'probe-only')
  record({ event: 'created', profile, method: comparison.method, rmOptions: browserRmOptions })
  record({ event: 'remove-call', profile })
  if (comparison.method === 'rmSync') fs.rmSync(profile, browserRmOptions)
  else if (comparison.method === 'rmAsync') await rm(profile, browserRmOptions)
  else removeWithUnlinkAndRmdir(profile)
  const removed = !fs.existsSync(profile)
  record({ event: 'remove-return', profile, removed })
  assert(removed, 'Deletion returned without removing the case-owned directory')
}

async function binaryIdentity(file) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length }
  return { path: file, bytes, sha256: hash.digest('hex') }
}

function readEvents(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function executeChild(output, name) {
  const comparison = cases.find(value => value.name === name)
  assert(comparison, 'Unknown native cleanup case')
  const file = join(output, 'logs', `${name}.ndjson`)
  const descriptor = fs.openSync(file, 'wx')
  const record = event => fs.writeSync(descriptor, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event }) + '\n')
  record({ event: 'runtime', versions: process.versions, platform: process.platform, arch: process.arch })
  try {
    assert.equal(process.platform, 'win32')
    assert.equal(process.arch, 'x64')
    assert.equal(process.versions.node, nodeVersion)
    assert.equal(process.versions.electron, comparison.runtime === 'electron' ? electronVersion : undefined)
    await runCleanupCase(join(output, 'cases', name), comparison, record)
  } catch (error) {
    record({ event: 'throw', name: error.name, code: error.code, message: error.message })
    process.exitCode = 1
  } finally { fs.closeSync(descriptor) }
}

async function supervise(electron, requestedOutput) {
  assert.equal(process.platform, 'win32', 'This diagnostic requires native Windows x64')
  assert.equal(process.arch, 'x64')
  assert.equal(process.versions.node, nodeVersion)
  assert.equal(process.versions.electron, undefined, 'Use native Node as the supervisor')
  assert(isAbsolute(electron), 'Provide the exact absolute Electron executable')
  const executable = await realpath(electron)
  const output = resolve(requestedOutput)
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  for (const name of ['logs', 'cases', 'environment']) await mkdir(join(output, name))
  const identities = { node: await binaryIdentity(process.execPath), electron: await binaryIdentity(executable) }
  const report = { scope: 'WINDOWS_BROWSER_PROFILE_DELETION_DIAGNOSTIC', status: 'INCOMPLETE',
    nodeVersion, electronVersion, script: await binaryIdentity(script), identities, cases: [] }
  const systemRoot = process.env.SystemRoot
  assert(systemRoot, 'Native probe requires SystemRoot')
  for (const comparison of cases) {
    const home = join(output, 'environment', comparison.name)
    await mkdir(home)
    const environment = { SystemRoot: systemRoot, PATH: join(systemRoot, 'System32'),
      HOME: home, USERPROFILE: home, APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local'),
      TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
      ...(comparison.runtime === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    }
    for (const path of [environment.APPDATA, environment.LOCALAPPDATA, environment.TEMP]) await mkdir(path)
    const result = spawnSync(comparison.runtime === 'electron' ? executable : process.execPath,
      [script, '--case', comparison.name, '--output', output],
      { env: environment, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 })
    await writeFile(join(output, 'logs', `${comparison.name}.stdout.txt`), result.stdout ?? '')
    await writeFile(join(output, 'logs', `${comparison.name}.stderr.txt`), result.stderr ?? '')
    const events = readEvents(join(output, 'logs', `${comparison.name}.ndjson`))
    const runtime = events.find(event => event.event === 'runtime')
    const created = events.find(event => event.event === 'created')
    const returned = events.find(event => event.event === 'remove-return')
    const identityMatches = runtime?.platform === 'win32' && runtime.arch === 'x64'
      && runtime.versions.node === nodeVersion
      && runtime.versions.electron === (comparison.runtime === 'electron' ? electronVersion : undefined)
    report.cases.push({ ...comparison, pid: result.pid, code: result.status, signal: result.signal,
      spawnError: result.error ? { name: result.error.name, code: result.error.code, message: result.error.message } : null,
      identityMatches, enteredDeletion: events.some(event => event.event === 'remove-call'),
      returned: returned !== undefined, removed: created ? !fs.existsSync(created.profile) : null,
      profile: created?.profile, events })
    await writeFile(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n')
  }
  report.status = report.cases.every(value => value.identityMatches && value.enteredDeletion && !value.spawnError)
    ? 'DIAGNOSTIC_COMPLETE' : 'INCOMPLETE'
  await writeFile(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (report.status !== 'DIAGNOSTIC_COMPLETE') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const { values } = parseArgs({ options: { electron: { type: 'string' }, output: { type: 'string' }, case: { type: 'string' } } })
  assert(values.output, 'Provide --output <fresh diagnostic directory>')
  if (values.case) await executeChild(resolve(values.output), values.case)
  else {
    assert(values.electron, 'Provide --electron <exact Electron 43.4.0 executable>')
    await supervise(values.electron, values.output)
  }
}
