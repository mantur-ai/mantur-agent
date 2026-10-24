# Agent Note: Exact config watches wait for Darwin native startup

Status: implemented

English | [中文](2026-10-24-hmr-native-startup-barrier.zh.md)

## Problem

An exact config registration can return before macOS starts its native event stream. A caller can then create the watched file once and receive no refresh. Chokidar readiness covers its scan and watcher creation calls; libuv schedules Darwin FSEvents stream creation on another thread with `SinceNow`, so a change published before stream creation can be lost. The same window exists when reopening a deleted path or observing a missing parent.

## Decision

[HMR](../../../../vendor/hmr/src/index.ts) waits for Chokidar readiness, then opens and closes one temporary native directory watcher on Darwin when the effective watcher options disable polling. libuv's directory-handle close waits for the shared FSEvents stream to be rescheduled with the surviving exact watcher. Registration returns after that close completes; temporary native watcher creation or close failure follows the existing registration cleanup and rejection path. The operation writes no files and does not change polling, refresh queues, or time budgets.

This platform workaround belongs to the vendored HMR owner because an app-boot wrapper cannot repair `registerConfig()` readiness for its other callers. The affected upstream source and divergence are recorded in [the vendor log](../../../../vendor/README.md). [Transactional reload](2026-07-20-config-hot-reload-resilience.md) and [initial-scan suppression](2026-08-03-hmr-initial-scan-boot-deadlock.md) retain their separate ownership.

## Alternatives considered

**Sleep, repeated writes, or polling overrides.** These change scheduling or observation mode without establishing native readiness. A single caller write remains the acceptance condition.

**Read the file once more after Chokidar readiness.** A read still leaves a window before the native stream starts. It cannot cover a later caller write in that window.

**Synchronize only the test writer.** This would weaken the API's ready-before-return promise. The startup synchronization belongs inside registration.

## Consequences

Darwin native registrations incur one extra directory handle and stream reschedule. The workaround relies on libuv's FSEvents close synchronization, not a Node public guarantee about other watchers; Node/libuv upgrades require a controlled startup-race replay. It does not promise lossless delivery during unrelated later stream rebuilds or replace operating-system event semantics.

The controlled macOS experiment pauses the real `FSEventStreamCreate` before `SinceNow` is sampled. An independent process confirms publication of the single target write before releasing that pause. The original HMR returns early and misses the write; the synchronized registration waits at native close and receives the caller's write after returning. Historical failures lack native stage records, so this demonstrated mechanism does not establish each historical invocation's precise cause.

The [exact-watch tests](../../../../packages/boot/app-boot/tests/hmr-config.spec.ts) retain native add/change/unlink and missing-parent cases, and pin close completion and startup rejection. The [patch tests](../../../../packages/boot/app-boot/tests/user-patches.spec.ts) observe real Include update settlement; the [transaction barrier](../../../../packages/boot/app-boot/tests/transaction-barrier.spec.ts) proves disposal waits for an unfinished real plugin application and a new generation completes independently. Removing the drain makes that barrier fail. No model text, session event, SDK behavior, or transcript format changes; these filesystem and lifecycle assertions own the regression rather than a recorded model response.
