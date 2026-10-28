/** Record bounded diagnostics for the task-owned Electron-as-Node media smoke. */
const assert = require('node:assert/strict')
const { ChildProcess } = require('node:child_process')
const { errorMonitor } = require('node:events')
const { openSync, writeSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')

const directory = process.env.MANTUR_CUT_SMOKE_TRACE_DIRECTORY
assert(directory && isAbsolute(directory), 'Smoke diagnostics require an absolute task directory')
assert.equal(typeof Object.getOwnPropertyDescriptor(process.report, 'excludeEnv')?.set, 'function')
process.report.excludeEnv = true
process.report.directory = directory
process.report.filename = 'editor-fatal.json'
process.report.reportOnFatalError = true
const descriptor = openSync(join(directory, 'editor-events.ndjson'), 'wx')
let count = 0
let recording = true
function record(event, fields = {}) {
  if (!recording) return
  if (count++ === 512) { event = 'event-limit'; fields = {}; recording = false }
  try { writeSync(descriptor, JSON.stringify({ event, pid: process.pid, at: new Date().toISOString(), ...fields }) + '\n') }
  catch { recording = false } // Diagnostic I/O failure must not replace the observed call's result or exception.
}
function failure(error) {
  return { name: String(error?.name ?? 'Error'), code: error?.code, message: String(error?.message ?? error).slice(0, 1024) }
}
record('start', { versions: process.versions, excludeEnvironment: process.report.excludeEnv })

const spawn = ChildProcess.prototype.spawn
ChildProcess.prototype.spawn = function (...args) {
  const executable = String(args[0]?.file ?? '').slice(0, 1024)
  record('spawn-call', { executable })
  try {
    const result = Reflect.apply(spawn, this, args)
    record('spawn-return', { executable, childPid: this.pid })
    this.once(errorMonitor, error => record('child-error', { executable, childPid: this.pid, error: failure(error) }))
    this.once('exit', (code, signal) => record('child-exit', { executable, childPid: this.pid, code, signal }))
    return result
  } catch (error) { record('spawn-throw', { executable, error: failure(error) }); throw error }
}

const dlopen = process.dlopen
process.dlopen = function (...args) {
  const file = String(args[1]).slice(0, 1024)
  record('dlopen-call', { file })
  try {
    const result = Reflect.apply(dlopen, this, args)
    record('dlopen-return', { file })
    return result
  } catch (error) { record('dlopen-throw', { file, error: failure(error) }); throw error }
}

process.on('uncaughtExceptionMonitor', error => record('uncaught-exception', { error: failure(error) }))
process.on('exit', code => record('exit', { code }))
