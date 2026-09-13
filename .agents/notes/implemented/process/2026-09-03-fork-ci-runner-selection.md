# Agent Note: Select standard hosted runners for the Mantur fork

Status: implemented

English | [中文](2026-09-03-fork-ci-runner-selection.zh.md)

## Problem

The pull-request workflow names larger-runner labels owned by the upstream DeepSeek organization. The public `mantur-ai/mantur-agent` fork has no registered runner with those labels, so its Linux and native Windows jobs remain queued without starting a step.

The Cloudflare preview workflow also depends on an upstream Pages project, deployment token, and Access service credentials. The Mantur fork does not own that external infrastructure, but its product checks must remain complete and visible.

## Decision

The pull-request workflow selects runners from `github.repository` before GitHub allocates each job. The three high-capacity Linux jobs use `ubuntu-24.04` and the four native Windows jobs use `windows-2025` in `mantur-ai/mantur-agent`. The jobs keep their commands, blocking status, and aggregate dependencies.

The fork profile limits compiler-heavy gate fan-out to two, runs two single-worker coverage partitions without overlapping the exempt suite, and caps lint, publint, recorded-session, and browser workers at two. The Windows build pair runs serially, Windows coverage uses the same two-partition serial profile, and the observational aggregate runs two gates at a time. These limits match the four-core hosted allocation while leaving every check in place.

`deepseek-ai/deepseek-harness` retains its larger-runner labels and its existing repository-variable failover paths. The fork-specific condition takes precedence only in the Mantur repository.

The Cloudflare preview job runs only in `deepseek-ai/deepseek-harness`. A Mantur pull request reports that job as skipped because no fork deployment is configured. Product build, coverage, snapshots, artifacts, Wine checks, and native Windows checks remain owned by `ci.yml`; the missing external preview is not presented as product validation.

`scripts/ci-workflow.spec.ts` pins both repository branches of the runner selectors, verifies that every critical job remains pull-request reachable, and pins the upstream-only preview condition.

## Alternatives considered

**Register copies of the upstream larger runners in the fork.** Rejected because it would make ordinary pull-request validation depend on private organization infrastructure and duplicate runner operations.

**Skip the jobs that require unavailable labels.** Rejected because a skipped build, coverage, snapshot, or native Windows check would turn missing infrastructure into a false-green product signal.

**Maintain separate fork workflow files.** Rejected because duplicated job bodies would drift during upstream synchronization. Repository selection changes only runner allocation and preserves one shared check definition.

## Consequences

Mantur pull requests can execute every critical check on GitHub-hosted runners, at the cost of lower concurrency and longer completion times. Upstream pull requests keep their optimized pools, concurrency settings, and failover controls.

The Mantur fork does not publish Cloudflare PR previews. Its preview job settles explicitly as skipped, while required product evidence continues through the shared CI workflow.
