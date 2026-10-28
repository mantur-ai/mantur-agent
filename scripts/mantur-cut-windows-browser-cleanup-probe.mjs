/** Observe the locked Windows Chrome cleanup order without changing the shipped runtime. */
import assert from 'node:assert/strict'
import { exec, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { availableParallelism, freemem } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const script = fileURLToPath(import.meta.url)
const nodeVersion = '24.18.1'
const electronVersion = '43.4.0'
const chromeVersion = '149.0.7790.0'
const rmOptions = { maxRetries: 2, recursive: true, force: true, retryDelay: 100 }
const comparisons = [
  { key: 'a1', runtime: 'electron', alphabet: 'chinese', waitForClose: false },
  { key: 'b1', runtime: 'electron', alphabet: 'chinese', waitForClose: true },
  { key: 'c1', runtime: 'node', alphabet: 'chinese', waitForClose: false },
  { key: 'd1', runtime: 'electron', alphabet: 'ascii', waitForClose: false },
]

/**
 * Keep the immediate and awaited cases identical except for the cleanup ordering.
 * @param {boolean} waitForClose Whether deletion waits for both callback and actual browser close.
 * @param {() => Promise<void>} startTaskkill Start the original asynchronous taskkill call.
 * @param {Promise<void>} browserClosed Actual process and stdio close observation.
 * @param {() => void} remove Run the same synchronous directory deletion in both cases.
 * @returns {Promise<void>} Completes after callback and close, retaining any deletion exception.
 */
export async function exerciseCleanupOrder(waitForClose, startTaskkill, browserClosed, remove) {
  const callback = startTaskkill()
  if (waitForClose) await Promise.all([callback, browserClosed])
  let failure
  try { remove() } catch (error) { failure = { error } }
  await Promise.all([callback, browserClosed])
  if (failure) throw failure.error
}

function profilePath(root, comparison) {
  return join(root, 'cases', comparison.key, 'workspace', comparison.alphabet === 'chinese' ? '剪辑' : 'aa',
    'windows-native', comparison.alphabet === 'chinese' ? '工程' : 'bb', '.mantur-runtime-probe0',
    'tmp', 'puppeteer_dev_chrome_profile-probe0')
}

// The Windows angle/headless-shell arguments from pinned Remotion 4.0.509 open-browser.js.
function browserArguments(profile, videoThreads) {
  return ['about:blank', '--allow-pre-commit-input', '--disable-background-networking',
    '--enable-features=NetworkService,NetworkServiceInProcess,CanvasDrawElement', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-breakpad', '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages', '--disable-default-apps', '--disable-dev-shm-usage',
    '--no-proxy-server', "--proxy-server='direct://'", '--proxy-bypass-list=*', '--force-gpu-mem-available-mb=4096',
    '--disable-hang-monitor', '--disable-extensions', '--allow-chrome-scheme-url', '--disable-ipc-flooding-protection',
    '--disable-popup-blocking', '--disable-prompt-on-repost', '--disable-renderer-backgrounding', '--disable-sync',
    '--force-color-profile=srgb', '--metrics-recording-only', '--mute-audio', '--no-first-run', `--video-threads=${videoThreads}`,
    '--enable-automation', '--password-store=basic', '--use-mock-keychain', '--enable-blink-features=IdleDetection',
    '--export-tagged-pdf', '--intensive-wake-up-throttling-policy=0', '--headless=old', '--no-sandbox',
    '--disable-setuid-sandbox', '--use-gl=angle', '--disable-background-media-suspend', '--allow-running-insecure-content',
    '--disable-component-update', '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate,BackForwardCache,AvoidUnnecessaryBeforeUnloadCheckSync,IntensiveWakeUpThrottling,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    '--disable-print-preview', '--disable-site-isolation-trials', '--disk-cache-size=268435456', '--hide-scrollbars',
    '--no-default-browser-check', '--no-pings', '--font-render-hinting=none', '--no-zygote', '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`]
}

function profileMetadata(profile) {
  const entries = []
  const pending = [profile]
  while (pending.length && entries.length < 2000) {
    const path = pending.shift()
    let info
    try { info = fs.lstatSync(path) }
    catch (error) { entries.push({ path: relative(profile, path), error: error.code }); continue }
    const kind = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
    entries.push({ path: relative(profile, path), kind, bytes: info.size, mode: info.mode })
    if (kind === 'directory') {
      try { for (const name of fs.readdirSync(path).sort()) pending.push(join(path, name)) }
      catch (error) { entries.push({ path: relative(profile, path), readDirectoryError: error.code }) }
    }
  }
  return { profile, pathLength: profile.length, utf8Bytes: Buffer.byteLength(profile), entries, truncated: pending.length > 0 }
}

function bounded(promise, milliseconds, label) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
  })]).finally(() => clearTimeout(timer))
}

