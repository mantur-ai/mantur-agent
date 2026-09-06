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
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe`, its blockmap, `latest.yml` |

The smoke starts `dsh` from the unpacked application's own dependency directory, exchanges the printed process token for a session cookie, and requires the branded Web page to return HTTP 200. It also requires the packaged updater dependency and GitHub release configuration. It uses an empty temporary Harness home so developer data cannot make the package check pass or fail.

## Publish a signed desktop release

The manual `Desktop release` GitHub Actions workflow builds macOS arm64, macOS x64, and Windows x64 on native hosted runners. The macOS jobs sign with a Developer ID Application identity, submit to Apple's notarization service, and validate the signature, Gatekeeper assessment, and stapled ticket. The Windows job signs the unpacked application and NSIS installer, then requires valid Authenticode signatures from the configured certificate thumbprint with timestamps. Every target runs the packaged smoke before assembly.

Before public distribution, enable Release Immutability in the repository settings. Configure the `macos-release` GitHub environment with one variable and four encrypted secrets:

| Kind | Name | Value |
|---|---|---|
| Variable | `APPLE_TEAM_ID` | Apple Developer Team ID |
| Secret | `MACOS_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID Application certificate and private key |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | Password used to export the `.p12` |
| Secret | `APPLE_ID` | Apple ID used for notarization |
| Secret | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |

Configure the `windows-release` GitHub environment with one variable and two encrypted secrets. This workflow requires an exportable code-signing PFX that contains its private key; it does not support a non-exportable USB token, HSM, or Azure Trusted Signing configuration. Select and implement the matching electron-builder signing backend after the repository owner identifies one of those alternatives. The workflow does not obtain a certificate or bypass Windows trust checks.

| Kind | Name | Value |
|---|---|---|
| Variable | `WINDOWS_CERTIFICATE_THUMBPRINT` | Expected SHA-1 thumbprint of the signing certificate |
| Secret | `WINDOWS_CERTIFICATE` | Base64-encoded code-signing `.pfx` |
| Secret | `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` |

The workflow combines both native `latest-mac.yml` files into one architecture-aware macOS channel, includes the Windows NSIS channel files, and retains the complete candidate plus `SHA256SUMS` for seven days. Run it from the exact `v<apps/desktop version>` tag; this semver-compatible tag lets electron-updater select prereleases from the GitHub feed. `publish=false` stops after assembling the candidate; `publish=true` creates one GitHub release with all three native targets and their update metadata. The workflow refuses a tag that already owns a release instead of replacing published files; repository-level Release Immutability then prevents later tag or asset changes.

## Accept a release candidate

Record the fixed source commit, version, native runner, installer name, and SHA-256 for each target. Accept macOS Apple Silicon, macOS Intel, and Windows x64 separately only after the installer signature checks, a clean install, application launch, an upgrade from the previous public version, and the packaged smoke pass on that target.

Use an isolated application-data directory for upgrade tests. Before upgrading, create an unsent draft with an attachment and retain an existing session. After restart, verify the draft text, attachment, session history, login state, logout behavior, Agent flow, Skill marketplace, and Recipe marketplace. Record the OS version and architecture, old and new application versions, package digest, and log location without copying credentials into the evidence.

Do not accept a release when packaged code depends on a developer-machine `editorRoot`, absolute `nodeExecutable`, or another external source checkout. An experimental editor integration is not an installed feature until its runtime files and third-party distribution obligations are independently approved and included; do not bundle external source or commercial fonts without that approval.

## Runtime design

The main process reuses Electron as the Node executable with `ELECTRON_RUN_AS_NODE=1` and launches the built `@deepseek-ai/dsh` entry with `--profile mantur --host 127.0.0.1 --port 0 --no-open`. The readiness parser accepts only a tokenized `127.0.0.1` URL. The renderer keeps Node integration disabled, enables context isolation and sandboxing, and sends navigation outside the local origin to the operating-system browser.

The installer carries the existing runtime dependency closure and built Web frontend. `asar` remains disabled because Loader profiles, plugin manifests, native modules, and subprocess helpers require ordinary files. Closing or restarting the application waits for the child process to terminate before Electron exits.

The permanent application identifier is `ai.mantur.agent`. Before Electron becomes ready, the carrier sets a stable `mantur-agent` user-data directory below the operating system's application-data root. Its `harness` child directory is the only `DSH_HOME` used by the installed application, so ambient CLI or development data under `~/.dsh` cannot affect desktop startup. The child starts in an application-owned neutral directory and appends stdout, stderr, recovery, and updater diagnostics to `logs/harness.log` below the same user-data root.

If startup identifies only a stale `session_projcache` schema, the carrier closes the failed child process and its log before the localized native dialog can remove that disposable projection cache and retry after the user explicitly approves the action. It never deletes session logs, settings, credentials, profiles, or workspaces. Other startup failures offer the log and quit instead of guessing a repair.

Packaged applications show the current version and **Check for Updates…** in the native application menu on macOS and the Help menu on Windows. The menu reports checking, download progress, ready-to-install, up-to-date, and failed states; a manual check also opens a localized result or error dialog. Checks start after launch and repeat every six hours. Stable builds accept only stable releases, while versions containing `alpha`, `beta`, or `rc` can accept prereleases. A new version downloads only after user confirmation, and a downloaded version installs only after a second confirmation to stop Harness and restart. Choosing Later leaves a restart-and-install action in the menu. Closing the updater while either prompt is pending suppresses the pending download or installation.

The same update controller runs on macOS Intel, macOS Apple Silicon, and Windows. macOS release updates require a signed and notarized application plus the generated ZIP and update metadata; the DMG remains the human installation artifact. Windows public updates require a code-signing identity, protected publication credentials, and the generated NSIS update assets; this repository does not supply or bypass those prerequisites.

## Known limitations

- The `Desktop package` artifacts remain unsigned internal installers. macOS Gatekeeper and Windows SmartScreen can warn for those files; use only verified `Desktop release` artifacts for external distribution.
- The native icon source is a 1024 px PNG with a white rounded tile and transparent outer corners. The Web client uses the transparent logo separately. macOS and Windows packages derive their platform icon formats during the native build; a vector source remains unavailable.
- The signed Windows job fails until the repository owner configures a code-signing identity in the protected `windows-release` environment.
- Each target is valid only after its native runner completes both packaging and the smoke. A build on one architecture is not evidence for another target.
