# Mantur asset provider

This plugin reads an explicitly selected Mantur pipeline report and keeps prompt drafts, Agent proposals, actual request fields, and media observations separate. Report writes are guarded by the source filesystem version and SHA-256 fingerprint. A pending journal is written before replacement so a caller can recover after interruption without guessing an asset-to-media binding.

The browser panel reads reports, scans an explicitly selected project-local candidate folder, previews validated image and video files, selects prompt rows, saves drafts, submits proposal requests, and displays persisted unfinished requests and writes. Candidate previews are review-only observations; they do not populate an empty report binding. Recovery is a Host operation; the panel has no recovery button. Recovery retries the recorded replacement only while the source version and hash still match, or completes history when the replacement bytes are already present. Conflicting source content remains untouched.

Journal updates retain the filesystem version observed before reading and use conditional writes. Candidate discovery is direct-child only, stays inside the selected project root, and previews verify the file signature before issuing a loopback URL. Concurrent calls through one LocalFileSystem instance are covered; cross-process writers and power-loss durability are not verified. Tests read an acceptance report from an external volume and modify private temporary copies; they require that local fixture.

## Model Experience

The model sees only the `propose_asset_prompts` tool. The tool records a text proposal for a request and never generates media or changes a pipeline report. Applying a proposal remains an explicit Host operation.