async function childCase(root, chrome, key, videoThreads) {
  const comparison = comparisons.find(value => value.key === key)
  assert(comparison, 'Unknown live browser case')
  const descriptor = fs.openSync(join(root, 'logs', `${key}.ndjson`), 'wx')
  let recording = true
  const record = event => {
    if (recording) fs.writeSync(descriptor, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event }) + '\n')
  }
  record({ event: 'runtime', versions: process.versions, platform: process.platform, arch: process.arch })
  assert.equal(process.platform, 'win32')
  assert.equal(process.arch, 'x64')
  assert.equal(process.versions.node, nodeVersion)
  assert.equal(process.versions.electron, comparison.runtime === 'electron' ? electronVersion : undefined)
  await mkdir(join(root, 'cases', key))
  const profile = profilePath(root, comparison)
  await mkdir(profile, { recursive: true })
  record({ event: 'profile', profile, pathLength: profile.length, utf8Bytes: Buffer.byteLength(profile) })
  let browser
  let socket
  let resolvePage
  const ownedPage = new Promise(resolveReady => { resolvePage = resolveReady })
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/owned-ready') {
      response.writeHead(204).end()
      record({ event: 'owned-page-ready' })
      resolvePage()
    } else if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600' })
      response.end('<canvas width="64" height="64"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="red";c.fillRect(0,0,64,64);localStorage.setItem("cleanup-probe","owned");fetch("/owned-ready",{method:"POST"});</script>')
    } else response.writeHead(404).end()
  })
  await new Promise((resolveListening, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListening) })
  const page = `http://127.0.0.1:${server.address().port}/`
  try {
    const args = browserArguments(profile, videoThreads)
    record({ event: 'browser-spawn-call', executable: chrome, args })
    browser = spawn(chrome, args, { env: process.env, detached: false, stdio: ['pipe', 'pipe', 'pipe'] })
    record({ event: 'browser-spawn-return', browserPid: browser.pid, executable: chrome, profile })
    let exitObserved = false
    let closeObserved = false
    const closed = new Promise(resolveClosed => browser.once('close', (code, signal) => {
      closeObserved = true
      record({ event: 'browser-close', browserPid: browser.pid, code, signal })
      resolveClosed()
    }))
    browser.once('exit', (code, signal) => {
      exitObserved = true
      record({ event: 'browser-exit', browserPid: browser.pid, code, signal })
    })
    const ready = new Promise((resolveReady, reject) => {
      let stderr = ''
      browser.once('error', reject)
      browser.stdout.resume()
      browser.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024)
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
        if (match) resolveReady(match[1])
      })
      void closed.then(() => reject(new Error('Chrome closed before or during readiness')))
    })
    const endpoint = await bounded(ready, 25_000, 'Chrome DevTools readiness')
    record({ event: 'browser-ready', browserPid: browser.pid })
    socket = new WebSocket(endpoint)
    await bounded(new Promise((resolveOpened, reject) => {
      socket.addEventListener('open', resolveOpened, { once: true })
      socket.addEventListener('error', () => reject(new Error('DevTools connection failed')), { once: true })
    }), 5000, 'DevTools connection')
    const targetCreated = new Promise((resolveTarget, reject) => {
      socket.addEventListener('message', event => {
        const value = JSON.parse(String(event.data))
        if (value.id !== 1) return
        if (value.error) reject(new Error(JSON.stringify(value.error)))
        else resolveTarget()
      })
    })
    socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: page } }))
    await bounded(Promise.all([targetCreated, ownedPage]), 5000, 'Owned Chrome page')
    await writeFile(join(root, 'metadata', `${key}.json`), JSON.stringify(profileMetadata(profile), null, 2) + '\n')
    assert.equal(exitObserved, false, 'Chrome must still be alive before the observed cleanup')
    const taskkill = () => new Promise(resolveCallback => {
      record({ event: 'taskkill-call', targetPid: browser.pid, waitForClose: comparison.waitForClose })
      const command = exec(`taskkill /pid ${browser.pid} /T /F`, error => {
        record({ event: 'taskkill-callback', targetPid: browser.pid, error: error ? { code: error.code, message: error.message } : null })
        if (error) browser.kill()
        resolveCallback()
      })
      record({ event: 'taskkill-started', taskkillPid: command.pid, targetPid: browser.pid })
    })
    const remove = () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        record({ event: 'remove-call', profile, attempt, rmOptions, exitObserved, closeObserved })
        try {
          fs.rmSync(profile, rmOptions)
          record({ event: 'remove-return', profile, attempt, removed: !fs.existsSync(profile), exitObserved, closeObserved })
          return
        } catch (error) {
          record({ event: 'remove-throw', attempt, name: error.name, code: error.code, message: error.message })
          if (attempt === 2) throw error
        }
      }
    }
    await bounded(exerciseCleanupOrder(comparison.waitForClose, taskkill, closed, remove), 10_000, 'Browser cleanup')
    record({ event: 'complete', removed: !fs.existsSync(profile), exitObserved, closeObserved })
  } catch (error) {
    record({ event: 'throw', name: error.name, code: error.code, message: error.message })
    process.exitCode = 1
  } finally {
    socket?.close()
    server.closeAllConnections()
    await new Promise(resolveClosed => server.close(resolveClosed))
    // The supervisor verifies identity and cleans any remaining browser after this case exits.
    browser?.unref()
    browser?.stdin.destroy()
    browser?.stdout.destroy()
    browser?.stderr.destroy()
    recording = false
    fs.closeSync(descriptor)
  }
}

