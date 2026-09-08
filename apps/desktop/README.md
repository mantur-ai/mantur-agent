# Mantur Agent desktop

English | [中文](README.zh.md)

The desktop application is 漫途Agent, built by Mantur to create and produce comic dramas locally. Electron owns the native window and one child process; the child starts the shipped `dsh --profile mantur` application on a random loopback port. Development and packaged applications use the approved blue infinity-loop logo for the native window, macOS Dock, About panel, and installer assets. The desktop package does not implement another agent runtime.

## Develop without packaging

After `pnpm install`, build the repository artifacts once on a clean checkout:

```sh
pnpm run build:mantur
```

Use one command for ordinary desktop work after that initial build:

```sh
pnpm run desktop:dev
```

The command watches desktop TypeScript, resources, and build configuration. Each change runs an incremental desktop TypeScript build, bundles the Electron main process, stops the previous Electron and dsh processes, and starts the development application again. dsh stdout and stderr remain in the persistent Harness log and also appear directly in the terminal.

By default, development uses the `mantur-agent-dev` user-data directory, while installed builds use `mantur-agent`; their settings, sessions, credentials, and caches remain separate. Electron's `app.isPackaged` check also keeps automatic update checks disabled in development. Run `pnpm run build:mantur` again when a change outside `apps/desktop` affects built Harness or Web artifacts.

For an explicitly configured local profile, pass Electron's `--user-data-dir=/absolute/directory` launch argument. The desktop selects that directory for both `userData` and `sessionData`, including browser cookies and caches, and derives `DSH_HOME` from its `harness` child. Different directories keep profiles separate; selecting the same directory shares their data. The directory is created when absent. Empty, relative, NUL-containing, filesystem-root, or unusable paths stop startup before account, draft, or Harness initialization; no failure switches to the default directory. This option does not search for, migrate, or copy accounts, keys, or existing profiles. Changing `HOME` alone is not a desktop isolation mechanism.

`desktop:dev` does not create a DMG, ZIP, or NSIS installer, sign or notarize an application, install anything into the operating system's application directory, or check for releases. Use native packaging only to validate installation, signing, notarization, release updates, or a release candidate.

## Build an internal installer

Install the immutable dependency graph and build every host and client artifact with the Mantur title before invoking the native packager. macOS builders require the Xcode Command Line Tools compiler because the pinned whisper.cpp source has no upstream macOS release binary. The resource builder downloads the pinned official CMake archive into `.cache/mantur-cut/tools`, verifies its SHA-256 digest, and does not install it globally:

```sh
pnpm install --frozen-lockfile
pnpm run build:mantur
pnpm run desktop:dist:mac:arm64
pnpm run desktop:smoke
```

Each `desktop:dist:*` command first prepares the matching Mantur Cut resource tree from pinned OpenChatCut and whisper.cpp commits. It verifies the base, packaged-runtime and shutdown patch digests and resulting Git trees, package-lock integrities, downloaded archive hashes, and the requested native target. Source configuration and runtime manifests require format version 2; older two-layer resources are rejected. The manifest records all three patch digests and the final shutdown-patched tree. The package carries the embedded server, built editor, Remotion bundle and compositor, Chrome Headless Shell, FFmpeg, ffprobe, Whisper CLI and server, exact source records including all three patches, retained license files, and a production dependency audit. No packaged runtime downloads a missing executable or falls back to a developer checkout.

Chrome for Testing download URLs place the version in the directory and use `chrome-headless-shell-<platform>.zip` as the archive name. Local cache filenames additionally contain the pinned version.

The macOS commands let electron-builder sign and produce the update ZIP, then create the DMG with Apple's `hdiutil`. A temporary unique volume name prevents collisions with an installed or mounted copy of the application; the finished image restores the `漫途Agent` volume name, adds an Applications shortcut, and receives a separate update blockmap. The mountpoint uses a unique directory under macOS `getconf DARWIN_USER_TEMP_DIR`, while image files stay under the build output directory; failure to resolve or create the mountpoint stops packaging.

Run the x64 macOS command on an Intel Mac and the Windows command on x64 Windows. The manual `Desktop package` GitHub Actions workflow checks out one commit on three native runners, runs the packaged smoke, and retains these files for seven days:

