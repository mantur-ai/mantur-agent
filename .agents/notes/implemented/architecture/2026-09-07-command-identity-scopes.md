# Agent Note: Command identity and complete process cleanup

Status: implemented

English | [中文](2026-09-07-command-identity-scopes.zh.md)

## Problem

Desktop-managed command authority must be prepared asynchronously without publishing a process that does not exist. A direct child can exit while descendants still use its authority. Releasing a descriptor at direct-child exit or treating abort dispatch as completed cleanup can leave live work outside account logout and shutdown ownership.

## Decision

[command-scopes](../../../../packages/shell/command-scopes/README.md) records admission before identity preparation and owns the complete allocation and cleanup interval. The subprocess primitive remains synchronous for ordinary process creation. Shell background starts return asynchronously, while job hooks synchronously own that pending start and its cancellation. No placeholder PID or process handle is published.

The subprocess provider proves complete tree or terminal exit before the identity provider releases authority. A process exposes direct-child completion separately from complete cleanup. Cancellation remains attached while descendants outlive the direct child. Failed cleanup remains recorded and makes shutdown reject. Main treats a close-scope receipt as completed consumer cleanup, not as a new cancellation request.

Shutdown freezes admission synchronously before awaiting accepted work. Late identity leases and terminal allocations are cleaned up before canceled starts reject. Persistent terminals retain one identity lease across sends until session cleanup. Protocol subprocesses retain their protocol owner's lifecycle.

## Alternatives considered

**Make all subprocess creation asynchronous.** Protocol consumers do not need command identity. Changing the primitive would spread asynchronous allocation across unrelated LSP and subagent transports.

**Publish a placeholder handle while identity is prepared.** A fabricated PID or completion receipt cannot prove real OS process ownership and can let cancellation race a late allocation.

**Release authority when the direct child exits.** Descendants may remain alive. The command must join the provider's entire process tree before releasing its identity.

## Consequences

Shell consumers await start and complete cleanup; their job hooks cover pending preparation. A canceled preparation reports a killed job only when the executor returns the consumer's exact cancellation reason after cleanup. Other preparation failures and every cleanup failure report failed jobs, while commandScopes retains the cleanup failure independently for shutdown. Identity cancellation participates in first-cause timeout classification, including when cleanup outlasts a later deadline. Required identity fails admission when no provider registers; it never switches to standalone credentials.

Ownership tests cover late leases, late terminals, failed tree checks, failed release, and actual POSIX descendants. Main-to-Loader integration exercises actual Bash, a frozen CLI and persistent terminals against loopback account endpoints. Native forms, packaged CLI delivery, production endpoints and operating-system credential acceptance are separate requirements.
