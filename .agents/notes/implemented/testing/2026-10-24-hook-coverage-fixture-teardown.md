# Agent Note: Dispose hook coverage contexts before removing scripts

Status: implemented

English | [中文](2026-10-24-hook-coverage-fixture-teardown.zh.md)

## Problem

The Claude Code and Codex hook coverage fixtures create root Contexts and executable scripts in private temporary directories. Agent idle and script-created markers do not prove that detached hooks or their processes have finished. Removing scripts without disposing their owners permits late execution against deleted files and retains process-exit listeners.

## Decision

The [shared fixture owner](../../../../packages/hooks/hook-protocol/tests/coverage-fixture.ts) registers each Context immediately after construction. Both coverage matrices stop registered hook bridge fibers, stop command scopes, dispose the registered AgentLoop fiber, and then dispose the root before removing any owned script directory. The agent owner cancels and joins its own live agents and flushes their writers while persistence remains mounted. The fixture does not traverse the public agent registry, which can include test stubs, or invoke Host shutdown APIs, which require durable writers that in-memory fixtures do not have. Cleanup attempts every registered root. Cordis logs effect failures instead of rejecting disposal, so the fixture temporarily observes each root logger's error method, forwards its original behavior, and restores the exact property after all roots settle. Logged failures and direct rejections preserve directories and reject cleanup; a logger failure is also reported after the other effects finish. Failure records persist across later cleanup calls because single-shot effects cannot prove recovery by disappearing. Existing hook, command-scope and subprocess disposers retain responsibility for cancellation and process-tree quiescence; runtime implementations are unchanged.

Real subprocess cases, their detached-completion predicates, and afterEach share a local 15-second budget or the higher `DSH_COVERAGE_TEST_TIMEOUT_MS` lane budget. Pure configuration and no-spawn cases retain runner defaults. A normal, unsignaled hook completion took 5.754 seconds in diagnosis, independently showing that five seconds cannot cover every observed launch. Fifteen seconds is an engineering allowance for launch, sequential commands, and cleanup, not an operating-system latency bound. Existing hook and shell execution deadlines remain unchanged.

## Alternatives considered

**Dispose only agent handles after successful assertions.** This omits root-owned bridge and subprocess services and does not cover failed assertions or partially installed fixtures.

**Delete directories after a marker or agent idle.** A marker can precede script exit, and detached hook continuations can outlive the agent turn. Neither observation joins the owning effects.

**Increase the timeout as a cleanup fix.** A larger time budget does not dispose Contexts or establish deletion order. Timing diagnostics separately observe substantial delay before fixture script entry; this lifecycle correction does not claim to resolve that startup cost or establish that five seconds is sufficient under aggregate coverage.

**Register the error observer as a root effect.** Root effects unload concurrently, so the observer could disappear before another disposer reports a failure. The fixture owns the observer through an outer finally instead.

## Consequences

Coverage fixture cleanup includes cancellation and asynchronous teardown. A barrier regression prevents directory deletion while a Context effect remains pending; removing Context disposal makes it fail. Real synchronous and asynchronous effect failures verify original-error propagation, directory retention, waiting for another root and exact logger restoration. Separate assertions cover independent-root isolation and a logger failure without interrupting other effects. A real subprocess regression verifies child disappearance, host-exit listener removal and directory deletion after a body exception. A real writer-flush barrier proves root disposal cannot close persistence before the agent owner finishes; reversing that order fails the assertion without changing deadlines. In-memory agents, including already-disposed handles, exercise ordinary owner disposal. The real hook commands and assertions remain intact. Targeted budget observations cover the default lane and a 90-second lane, including teardown and detached predicates. Full aggregate coverage and platform timing remain separate verification obligations.