async function identity(file) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length }
  return { path: file, bytes, sha256: hash.digest('hex') }
}

/**
 * Observe absence without launching a shell or signaling the process.
 * @param {number} pid Browser PID recorded by the owning case.
 * @returns {boolean} True only when the native process query reports ESRCH.
 */
export function browserIsAbsent(pid) {
  try { process.kill(pid, 0); return false }
  catch (error) {
    if (error.code === 'ESRCH') return true
    throw error
  }
}

function verifyAndCleanBrowser(chrome, profile, browserPid, parentPid, environment) {
  if (!Number.isInteger(browserPid)) return { status: 'not-started', absent: true }
  try {
    if (browserIsAbsent(browserPid)) return { status: 'absent-native-query', absent: true, browserPid }
  } catch (error) {
    return { status: 'native-query-failed', absent: false, error: { code: error.code, message: error.message } }
  }
  const code = String.raw`
[Console]::Error.WriteLine('cleanup-script-entered')
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('cleanup-cim-query-call')
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $env:MANTUR_PROBE_BROWSER_PID"
[Console]::Error.WriteLine('cleanup-cim-query-return')
if ($null -eq $target) { @{status='absent';absent=$true}|ConvertTo-Json -Compress; exit 0 }
$pathMatches = [string]::Equals($target.ExecutablePath, $env:MANTUR_PROBE_CHROME, [StringComparison]::OrdinalIgnoreCase)
$parentMatches = $target.ParentProcessId -eq [int]$env:MANTUR_PROBE_PARENT_PID
$profileMatches = ([string]$target.CommandLine).Contains('--user-data-dir=' + $env:MANTUR_PROBE_PROFILE)
if (!$pathMatches -or !$parentMatches -or !$profileMatches) {
  @{status='identity-mismatch';absent=$false;pathMatches=$pathMatches;parentMatches=$parentMatches;profileMatches=$profileMatches}|ConvertTo-Json -Compress
  exit 1
}
$ErrorActionPreference = 'Continue'
[Console]::Error.WriteLine('cleanup-taskkill-call')
$output = & "$env:SystemRoot\System32\taskkill.exe" /pid $target.ProcessId /T /F 2>&1
$killCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do { $remaining = Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue; if ($null -eq $remaining) { break }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
[Console]::Error.WriteLine('cleanup-presence-check-return')
@{status='verified-cleanup';absent=($null -eq $remaining);taskkillCode=$killCode;pathMatches=$pathMatches;parentMatches=$parentMatches;profileMatches=$profileMatches}|ConvertTo-Json -Compress
if ($null -ne $remaining) { exit 1 }
`
  const result = spawnSync(join(environment.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', code], { env: { ...environment,
      MANTUR_PROBE_BROWSER_PID: String(browserPid), MANTUR_PROBE_PARENT_PID: String(parentPid),
      MANTUR_PROBE_CHROME: chrome, MANTUR_PROBE_PROFILE: profile,
    }, encoding: 'utf8', timeout: 12_000, maxBuffer: 64 * 1024, windowsHide: true })
  let observation
  try { observation = JSON.parse(result.stdout.trim()) }
  catch { observation = { status: 'unreadable-cleanup-result', absent: false } }
  return { ...observation, code: result.status, signal: result.signal, stderr: result.stderr,
    error: result.error ? { code: result.error.code, message: result.error.message } : null }
}

