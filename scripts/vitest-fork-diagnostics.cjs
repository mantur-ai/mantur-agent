/** Record only Vitest fork lifecycle facts for Windows coverage crash diagnosis. */
const childProcess = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')

const destination = process.env.DSH_VITEST_FORK_DIAGNOSTICS
if (!destination) throw new Error('DSH_VITEST_FORK_DIAGNOSTICS must name the diagnostic output file')
const originalFork = childProcess.fork
childProcess.fork = function (...args) {
  const child = Reflect.apply(originalFork, this, args)
  if (/(?:^|[\\/])vitest[\\/]dist[\\/]workers[\\/]forks\.js$/u.test(String(args[0]))) {
    const identity = { parentPid: process.pid, pid: child.pid, node: process.version, platform: process.platform }
    appendFileSync(destination, `${JSON.stringify({ ...identity, event: 'start' })}\n`)
    child.once('exit', (code, signal) => {
      appendFileSync(destination, `${JSON.stringify({ ...identity, event: 'exit', code, signal })}\n`)
    })
  }
  return child
}
syncBuiltinESMExports()
