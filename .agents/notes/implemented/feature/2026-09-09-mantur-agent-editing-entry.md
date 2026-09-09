# Agent Note: Let the Agent open its editing workbench

Status: implemented

English | [中文](2026-09-09-mantur-agent-editing-entry.zh.md)

## Problem

The editing plugin registered native tools only after the Client opened its Remote. An Agent could not discover an entry to start editing when the user had not opened the panel.

## Decision

Register `open_editing_workbench` through the existing tool registry when the editing plugin starts. The tool has no Session, project or directory arguments. Its calling Agent selects the same runtime owner used by Remote opening; concurrent and repeated opens reuse that owner. `defineTool` is an ordinary runtime dependency because each call creates an independent tool definition; the tools service remains injected through `ctx`. A successful result means runtime and native MCP readiness. Project binding, draft creation, review, applied-state checks and saving remain on the editor’s original tools.

Successful results carry `sessionId`, `editorUrl` and `directory`. A single JSON text block is the native rendering; presentation metadata adds the fixed `mantur-editing-workspace` discriminator. The Host constructs the address from a validated local port, without credentials or query parameters. The bearer remains in the Host connection. Startup failures and cancellation produce ordinary tool errors; cancellation does not destroy an acquired Session runtime.

The Client owns visibility through its private conversation event projection. Observation starts when the resident edge button mounts. Only an observed pending-to-success transition of a live opening call can trigger the first automatic expansion. Native calls use result metadata; PTC dispatches use the named entry tool and its single JSON result block. History replay and switching Sessions do not trigger expansion. Manual collapse suppresses automatic expansion for later calls and turns in that Session. The user can still expand or collapse the panel manually; doing so does not restore automatic expansion. Hidden mounted pages keep the same tools and runtime. Mode selection does not change visibility. No general workbench framework, alternate editing channel or user MCP setup is introduced.

## Alternatives considered

**Register native editing tools only after a manual panel opening.** This leaves the Agent unable to start the requested workflow.

**Open on every editing call or on matching assistant text.** This overrides manual collapse or treats unverified prose as an action. Existing durable tool events identify the actual call and outcome.

## Consequences

Host regressions exercise discovery before opening, repeated tool and Remote opens sharing one owner, separate Agent scopes, startup errors, ownerless calls and cancellation. A scripted AgentLoop opens the runtime and calls the existing MCP transport; its entry metadata is checked in the persisted tool result. The keyless shipped-profile snapshot pins the opening schema and the native tool workflow.

These checks do not prove that a real model chose the correct edit. The installed-editor check uses explicit local fixture operations; its report separates opening, draft application, saved-project reads and hidden iframe execution from final Mantur Client interaction. The opening tool does not authorize overwrite, deletion, paid generation, export or publishing; existing confirmations remain in place.