| Runner | Command | Artifact |
|---|---|---|
| macOS arm64 | `pnpm run desktop:dist:mac:arm64` | `Mantur-Agent-macOS-arm64.dmg`, `Mantur-Agent-macOS-arm64.zip` |
| macOS x64 | `pnpm run desktop:dist:mac:x64` | `Mantur-Agent-macOS-x64.dmg`, `Mantur-Agent-macOS-x64.zip` |
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe` |

The smoke starts `dsh` from the unpacked application's own dependency directory, exchanges the printed process token for a session cookie, and requires the branded Web page to return HTTP 200. It also validates every Mantur Cut manifest path, starts the packaged Whisper CLI and server with `--help`, requires the source, license, build, and security records, and checks the updater dependency and GitHub release configuration. It uses an empty temporary Harness home so developer data cannot make the package check pass or fail.

## Publish a signed macOS release

The manual `Desktop release` GitHub Actions workflow builds arm64 and x64 on native macOS runners. Both jobs sign the application with a Developer ID Application identity, submit it to Apple's notarization service, validate the signature, Gatekeeper assessment, and stapled ticket, and run the packaged smoke before their artifacts can be assembled.

Before public distribution, enable Release Immutability in the repository settings. Configure the `macos-release` GitHub environment with two variables and four encrypted secrets:

| Kind | Name | Value |
|---|---|---|
| Variable | `APPLE_TEAM_ID` | Apple Developer Team ID |
| Variable | `MANTUR_CUT_DISTRIBUTION_APPROVAL` | `approved:<source-config-sha256>` after review of those exact source, patch, binary, dependency, audit, source-delivery, and license pins |
| Secret | `MACOS_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID Application certificate and private key |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | Password used to export the `.p12` |
| Secret | `APPLE_ID` | Apple ID used for notarization |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |

The workflow combines both native `latest-mac.yml` files into one architecture-aware update channel and retains the complete candidate plus `SHA256SUMS` for seven days. Run it from the exact `v<apps/desktop version>` tag; this semver-compatible tag lets electron-updater select prereleases from the GitHub feed. `publish=false` stops after assembling the candidate. `publish=true` additionally requires the approval variable to name the SHA-256 digest of the complete pinned source configuration before it creates a GitHub release with the DMGs, update ZIPs, blockmaps, update metadata, and hashes. The workflow refuses a tag that already owns a release instead of replacing published files; repository-level Release Immutability then prevents later tag or asset changes.

## Runtime design

The main process reuses Electron as the Node executable with `ELECTRON_RUN_AS_NODE=1` and launches the built `@deepseek-ai/dsh` entry with `--profile mantur --host 127.0.0.1 --port 0 --no-open`. The readiness parser accepts only a tokenized `127.0.0.1` URL. The renderer keeps Node integration disabled, enables context isolation and sandboxing, and sends navigation outside the local origin to the operating-system browser.

The installer carries the existing runtime dependency closure and built Web frontend. `asar` remains disabled because Loader profiles, plugin manifests, native modules, and subprocess helpers require ordinary files. Closing or restarting the application waits for the child process to terminate before Electron exits. A Node IPC channel connects the Electron parent and its child; feature owners validate their own messages.

Packaged Main supplies `resources/mantur-cut` and its own executable to the Mantur editing profile. The editor runs in Electron's Node mode on first workbench open, not in a second Electron window. The package must contain the declared production server, static frontend and target rendering binaries; an incomplete editor package fails explicitly. Development does not inherit this packaged selection. See the [editing runtime](../../packages/client/ui-mantur-editing/README.md) for Session-owned writable paths and the remaining distribution checks.

Main owns the OS-encrypted native account store and validates account operations from the current local main frame. The desktop launch selects the Mantur provider's `desktop-managed` identity explicitly. Host API responses stream through a per-request loopback broker; Main alone sends the device bearer upstream. A command descriptor remains private until its consumer acknowledges whole-tree cleanup. Logout cancels accepted streams and commands but retains encrypted remote-cleanup records until HTTP 204 or original expiry.

The permanent application identifier is `ai.mantur.agent`. Before Electron becomes ready, the carrier sets a stable `mantur-agent` user-data directory below the operating system's application-data root. Its `harness` child directory is the only `DSH_HOME` used by the installed application, so ambient CLI or development data under `~/.dsh` cannot affect desktop startup. The child starts in an application-owned neutral directory and appends stdout, stderr, recovery, and updater diagnostics to `logs/harness.log` below the same user-data root.

If startup identifies only a stale `session_projcache` schema, the carrier closes the failed child process and its log before the localized native dialog can remove that disposable projection cache and retry after the user explicitly approves the action. It never deletes session logs, settings, credentials, profiles, or workspaces. Other startup failures offer the log and quit instead of guessing a repair.

