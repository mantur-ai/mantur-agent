/** Shared owning IPC shutdown for the development and packaged editor entry points. */
export function installRuntimeShutdown({ drain, close }) {
  const drainBudget = Number(process.env.MANTUR_CUT_DRAIN_TIMEOUT_MS)
  const closeBudget = Number(process.env.MANTUR_CUT_STOP_TIMEOUT_MS)
  for (const budget of [drainBudget, closeBudget]) {
    if (!Number.isInteger(budget) || budget < 1 || budget > 2147483647) throw new Error('Editor shutdown requires bounded Host deadlines')
  }
  if (!process.send) throw new Error('Editor shutdown requires its owning Host IPC channel')
  const bounded = (work, budget) => {
    let timer
    return Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Editor shutdown timed out; completion is unconfirmed')), budget)
      }),
    ]).finally(() => clearTimeout(timer))
  }
  let draining
  let stopping
  const stopForShutdown = () => draining ??= bounded(Promise.resolve().then(drain), drainBudget)
  const stop = () => stopping ??= (async () => {
    await stopForShutdown()
    await bounded(Promise.resolve().then(close), closeBudget)
  })()
  const describeFailure = error => error instanceof AggregateError
    ? `${error.message}: ${error.errors.map(describeFailure).join('; ')}`
    : error instanceof Error ? error.message : String(error)
  const report = (stage, error) => new Promise((resolve, reject) => {
    if (!process.connected) { resolve(); return }
    process.send({ type: `mantur-cut:${stage}-result`, ok: error === undefined,
      ...(error === undefined ? {} : { error: describeFailure(error) }),
    }, failure => failure ? reject(failure) : resolve())
  })
  const request = async stage => {
    try {
      await (stage === 'drain' ? stopForShutdown() : stop())
      await report(stage)
      if (stage === 'stop') process.exit(0)
    } catch (error) {
      console.error(error)
      try { await report(stage, error) } catch (reportError) { console.error(reportError) }
      // A failed drain retains outstanding work; forcing exit would falsify its completion.
      process.exitCode = 1
    }
  }
  process.on('message', message => {
    if (message?.type === 'mantur-cut:drain') void request('drain')
    if (message?.type === 'mantur-cut:stop') void request('stop')
  })
  for (const event of ['SIGTERM', 'SIGINT', 'disconnect']) process.once(event, () => { void request('stop') })
  return { stopForShutdown, stop, startupFailed: error => report('startup', error) }
}
