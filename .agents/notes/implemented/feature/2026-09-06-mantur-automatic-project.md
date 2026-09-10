# Agent Note: Mantur first-send projects and durable unassigned drafts

Status: implemented

English | [中文](2026-09-06-mantur-automatic-project.zh.md)

## Problem

Creators need to write before choosing a folder. Creating a project merely on page entry leaves empty projects, while retrying an interrupted first send can create duplicates or lose selected images and titled Skills. Browser-origin storage cannot identify the same draft after a desktop restart on another port.

## Decision

Mantur uses an explicit Workspace-selection policy and a resident unassigned editor. Typing, switching creation modes, choosing recommendations, and reading the location create no Host entity. First send durably reserves a UUID through [native draft checkpoints](../architecture/2026-09-06-desktop-draft-checkpoints.md), prepares its directory through [mantur-projects](../../../../packages/workspace/mantur-projects/README.md), and creates the deterministic Session through the ordinary controller. The [shared Workspace picker](../simplification/2026-07-31-one-route-to-add-a-workspace.md) remains the explicit path-adoption route; the standard Web composition retains current-or-recent selection.

The desktop supplies the OS-resolved Documents directory with a `漫途项目` child. Settings → General owns the default-location row through `settings.general.item`, using the same project store and native directory picker as first-send preparation. The durable root applies only to unreserved creations; changing it never moves existing projects. Cancelling the picker preserves the root. Read and save failures remain visible with Retry. The home footer contains only the existing project picker and preparation progress or errors; a missing root points to Settings → General. Exclusive directory creation never adopts existing content. An ambiguous ownership receipt or an externally removed directory causes a visible error; choosing an existing directory is a separate user action.

The conversation owner waits for native restoration of both editors, validates the originating preparation and selection immediately before publishing the transfer, and commits one checkpoint containing the populated target and cleared source. Full Lexical documents retain Chinese labels, reference identity, occurrence order, and selected image bytes. Selecting another conversation cancels the preparation; returning to the home page cannot revive it. A cancellation before publication retains the source. A cancellation or navigation during the write can leave a durably transferred target; it suppresses automatic opening and sending and reports where the unsent draft remains. Source clearing is not a prompt-delivery receipt.

After a confirmed transfer, the existing Session input submits normally. Preparation and storage locks are independently owned, so releasing one cannot reopen an editor still owned by the other. The [creation guide](2026-09-06-mantur-creation-guide.md) inserts into this resident editor without manufacturing a temporary Session; mode changes still change no Agent identity or permissions. Project directories and [transcript storage directories](../architecture/2026-07-24-project-session-directories.md) remain distinct concerns.

## Alternatives considered

**Create a project on entry.** Visiting or dismissing the home page would write directories without a submitted task.

**Keep a separate browser creation identity.** It can diverge from the native draft and disappear with the loopback origin. The durable draft owns its retry identity.

**Copy slash text or save the two owners separately.** Text loses titled references, and separate writes can lose or duplicate the draft. One checkpoint records both owners before in-memory movement.

**Roll back every cancelled operation.** A lost response cannot prove that the Host did not commit. Reusing the recorded identity and retaining an unsent target avoids deleting user data or pretending that a completed write was undone.

## Consequences

First send requires working native draft persistence. Storage errors, unsupported Windows publication, and missing desktop transport remain explicit failures, not browser-storage substitutions. A partially created directory may require manual selection. Ordinary Session admission and failure restoration remain the send owner; this feature does not promise exactly-once delivery across a crash after prompt admission.

## Verification

Host tests exercise concurrent retries, reloads, root changes, existing content, and removed or replaced directories. Client barriers cover identity persistence, both lock-release orders, pre-publication cancellation, lost save receipts, and navigation or cancellation during transfer. The real Mantur Loader browser scenario changes the root in General settings, substitutes cancellation and failures at the picker and save methods, and confirms persistence after reload. It then loses a successful project response, reloads the full Skill-and-image draft, and verifies one project, one Session, one prompt request, and one persisted user message after a double-click retry. Native installation, Windows durability, real credentials, and paid generation are outside this evidence.