Packaged applications show the current version and **Check for Updates…** in the native application menu on macOS and the Help menu on Windows. The menu reports checking, download progress, ready-to-install, up-to-date, and failed states; a manual check also opens a localized result or error dialog. Checks start after launch and repeat every six hours. Stable builds accept only stable releases, while versions containing `alpha`, `beta`, or `rc` can accept prereleases. Background discovery remains silent. The Mantur sidebar displays an update entry above Settings in expanded and collapsed modes; it has no persistent idle or up-to-date card. An explicit download click starts the transfer, with actual byte counts and percentage only when known. A downloaded and verified version requests confirmation before restart preparation. Confirmed installation saves native drafts, requests the Host shutdown receipt over the owned IPC channel, then closes the account channel and asks the Host to exit normally. Main waits for actual process exit and diagnostic-log closure before invoking the installer. Unsupported Host compositions, failed saves, cancellation, abnormal exit, and deadlines block installation; checking and downloading do not freeze work. Host cleanup may continue after a failed wait and does not automatically resume work. See the [Host update policy](../../packages/bundle/mantur-app/README.md#use-this-package). Choosing Later leaves the restart-and-install action available without repeating the dialog. Sidebar and native menu actions share main-process confirmation; a failed save retains the verified download and reports the error. Closing the updater suppresses pending installation.

The same update controller runs on macOS Intel, macOS Apple Silicon, and Windows. macOS release updates require a signed and notarized application plus the generated ZIP and update metadata; the DMG remains the human installation artifact. Windows public updates require a code-signing identity, protected publication credentials, and the generated NSIS update assets; this repository does not supply or bypass those prerequisites.

## Draft checkpoints

<a id="draft-checkpoints"></a>

The sandboxed preload exposes only named draft read, save, restart-preparation, and update-state/action messages. The main process accepts them only from the current local main frame and writes complete checkpoints below `userData/drafts`, independently of the random loopback origin. Each checkpoint retains the full editor document, Skill reference identities, and the original bytes and SHA-256 digests of images already selected by the user. One revision covers every draft owner and both sides of an unassigned-to-Session transfer. A stale revision, incomplete attachment, storage error, or unresponsive renderer prevents restart preparation; cancellation releases input locks.

On macOS, the checkpoint file and its parent directories are synced before a save receipt is returned. Windows saves fail explicitly until a native durable publication path is implemented; Node does not provide the required directory fsync operation there. Restoration reads only the application checkpoint and, when present, the current origin's old text draft. Conflicting drafts are reported without scanning other browser origins or replacing their data. The Mantur profile attaches the unassigned composer to this checkpoint before enabling first-send preparation.

The carrier passes `app.getPath('documents')` with a `漫途项目` child to the Host as `DSH_MANTUR_PROJECTS_ROOT`. This value names the default root, not an eagerly created directory. The [project owner](../../packages/workspace/mantur-projects/README.md) persists explicit location changes and creates a child only on first send.

## Known limitations

- Packaging and starting the Whisper executables proves that their native files and adjacent libraries load on the target; it does not make local transcription available in the embedded workbench. The Mantur iframe does not yet install OpenChatCut's desktop inference preload, so the editor's native-ASR adapter currently returns unavailable.
- A built internal installer is not distribution approval. OpenChatCut's AGPL source-delivery obligations, Remotion's entity and use terms, FFmpeg and ffprobe GPL/LGPL obligations, retained notices, binary redistribution terms, and every production audit finding require review for the exact patched tree before public release.
- Native account Main, preload, provider, forms and Bash/PowerShell/PTY consumers are connected in source. Forms expose registration, browser authorization, persisted Skip and exact expiry without publishing the device bearer. Marketplace login routing, packaged CLI invocation and native OS acceptance remain incomplete. Loopback IPC, simulated-preload browser and fixed-CLI tests do not establish complete native login availability; the [integration proposal](../../.agents/notes/proposed/architecture/2026-09-07-desktop-native-account-identity.md) owns the remaining acceptance conditions.
- The `Desktop package` artifacts remain unsigned internal installers. macOS Gatekeeper and Windows SmartScreen can warn for those files; use only the `Desktop release` artifacts for external macOS distribution.
- The native icon source is a 1024 px PNG with a white rounded tile and transparent outer corners. The Web client uses the transparent logo separately. macOS and Windows packages derive their platform icon formats during the native build; a vector source remains unavailable.
- The signed release workflow publishes macOS only. Windows external updates remain unsupported until a Windows code-signing identity and protected publication path exist.
- Each target is valid only after its native runner completes both packaging and the smoke. A build on one architecture is not evidence for another target.
