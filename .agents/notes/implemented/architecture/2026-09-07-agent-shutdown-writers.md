# Agent Note: Shutdown admission and writer checkpoints

Status: implemented

English | [中文](2026-09-07-agent-shutdown-writers.zh.md)

## Problem

Registry removal does not prove pending setup has ended or a writer closed successfully. A driver can also hold input outside its queue before execution begins. Installation must not infer durable quiescence from these partial observations.

## Decision

Host shutdown needs explicit owner operations before it can authorize installation. The agent registry freezes new agents and every live inbox. The loop retains a claimed batch until its step opening is committed; stopping before that point restores the original message identities and queue order once. Completed or uncertain execution is not replayed.

The factory joins raw setup and persistence acquisitions even when their public requests have already rejected cancellation. Abandoned handles remain tracked through close. Writer close failures survive removal from the live registries. Each session seals its append admission before writer close, and the factory verifies the seal again after tracked operations finish; a caught late append cannot produce a valid writer result. Successful results carry exclusive final offsets for closed writer lifetimes. The Host must call `verifyShutdown()` after other owners finish: the original shutdown promise retains its result, while fresh verification rejects append attempts made after that result resolved.

The local subprocess owner separately closes spawn admission and joins whole process trees and PTYs, retaining failed ownership. These operations do not cancel remote paid jobs. They do not constitute a global Host receipt: Cordis contains scope disposer errors, and other producer owners must supply independent successful results. The desktop installer remains blocked until that coordination exists.

The terminal registry also provides explicit shutdown: it rejects new spawns and sends, joins pending backend allocation and rollback, and closes published terminals. It retains cleanup errors even after ordinary disposal or a successful retry removes their records.

The background-job registry freezes new registrations and joins the original producer release promises and asynchronous completion listeners. It keeps failures after records leave the registry. It does not cancel work, including through subsequent owner disposal; separate execution owners stop local resources. A registry record forced into a failed state is not resource-release evidence. After shutdown begins, owner and service disposal join the associated completion notices before returning, so agent teardown cannot seal its writer ahead of an unfinished notice.

The workflow engine freezes new runs and joins thread termination, pending child starts, and child cleanup beyond ordinary disposal grace. Child cleanup errors survive removal of child and run records. A run leaves engine ownership only after disposal settles, its thread exits, and every child start and cleanup finishes; only its failures remain retained.

The subagent runtime owns raw starts and published one-shot disposals independently of delegation tools and workflow workers. A direct SDK child uses a separate subprocess launcher and has no local Agent, so neither the agent factory nor the local subprocess registry can prove its release. Continuation preparation, browser attachment admission, and lifecycle listeners also remain joined through shutdown. Tracking delivery alone misses attachment writes that precede it; browser prompt admission therefore owns its complete operation and closes before any new storage call. A disposed parent scope receives no completion notice while its writer is closing; shutdown suppresses automatic notices and preserves queued input. Cleanup failures remain recorded after handles and Activations leave their maps.

## Upstream ownership

Existing observer hooks cannot freeze direct inbox mutation, recover a claim held inside the driver, seal direct Session append, or retain a writer after the factory releases it. The changes therefore belong in `packages/core/agent/src/{index,inbox}.ts`, `packages/core/agent-loop/src/{index,agent}.ts`, `packages/core/session/src/index.ts`, and `packages/subprocess/subprocess-local/src/index.ts`. The terminal registry operation belongs in `packages/terminal/terminal/src/index.ts` because external hooks cannot freeze sends or retain removed allocation failures; its controlled late-allocation, close-join, and retained-failure tests are the upgrade checks. The job registry change belongs in `packages/jobs/jobs-local/src/index.ts`; plugins cannot freeze direct starts or recover discarded producer promises. Tests for uncancelled pending work, forced-failed records, late release, and completion listeners verify upgrades. Workflow changes belong in `packages/workflow/workflow-worker-thread/src/{index,host}.ts` because ordinary disposal can abandon children after its grace and contains cleanup failures. Late child allocation, disposal beyond grace, historical failures, and refused thread termination are the upgrade regressions. No vendored Cordis behavior changes. The factory retains closed session objects until its lifetime ends so it can detect post-close writes; that retention is the cost of verifying previously closed writers.

Subagent changes belong in `packages/subagent/subagent/src/{index,lifecycle,continuation}.ts`: provider removal and result settlement do not prove resource release, and observer-only hooks cannot freeze direct delegation or recover discarded cleanup errors. The in-process driver also preserves queued input when cancellation arrives after agent admission freezes; its abort listener cannot clear an already-frozen inbox. This change belongs in `packages/subagent/subagent-in-process-driver/src/index.ts`. Late startup rollback, removed-run failures, asynchronous notices, pending continuation preparation, and joint one-shot/continuable agent-loop shutdown are the upgrade checks.

## Verification

Controlled tests reject late agent publication, preserve unexecuted input, block direct inbox producers, join cancelled setup and abandoned writer cleanup, retain close failures, and reject writes after sealing. Real JSONL reads compare the final stored event list with the returned offset. The same owner regressions are the upgrade checks for these upstream files. Native installation and complete Host producer verification remain separate acceptance requirements.

## Alternatives considered

Global flush misses writers that have already left the live registry. Replaying every claimed message can repeat executed work. Scope disposal contains failures and cannot replace an explicit owner result. These alternatives cannot supply the required evidence.

## Consequences

A failed checkpoint leaves installation blocked. No driver or queued work is automatically restarted. The complete Host coordinator and native installation remain pending; the owner primitives do not authorize either operation alone.
