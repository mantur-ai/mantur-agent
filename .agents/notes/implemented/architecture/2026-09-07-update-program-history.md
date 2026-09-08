# Agent Note: Execution history survives update shutdown

Status: implemented

English | [中文](2026-09-07-update-program-history.zh.md)

## Problem

An empty worker or dynamic-plugin registry does not prove that arbitrary program descendants have stopped. Removing a service before the update coordinator starts also hides that service from an instance-only audit.

## Decision

The worker provider records every attempted worker start. The dynamic runner records every admitted activation, including Client-only activation. Each module retains a monotonic WeakSet keyed by the Host root; exported queries remain available after all provider instances are removed. Scoped and replacement instances share that history. Another Host root has independent history. Syntax failures, pre-aborted worker requests, definitions and unanswered approvals do not record execution.

The dynamic runner closes definition, activation, Client-source and handler-call admission synchronously. Its shutdown cancels unanswered approvals, waits for admitted activations and handler invocations, then joins normal plugin retraction. Retraction failures remain recorded for every shutdown request. The worker provider retains its existing worker, pipe and admitted-binding drain. Neither operation certifies arbitrary background work or operating-system descendants.

The Mantur coordinator freezes both execution services before waiting for producers. It checks root history and every retained service before starting shutdown and before each receipt, including verification after root disposal. Missing history or prior execution prevents a receipt. The existing codeRuntime presence gate and shipped Host runner module exclusion remain in place while Shell completion policy is unresolved. Neither default nor custom compositions gain installation admission merely because these execution services are unused. Module HMR remains excluded.

## Evidence

Real-worker tests distinguish parsing or pre-abort from worker execution. Service tests retain history through stop, undefine, removal and scoped replacement, with an independent-root control. Handler and activation barriers prove shutdown waits for admitted work; handler failure still settles, retraction failure remains rejected, and new execution is refused. Consumer tests reject execution history after providers disappear before coordinator creation and recheck changed history after a receipt. The recorded CLI scenario pairs an accepted managed composition with a refused unused-worker composition and verifies each physical session log after Host exit.

## Alternatives considered

**Use the current live set.** It loses completed or removed executions. **Treat a successful managed stop as descendant completion.** Worker termination and plugin retraction cannot establish that fact. **Change execution isolation.** This change preserves current Shell and Node capabilities; operating-system containment is outside its scope.

## Consequences

Even never-used worker and shipped Host runner providers still block automatic installation. Any previous worker or dynamic activation requires manual handling of unverified descendants before installation outside this automatic path. Default-profile automatic installation remains unaccepted. Editing/MCP remains excluded until its owner drains accepted execution and material writes before AgentLoop quiesce cancels their signal. User cancellation or unknown remote completion must prevent a save receipt; origin routing alone does not establish completion.
