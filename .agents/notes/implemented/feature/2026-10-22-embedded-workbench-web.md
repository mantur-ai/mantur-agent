# Agent Note: Local skill pages beside the conversation

Status: implemented

English | [中文](2026-10-22-embedded-workbench-web.zh.md)

## Problem

The automatic drama production skill exposes its workbench as a local web service. Users need to review that page beside their conversation. Its frame restrictions prevent embedding it in an iframe, and an external browser separates the workbench from the conversation.

## Decision

The [script workbench shell](../../../../packages/client/ui-mantur-script/README.md) provides a Web tab with manual URL entry. The `open_web_page` tool records a local page request through the existing Session tool pipeline; the client reacts to successful live results without replaying historical opens. The tool requests presentation and does not start the skill service or establish that a page has loaded.

The [desktop carrier](../../../../apps/desktop/README.md) owns an isolated `WebContentsView`. Accepted addresses use HTTP, the literal host `127.0.0.1`, and an explicit port. The application origin is excluded. The native view has no preload or Node access and uses sandboxing, context isolation and a separate in-memory browser session. Main accepts IPC only from the trusted application main frame, confines navigation to the opened origin, and denies permissions, downloads and popups. The skill's CSP and frame restrictions remain intact.

The view occupies the existing right-hand workbench region. Switching tabs or hiding the panel hides the native view without stopping the skill's service. Ordinary browser deployments report the missing desktop capability. Skill identity, installed skill content, account storage and conversation drafts do not participate in page opening.

This extends the [shared script workbench](2026-09-09-script-workbench.md). The [editing runtime](2026-09-06-mantur-local-editing-workbench.md) and [layout retention](../bug-fix/2026-09-07-hide-editing-workbench.md) retain their separate ownership; the web view does not replace their runtime or draft lifecycle. No agent-loop change is required.

## Alternatives considered

**Embed the skill page in an iframe.** The page rejects framing. Removing its security headers changes the skill server's policy and is not required for a native browser view.

**Open an external browser or separate application window.** Both separate the page from the conversation instead of providing the requested right-hand tab.

## Consequences

The desktop can display the local production workbench while the conversation remains visible. Native isolation keeps the loaded page outside the application preload and browser session. The feature is deliberately limited to local HTTP services; arbitrary public websites and ordinary browser deployments are unsupported.

A successful tool result represents a presentation request, not completed production or successful navigation. The UI reports page-opening failures separately. Hiding a view is not service shutdown; the skill retains ownership of its server and production jobs.

The editing tab remains visible when the optional editing provider is absent. Selecting it reports that the matching Mantur Cut runtime must be configured; the shell does not imitate an editor. Development desktop launches still require explicit validated resource paths, while packaged launches supply their bundled resources.
