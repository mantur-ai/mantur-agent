# Mantur asset provider

This plugin reads an explicitly selected Mantur pipeline report and keeps prompt drafts, Agent proposals, actual request fields, and media observations separate. Report writes are guarded by the source filesystem version and SHA-256 fingerprint. A pending journal is written before replacement so a caller can recover after interruption without guessing an asset-to-media binding.

The browser face is intentionally an empty registration until the shared workbench asset slot is available in the assembled profile. The Host face is independently testable and is the production source of truth for readback and guarded writes.

## Model Experience

The model sees only the `propose_asset_prompts` tool. The tool records a text proposal for a request and never generates media or changes a pipeline report. Applying a proposal remains an explicit Host operation.
