# Agent Note: Observe CI fixture completion

Status: implemented

English | [中文](2026-09-07-observe-ci-fixture-completion.zh.md)

## Problem

The projection-cache threshold test polled a JSON file for five seconds after scheduling a write. This coupled a count-policy assertion to filesystem latency. Team mailbox coverage also depended on asynchronous recovery reaching a persisted receipt after its target left the live registry. The npm resolution benchmark used immediate recursive removal after its child exited, although Windows can retain temporary-directory handles briefly.

## Decision

The [cache threshold test](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) observes the real `write` promises, checks that two events schedule no extra write, and checks that the third schedules exactly one. It reads the stored value only after that write completes; it does not invoke a manual flush to satisfy the assertion.

The [Team mailbox fixture](../../../../packages/experimental/agent-team/tests/team.spec.ts) persists a target receipt, awaits its live acknowledgement work, stops the target, and then queues the Lead message. Dispatch must acknowledge the stored receipt without resuming the target, delivering another prompt, or making a model request. The Lead's stored log must contain exactly one delivered event.

The [npm benchmark](../../../../scripts/benchmark-npm-resolution.ts) removes its consumer directory with the existing [junction-safe cleanup helper](../../../../scripts/test-fixture-cleanup.ts) after the child and registry server close. The helper's bounded retry handles delayed Windows file release and still propagates exhausted cleanup failures. The [npm test deadlines](2026-09-04-windows-npm-resolution-test-budget.md) remain unchanged.

The [snapshot child-turn waiter](../../../../packages/test-support/session-snapshot/src/harness.ts) owns its polling deadline and awaits each filesystem harvest. Vitest can time out an asynchronous callback before it has produced a child-specific diagnostic; an owned loop reports the child and required turn after the current read settles. Expiration never permits an already-started read to overlap scenario cleanup, and a completed read after the deadline cannot turn expiration into success.

The [Team recovery fixture](../../../../packages/experimental/agent-team/tests/persistence.spec.ts) separates child registry removal from mailbox acknowledgement completion. Its barrier delays the return from a real target flush, then joins the registered acknowledgement operations before checking delivery. The target can leave the registry while that acknowledgement is pending; a one-second poll does not establish completion.

Windows coverage loads a [fork diagnostic preload](../../../../scripts/vitest-fork-diagnostics.cjs) and preserves its JSONL file on failure. Records contain only lifecycle event, parent and worker PIDs, Node version, platform, exit code, and signal. The observer does not change child outcomes or record arguments, environment, test payloads, or raw crash reports. Exit facts narrow an unexplained worker death; collecting them is not a repair.

The [native account Host fixture](../../../../apps/desktop/tests/native-account-host-support.ts) sends the active Vitest case budget to its real IPC child. Windows coverage grants 90 seconds per case, while descriptor ACL cases in [run 34089493592](https://github.com/mantur-ai/mantur-harness/actions/runs/34089493592/job/101639924686) took 27–51 seconds; the fixture's former 10-second parent-reply deadline expired before preparation completed. The handshake test observes the budget received from the child, not just the parent input. Production transport deadlines and the separate Bash command fixture remain unchanged. Fixture cleanup attempts Main shutdown even when the consumer receipt assertion fails, and retains both errors if both operations reject. Child close and temporary-directory cleanup remain awaited; this does not make a failed receipt successful or establish native Windows acceptance locally.

The opt-in [workflow reporter](../../../../scripts/workflow-case-reporter.ts) records parent-side module and case callbacks. Set `DSH_WORKFLOW_CASE_DIAGNOSTICS` to a file in an existing artifact directory and append `--reporter=default --reporter=./scripts/workflow-case-reporter.ts` to the Vitest command. The [test setup](../../../../scripts/workflow-case-setup.ts) writes synchronous `before-each` and `after-each` records to the same destination with `.worker.jsonl` appended; configuration loads it only when the variable is set. Both observers select only `workflow-worker-thread.spec.ts` and record identity, timestamps and phases, without payloads or errors. Preserve both files alongside fork-exit evidence. An empty destination or failed write fails the diagnostic run.

The native-tests command in [ci.yml](../../../../.github/workflows/ci.yml) enables both existing observers. Its `failure()` upload selects exactly the parent-case, worker-hook and fork-exit JSONL files from the job's temporary directory, retains them for seven days, and reports an error if no diagnostic file exists. It does not upload arbitrary temporary files or change the failed test outcome.

Worker death can discard buffered parent callbacks, so an absent parent case event does not prove that the case never started. Synchronous test hooks preserve an entered hook before abrupt worker exit; they do not cover import failures, prove completion of all cleanup, or attribute a native crash to the latest case. Previously started native work may still overlap. Normal and forced-exit subprocess checks verify persisted hook records; Windows native exception attribution still requires Windows evidence.

## Alternatives considered

Longer per-fixture polling deadlines still measure storage latency instead of completed writes. Repeating a mailbox scenario does not ensure it takes the cold-receipt path. Ignoring cleanup errors leaves temporary data behind. None of these establishes the required result.

## Consequences

Fixture assertions observe completed operations and exact durable results. The tests retain their coverage thresholds, and a rejected write or exhausted cleanup still fails. Local passing evidence does not establish Windows execution; the Windows lane remains required.
