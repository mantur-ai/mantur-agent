/** Opt-in parent-side lifecycle evidence for the Windows workflow fork crash. */
import { appendFileSync } from 'node:fs'
import type { Reporter, TestCase, TestModule } from 'vitest/node'

const target = '/packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts'

/** Record only workflow case identity and phase; no test payloads, errors or environment values. */
export default class WorkflowCaseReporter implements Reporter {
  private readonly destination: string

  constructor() {
    const destination = process.env.DSH_WORKFLOW_CASE_DIAGNOSTICS
    if (!destination) throw new Error('DSH_WORKFLOW_CASE_DIAGNOSTICS must name the diagnostic output file')
    this.destination = destination
  }

  onTestModuleQueued(module: TestModule): void { this.record('module-queued', module) }
  onTestModuleCollected(module: TestModule): void { this.record('module-collected', module) }
  onTestModuleStart(module: TestModule): void { this.record('module-start', module) }
  onTestModuleEnd(module: TestModule): void { this.record('module-end', module) }
  onTestCaseReady(test: TestCase): void { this.record('case-ready', test.module, test) }
  onTestCaseResult(test: TestCase): void { this.record('case-result', test.module, test) }

  private record(event: string, module: TestModule, test?: TestCase): void {
    const file = module.moduleId.replaceAll('\\', '/')
    if (!file.endsWith(target)) return
    appendFileSync(this.destination, JSON.stringify({
      event, timestamp: new Date().toISOString(), parentPid: process.pid, node: process.version,
      platform: process.platform, file, moduleId: module.id,
      ...(test === undefined ? {} : { testId: test.id, name: test.fullName }),
    }) + '\n')
  }
}
