/** Opt-in synchronous workflow test phases survive loss of the Vitest worker IPC channel. */
import { appendFileSync } from 'node:fs'
import { afterEach, beforeEach, type TestContext } from 'vitest'

const destination = process.env.DSH_WORKFLOW_CASE_DIAGNOSTICS
if (destination === '') throw new Error('DSH_WORKFLOW_CASE_DIAGNOSTICS must name the diagnostic output file')

function record(output: string, event: string, { task }: TestContext): void {
  const file = task.file.filepath.replaceAll('\\', '/')
  if (!file.endsWith('/packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts')) return
  appendFileSync(output + '.worker.jsonl', JSON.stringify({
    event, timestamp: new Date().toISOString(), pid: process.pid, parentPid: process.ppid,
    node: process.version, platform: process.platform, file, testId: task.id, name: task.name,
  }) + '\n')
}

if (destination !== undefined) {
  beforeEach((context) => { record(destination, 'before-each', context) })
  afterEach((context) => { record(destination, 'after-each', context) })
}
