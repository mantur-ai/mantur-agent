/** Record only Vitest fork lifecycle facts for Windows coverage crash diagnosis. */
const childProcess = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')

const destination = process.env.DSH_VITEST_FORK_DIAGNOSTICS
if (!destination) throw new Error('DSH_VITEST_FORK_DIAGNOSTICS must name the diagnostic output file')
const originalFork = childProcess.fork
let forkId = 0
childProcess.fork = function (...args) {
  const child = Reflect.apply(originalFork, this, args)
  if (/(?:^|[\\/])vitest[\\/]dist[\\/]workers[\\/]forks\.js$/u.test(String(args[0]))) {
    const identity = { parentPid: process.pid, pid: child.pid, forkId: ++forkId, node: process.version, platform: process.platform }
    const record = (event) => appendFileSync(destination, `${JSON.stringify({ ...identity, timestamp: new Date().toISOString(), ...event })}\n`)
    record({ event: 'start' })
    const originalSend = child.send
    child.send = function (...sendArgs) {
      const message = sendArgs[0]
      if (message?.__vitest_worker_request__ === true && (message.type === 'run' || message.type === 'collect')) {
        record({ event: 'dispatch', method: message.type, files: message.context.files.map(file => file.filepath) })
      }
      return Reflect.apply(originalSend, this, sendArgs)
    }
    child.once('exit', (code, signal) => {
      record({ event: 'exit', code, signal })
    })
  }
  return child
}
syncBuiltinESMExports()