async function supervise(electron, chrome, requestedRoot, selectedCases) {
  assert.equal(process.platform, 'win32')
  assert.equal(process.arch, 'x64')
  assert.equal(process.versions.node, nodeVersion)
  assert.equal(process.versions.electron, undefined)
  assert(isAbsolute(electron) && isAbsolute(chrome), 'Use exact absolute executable paths')
  const root = resolve(requestedRoot)
  await mkdir(dirname(root), { recursive: true })
  await mkdir(root)
  for (const name of ['logs', 'metadata', 'cases', 'environment']) await mkdir(join(root, name))
  const binaries = { electron: await realpath(electron), chrome: await realpath(chrome), node: process.execPath }
  const identities = Object.fromEntries(await Promise.all(Object.entries(binaries).map(async ([name, path]) => [name, await identity(path)])))
  const systemRoot = process.env.SystemRoot
  assert(systemRoot, 'Native probe requires SystemRoot')
  const baseEnvironment = { SystemRoot: systemRoot, PATH: join(systemRoot, 'System32') }
  const version = spawnSync(binaries.chrome, ['--version'], { env: baseEnvironment, encoding: 'utf8', timeout: 10_000 })
  assert.equal(version.status, 0, 'Pinned Chrome must report its version')
  assert.match(version.stdout, /\b149\.0\.7790\.0\b/)
  const sourceFile = new URL('../apps/desktop/mantur-cut/source.win32-x64.json', import.meta.url)
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  assert.equal(source.targets['win32-x64'].chromeVersion, chromeVersion)
  assert.equal(source.remotionVersion, '4.0.509')
  assert.equal(source.electronVersion, electronVersion)
  const videoThreads = Math.max(1, Math.round(Math.min(availableParallelism() * 2 / 3, (freemem() - 2_000_000_000) / 400_000_000)))
  const report = { scope: 'LIVE_WINDOWS_CHROME_PROFILE_CLEANUP_DIAGNOSTIC', status: 'INCOMPLETE', videoThreads,
    source: await identity(fileURLToPath(sourceFile)), script: await identity(script), identities,
    chromeVersionOutput: version.stdout.trim(), remotionVersion: source.remotionVersion,
    rawProfilesRetainedLocallyOnly: true, cases: [] }
  for (const comparison of comparisons.filter(value => selectedCases.includes(value.key))) {
    const home = join(root, 'environment', comparison.key)
    await mkdir(home)
    const environment = { ...baseEnvironment, HOME: home, USERPROFILE: home,
      APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') }
    for (const path of [environment.APPDATA, environment.LOCALAPPDATA, environment.TEMP]) await mkdir(path)
    const result = spawnSync(binaries[comparison.runtime], [script, '--case', comparison.key, '--chrome', binaries.chrome, '--output', root, '--video-threads', String(videoThreads)],
      { env: { ...environment, ...(comparison.runtime === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        encoding: 'utf8', timeout: 45_000, maxBuffer: 64 * 1024, windowsHide: true })
    await writeFile(join(root, 'logs', `${comparison.key}.stdout.txt`), result.stdout ?? '')
    await writeFile(join(root, 'logs', `${comparison.key}.stderr.txt`), result.stderr ?? '')
    const eventFile = join(root, 'logs', `${comparison.key}.ndjson`)
    const events = fs.existsSync(eventFile) ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
    const runtime = events.find(event => event.event === 'runtime')
    const browser = events.find(event => event.event === 'browser-spawn-return')
    const profile = profilePath(root, comparison)
    const cleanup = verifyAndCleanBrowser(binaries.chrome, profile, browser?.browserPid, result.pid, environment)
    report.cases.push({ ...comparison, pid: result.pid, code: result.status, signal: result.signal,
      spawnError: result.error ? { code: result.error.code, message: result.error.message } : null,
      identityMatches: runtime?.platform === 'win32' && runtime.arch === 'x64' && runtime.versions.node === nodeVersion
        && runtime.versions.electron === (comparison.runtime === 'electron' ? electronVersion : undefined),
      ready: events.some(event => event.event === 'browser-ready'), ownedPageReady: events.some(event => event.event === 'owned-page-ready'),
      enteredDeletion: events.some(event => event.event === 'remove-call'), profile, pathLength: profile.length,
      removed: !fs.existsSync(profile), cleanup, events })
    await writeFile(join(root, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n')
  }
  assert.equal(new Set(report.cases.map(value => value.pathLength)).size, 1, 'All comparison paths must have equal UTF-16 length')
  report.status = report.cases.every(value => value.identityMatches && value.ready && value.ownedPageReady
    && value.enteredDeletion && !value.spawnError && value.cleanup.absent) ? 'DIAGNOSTIC_COMPLETE' : 'INCOMPLETE'
  await writeFile(join(root, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (report.status !== 'DIAGNOSTIC_COMPLETE') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const { values } = parseArgs({ options: { electron: { type: 'string' }, chrome: { type: 'string' }, output: { type: 'string' }, case: { type: 'string' }, cases: { type: 'string' }, 'video-threads': { type: 'string' } } })
  assert(values.output && values.chrome, 'Provide --chrome <pinned executable> --output <fresh directory>')
  if (values.case) {
    const videoThreads = Number(values['video-threads'])
    assert(Number.isInteger(videoThreads) && videoThreads > 0, 'Use the supervisor-selected video thread count')
    await childCase(resolve(values.output), values.chrome, values.case, videoThreads)
  } else {
    assert(values.electron, 'Provide --electron <exact Electron 43.4.0 executable>')
    const selectedCases = values.cases ? values.cases.split(',') : comparisons.map(value => value.key)
    assert(selectedCases.length > 0 && selectedCases.every(key => comparisons.some(value => value.key === key))
      && new Set(selectedCases).size === selectedCases.length, 'Choose distinct known comparison cases')
    await supervise(values.electron, values.chrome, values.output, selectedCases)
  }
}
