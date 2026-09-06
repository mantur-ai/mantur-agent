# Agent Note: Shutdown admission and writer checkpoints

Status: implemented

English | [中文](2026-09-07-agent-shutdown-writers.zh.md)

## Problem

Registry removal does not prove pending setup has ended or a writer closed successfully. A driver can also hold input outside its queue before execution begins. Installation must not infer durable quiescence from these partial observations.

## Decision

Host shutdown needs explicit owner operations before it can authorize installation. The agent registry freezes new agents and every live inbox. The loop retains a claimed batch until its step opening is committed; stopping before that point restores the original message identities and queue order once. Completed or uncertain execution is not replayed.

The factory joins raw setup and persistence acquisitions even when their public requests have already rejected cancellation. Abandoned handles remain tracked through close. Writer close failures survive removal from the live registries. Each session seals its append admission before writer close, and the factory verifies the seal again after tracked operations finish; a caught late append cannot produce a valid writer result. Successful results carry exclusive final offsets for closed writer lifetimes.

The local subprocess owner separately closes spawn admission and joins whole process trees and PTYs, retaining failed ownership. These operations do not cancel remote paid jobs. They do not constitute a global Host receipt: Cordis contains scope disposer errors, and other producer owners must supply independent successful results. The desktop installer remains blocked until that coordination exists.

## Upstream ownership

Existing observer hooks cannot freeze direct inbox mutation, recover a claim held inside the driver, seal direct Session append, or retain a writer after the factory releases it. The changes therefore belong in `packages/core/agent/src/{index,inbox}.ts`, `packages/core/agent-loop/src/{index,agent}.ts`, `packages/core/session/src/index.ts`, and `packages/subprocess/subprocess-local/src/index.ts`. No vendored Cordis behavior changes. The factory retains closed session objects until its lifetime ends so it can detect post-close writes; that retention is the cost of verifying previously closed writers.

## Verification

Controlled tests reject late agent publication, preserve unexecuted input, block direct inbox producers, join cancelled setup and abandoned writer cleanup, retain close failures, and reject writes after sealing. Real JSONL reads compare the final stored event list with the returned offset. The same owner regressions are the upgrade checks for these upstream files. Native installation and complete Host producer verification remain separate acceptance requirements.

## Alternatives considered

Global flush misses writers that have already left the live registry. Replaying every claimed message can repeat executed work. Scope disposal contains failures and cannot replace an explicit owner result. These alternatives cannot supply the required evidence.

## Consequences

A failed checkpoint leaves installation blocked. No driver or queued work is automatically restarted. The complete Host coordinator and native installation remain pending; the owner primitives do not authorize either operation alone.
