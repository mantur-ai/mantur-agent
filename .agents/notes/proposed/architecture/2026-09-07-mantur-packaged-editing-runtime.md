# Agent Note: Package the Mantur editing runtime

Status: proposed

English | [中文](2026-09-07-mantur-packaged-editing-runtime.zh.md)

## Problem

The [local workbench](../../implemented/feature/2026-09-06-mantur-local-editing-workbench.md) depends on an external checkout and Node path. A branded installer does not contain a usable editor merely because its plugin code is installed. The integration must distinguish a production runtime from a development preview without changing Session storage or the editing protocol.

## Proposal

Package the existing OpenChatCut production frontend and embedded server, applying the fixed Mantur patch and a separate host-integration patch in order. Desktop supplies its read-only resource root and Electron executable to the shipped profile. Packaged mode requires a target-specific manifest; development remains an explicit configuration. The child uses Electron's Node mode rather than an independently downloaded Node distribution.

The resource manifest uses formatVersion 1, platform and arch, build-owned source identities, and relative paths named server, web, remotionBundle, browserExecutable, ffmpeg, ffprobe, compositor, whisperCli and whisperServer. The server exports startEmbeddedServer with explicit Mantur port-zero and parent-origin options. The web directory contains index.html and mantur-theme.mjs. Every referenced resource must exist inside the package. Build preparation owns hashes, the exact production dependency closure and notices; the runtime does not fetch missing resources.

The child sets OPENCHATCUT_WHISPER_CLI to the verified CLI path. Upstream native ASR locates whisper-server(.exe) beside that CLI, so the manifest must declare that same sibling file. The Mantur iframe does not expose the upstream desktop inference preload; packaging these programs does not enable or verify native transcription. Connecting native inference requires separate implementation and acceptance, not a substituted provider.

The Host starts the editor only for an opened Session. Durable project, media and export paths retain their existing owners. A private directory under the Session's engine directory holds temporary files, the writable Remotion bundle and compositor copies. The package itself receives no runtime writes. Readiness uses the existing Host IPC message; stop requests wait for HTTP closure and child close. This does not establish safe update ownership for arbitrary detached descendants.

## Alternatives considered

**Copying the development checkout and node_modules.** This includes development tooling and machine-specific paths and does not identify the production dependency closure or native target.

**Using the local Vite server in an installer.** Development serving changes runtime dependencies and permits writes to a source tree. The existing upstream embedded production server owns the same HTTP middleware without Vite serving.

**Downloading missing runtime files on first use.** This hides an incomplete package and adds unverified network-dependent behavior. Missing resources must reject startup.

## Acceptance criteria

Each supported native package must load its Node-side modules, start the actual embedded editor, retain project writes outside package resources, connect scoped MCP tools, render a controlled video and stop all owned processes. Invalid target identities, missing resources and escaped paths must fail before creating Session state. Existing keyless editing workflow and native account entry behavior must remain valid. Fixed artifact hashes and license/source materials must accompany the candidate.

## Risks

The current implementation and IPC fixture checks do not constitute a complete package or native export acceptance. macOS arm64, macOS x64 and Windows x64 each require their own native dependency and packaged runtime evidence. CMake is required to build the pinned macOS Whisper programs; the production dependency audit also has unresolved high-severity findings. Distribution permissions and source obligations remain release prerequisites. Active export cancellation, dynamically added owners and detached descendants remain separate safe-update limitations; successful idle HTTP closure does not authorize installation.
