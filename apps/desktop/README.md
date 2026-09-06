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

Development uses the `mantur-agent-dev` user-data directory, while installed builds use `mantur-agent`; settings, sessions, credentials, and caches cannot cross between those modes. Electron's `app.isPackaged` check also keeps automatic update checks disabled in development. Run `pnpm run build:mantur` again when a change outside `apps/desktop` affects built Harness or Web artifacts.

`desktop:dev` does not create a DMG, ZIP, or NSIS installer, sign or notarize an application, install anything into the operating system's application directory, or check for releases. Use native packaging only to validate installation, signing, notarization, release updates, or a release candidate.

## Build an internal installer

Install the immutable dependency graph and build every host and client artifact with the Mantur title before invoking the native packager:

```sh
pnpm install --frozen-lockfile
pnpm run build:mantur
pnpm run desktop:dist:mac:arm64
pnpm run desktop:smoke
```

Run the x64 macOS command on an Intel Mac and the Windows command on x64 Windows. The manual `Desktop package` GitHub Actions workflow checks out one commit on three native runners, runs the packaged smoke, and retains these files for seven days:

| Runner | Command | Artifact |
|---|---|---|
| macOS arm64 | `pnpm run desktop:dist:mac:arm64` | `Mantur-Agent-macOS-arm64.dmg`, `Mantur-Agent-macOS-arm64.zip` |
| macOS x64 | `pnpm run desktop:dist:mac:x64` | `Mantur-Agent-macOS-x64.dmg`, `Mantur-Agent-macOS-x64.zip` |
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe` |

The smoke starts `dsh` from the unpacked application's own dependency directory, exchanges the printed process token for a session cookie, and requires the branded Web page to return HTTP 200. It also requires the packaged updater dependency and GitHub release configuration. It uses an empty temporary Harness home so developer data cannot make the package check pass or fail.

## Publish a signed macOS release

The manual `Desktop release` GitHub Actions workflow builds arm64 and x64 on native macOS runners. Both jobs sign the application with a Developer ID Application identity, submit it to Apple's notarization service, validate the signature, Gatekeeper assessment, and stapled ticket, and run the packaged smoke before their artifacts can be assembled.

Before public distribution, enable Release Immutability in the repository settings. Configure the `macos-release` GitHub environment with one variable and four encrypted secrets:

| Kind | Name | Value |
|---|---|---|
| Variable | `APPLE_TEAM_ID` | Apple Developer Team ID |
| Secret | `MACOS_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID Application certificate and private key |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | Password used to export the `.p12` |
| Secret | `APPLE_ID` | Apple ID used for notarization |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |

The workflow combines both native `latest-mac.yml` files into one architecture-aware update channel and retains the complete candidate plus `SHA256SUMS` for seven days. Run it from the exact `v<apps/desktop version>` tag; this semver-compatible tag lets electron-updater select prereleases from the GitHub feed. `publish=false` stops after assembling the candidate; `publish=true` creates a GitHub release with the DMGs, update ZIPs, blockmaps, update metadata, and hashes. The workflow refuses a tag that already owns a release instead of replacing published files; repository-level Release Immutability then prevents later tag or asset changes.

## Runtime design

The main process reuses Electron as the Node executable with `ELECTRON_RUN_AS_NODE=1` and launches the built `@deepseek-ai/dsh` entry with `--profile mantur --host 127.0.0.1 --port 0 --no-open`. The readiness parser accepts only a tokenized `127.0.0.1` URL. The renderer keeps Node integration disabled, enables context isolation and sandboxing, and sends navigation outside the local origin to the operating-system browser.

The installer carries the existing runtime dependency closure and built Web frontend. `asar` remains disabled because Loader profiles, plugin manifests, native modules, and subprocess helpers require ordinary files. Closing or restarting the application waits for the child process to terminate before Electron exits. A Node IPC channel connects the Electron parent and its child; feature owners validate their own messages.

The permanent application identifier is `ai.mantur.agent`. Before Electron becomes ready, the carrier sets a stable `mantur-agent` user-data directory below the operating system's application-data root. Its `harness` child directory is the only `DSH_HOME` used by the installed application, so ambient CLI or development data under `~/.dsh` cannot affect desktop startup. The child starts in an application-owned neutral directory and appends stdout, stderr, recovery, and updater diagnostics to `logs/harness.log` below the same user-data root.

If startup identifies only a stale `session_projcache` schema, the carrier closes the failed child process and its log before the localized native dialog can remove that disposable projection cache and retry after the user explicitly approves the action. It never deletes session logs, settings, credentials, profiles, or workspaces. Other startup failures offer the log and quit instead of guessing a repair.

Packaged applications show the current version and **Check for Updates…** in the native application menu on macOS and the Help menu on Windows. The menu reports checking, download progress, ready-to-install, up-to-date, and failed states; a manual check also opens a localized result or error dialog. Checks start after launch and repeat every six hours. Stable builds accept only stable releases, while versions containing `alpha`, `beta`, or `rc` can accept prereleases. A new version downloads only after user confirmation, and a downloaded version requests a second confirmation before restart preparation. Automatic installation is blocked because the Host does not yet expose a verified final task-log checkpoint; no task is stopped by this blocked path. Choosing Later leaves a restart-and-install action in the menu. Closing the updater while either prompt is pending suppresses the pending download or installation.

The same update controller runs on macOS Intel, macOS Apple Silicon, and Windows. macOS release updates require a signed and notarized application plus the generated ZIP and update metadata; the DMG remains the human installation artifact. Windows public updates require a code-signing identity, protected publication credentials, and the generated NSIS update assets; this repository does not supply or bypass those prerequisites.

## Draft checkpoints

<a id="draft-checkpoints"></a>

The sandboxed preload exposes only named draft read, save, and restart-preparation messages. The main process accepts them only from the current local main frame and writes complete checkpoints below `userData/drafts`, independently of the random loopback origin. Each checkpoint retains the full editor document, Skill reference identities, and the original bytes and SHA-256 digests of images already selected by the user. One revision covers every draft owner and both sides of an unassigned-to-Session transfer. A stale revision, incomplete attachment, storage error, or unresponsive renderer prevents restart preparation; cancellation releases input locks.

On macOS, the checkpoint file and its parent directories are synced before a save receipt is returned. Windows saves fail explicitly until a native durable publication path is implemented; Node does not provide the required directory fsync operation there. Restoration reads only the application checkpoint and, when present, the current origin's old text draft. Conflicting drafts are reported without scanning other browser origins or replacing their data. Unassigned-composer integration depends on the automatic-project feature and is not present in the current shipped profile.

## Known limitations

- The `Desktop package` artifacts remain unsigned internal installers. macOS Gatekeeper and Windows SmartScreen can warn for those files; use only the `Desktop release` artifacts for external macOS distribution.
- The native icon source is a 1024 px PNG with a white rounded tile and transparent outer corners. The Web client uses the transparent logo separately. macOS and Windows packages derive their platform icon formats during the native build; a vector source remains unavailable.
- The signed release workflow publishes macOS only. Windows external updates remain unsupported until a Windows code-signing identity and protected publication path exist.
- Each target is valid only after its native runner completes both packaging and the smoke. A build on one architecture is not evidence for another target.
