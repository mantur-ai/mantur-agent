# Agent Note: Thin desktop carrier

Status: implemented

English | [中文](2026-09-02-thin-desktop-carrier.zh.md)

## Problem

Harness users who do not work from a terminal need a normal desktop installer, but a second desktop-specific agent assembly would duplicate the Web application, plugin composition, persistence, security policy, and release behavior. Cross-platform installers also need native evidence because Electron, native modules, DMG creation, and NSIS behave differently on each operating system and architecture.

## Decision

`apps/desktop` is a thin Electron carrier around the existing Web application. The Electron main process starts the built `@deepseek-ai/dsh` entry with `--profile mantur`, a random `127.0.0.1` port, and browser opening disabled. It accepts only the tokenized loopback readiness URL and loads that URL in a renderer with sandboxing, context isolation, and Node integration disabled. The native process owns window lifecycle and terminates the child; the DSH profile owns every agent, tool, credential, session, and Web behavior.

Electron also supplies the child process's Node runtime through `ELECTRON_RUN_AS_NODE=1`. This keeps one runtime in each installer and preserves the rule that supported Node applications start through a named `dsh` profile. The desktop dependency root includes the existing Python deploy closure plus the Web application closure and the required session-title peer; electron-builder rebuilds native dependencies for the target Electron runtime.

The client build profile `mantur` fixes `DSH_CLIENT_TITLE` to `漫途Agent` together with the repository version and commit metadata. The Mantur application profile supplies its in-app identity. The native window, macOS Dock, About panel, and both package targets use the blue infinity-loop icon on a white rounded tile with transparent outer corners; the Web client retains the transparent logo. The carrier declares the stable application identifier `ai.mantur.agent` and sets Electron's user-data path to the `mantur-agent` directory below the operating system's application-data root before readiness. The child receives only that directory's `harness` child as `DSH_HOME` and starts in an application-owned neutral directory; ambient CLI state under `~/.dsh` does not enter desktop startup.

The same user-data root owns a persistent combined Harness and desktop diagnostic log. A startup failure closes the child process and log before it offers one narrow recovery only when the error names a schema-invalid `session_projcache`: after explicit native-dialog approval, the carrier removes only that projection cache and retries. Session logs, settings, credentials, profiles, and workspaces remain untouched. All other errors offer the log and quit.

Explicit local profiles use the existing Electron `--user-data-dir` switch instead of a second environment variable. A supplied absolute non-root directory selects both Electron `userData` and `sessionData`; its `harness` child remains the only desktop `DSH_HOME`. Validation and directory creation precede account, draft, and Harness initialization, and errors never select default storage. With no switch, both mode-specific defaults and their initialization remain unchanged. Distinct configured directories isolate profile files; choosing the same directory shares them. The switch neither discovers nor migrates accounts or credentials.

Installed builds use electron-updater against `mantur-ai/mantur-harness` GitHub Releases. Stable builds accept only stable releases; versions containing `alpha`, `beta`, or `rc` accept prereleases. Checks begin after startup and repeat every six hours. The native application menu on macOS and Help menu on Windows expose the current version, a manual check action, checking and download progress, failures, and a ready-to-install action. Manual no-update and error results also appear in localized native dialogs. Both state-changing steps require separate approval: the carrier asks before downloading, then asks again before it stops Harness and restarts into the installer. Choosing Later after download keeps the installer action reachable. Disposing the updater removes its listeners and prevents pending prompt results from downloading or installing a version. Background checks and failures are written to the desktop log.

The root `desktop:dev` command owns the local edit cycle without invoking electron-builder. A watcher reruns the incremental desktop TypeScript project, bundles the Electron entry, and starts Electron directly. A source or resource change terminates the active Electron process, which first waits for its dsh child to close, then begins the next cycle. Development dsh output is mirrored to the terminal while remaining in the persistent log. Development selects `mantur-agent-dev` as its user-data directory, leaving the installed `mantur-agent` state untouched; `app.isPackaged` keeps the updater inactive.

Main owns the directory dialog because only the Electron carrier can parent it to its live window. A parameterless, current-main-frame-only preload capability returns one absolute directory or `null`; the shared Workspace plugin selects this callback at composition and retains Host-owned adoption. Ordinary browsers retain the [Host picker](2026-07-27-native-workspace-directory-picker.md). Native errors never start that second implementation. Main keeps the dialog pending until Electron settles it, rejects duplicates and update preparation while pending, and invalidates results after navigation, close, or quit. Invalidating a result does not claim to cancel the OS dialog. Keyless bridge and Main-wiring tests cover these rules; native visibility requires OS GUI verification.

## Packaging and verification

The native matrix runs macOS arm64, macOS x64, and Windows x64 from one checked-out commit. Each runner performs the full Mantur build, unit tests the launch grammar and branded build environment, creates only its native installer, and starts DSH from the unpacked application's dependency directory. The smoke performs the process-token exchange, requests the authenticated page, and requires HTTP 200, the Web boot payload, the `漫途Agent` document title, the packaged updater dependency, and the expected release-feed configuration.

The internal packaging workflow produces unsigned DMG, macOS update ZIP, and one-click NSIS installers. The private desktop workspace remains excluded from the npm release family, and this workflow retains its files as private Actions artifacts without creating a tag or GitHub release. A target is not considered validated until its native packaging and packaged smoke both pass.

DMG image files remain under the build output directory, but the `hdiutil` mountpoint uses a unique directory under macOS `getconf DARWIN_USER_TEMP_DIR`. An external build volume with ownership disabled can reject mounts inside its output tree even when it permits image creation. Resolving or creating the system mountpoint fails explicitly; packaging does not change volume permissions or try another directory. Cleanup removes only the empty mountpoint after detaching, retaining image files if the mount cannot be removed safely.

The macOS release workflow uses protected GitHub environment secrets to sign and notarize native arm64 and x64 builds. It validates the Developer ID signature, Gatekeeper assessment, stapled ticket, and packaged smoke before it combines the two architecture-specific channel files. An explicit publication run from the exact `v<version>` tag creates one GitHub release containing both DMGs, both update ZIPs, their blockmaps, combined update metadata, and SHA-256 hashes. The semver-compatible tag lets electron-updater select alpha, beta, and RC releases from the GitHub feed. The workflow rejects an existing release; repository-level Release Immutability must also be enabled before publication so later tag and asset changes are blocked. Windows remains outside the external update channel until it has an independent signing identity and publication path.

## Alternatives considered

**Open the desktop folder chooser from the background Host helper.** Rejected because that process does not own the Electron window and cannot give the chooser its application parent. The narrow Main capability preserves the existing Workspace flow without moving workspace storage into Electron or pretending that invalidation cancels a native dialog.

**Embed Harness Host and replace HTTP with Electron IPC.** Rejected because it creates a desktop-specific application assembly and transport, duplicates existing Web authentication and lifecycle behavior, and requires a larger upstream divergence before one-click installation proves demand for those changes.

**Open the existing Web profile only in the system browser.** Rejected because it does not provide the installed application, single-instance window, and application lifecycle that users expect from a desktop client.

**Bundle an independent Node executable beside Electron.** Rejected because Electron already provides a compatible Node mode and electron-builder rebuilds native modules for it. A second runtime increases installer size and creates another version and license payload to maintain.

**Cross-build every target on one host.** Rejected because producing an archive does not prove that target-specific native modules load or that the packaged application starts. Native runner smoke is the acceptance evidence.

**Build a native installer for each development change.** Rejected because DMG, ZIP, NSIS, signing, notarization, and update metadata do not contribute evidence for ordinary Electron entry changes. Those operations remain release-path checks, while the development command exercises the same unpackaged main process and dsh Web launch directly.

**Isolate desktop tests by changing only HOME.** Rejected because the main process selects storage below Electron's operating-system application-data root. An explicit desktop directory also selects browser session storage and the child Harness home, without relying on ambient CLI configuration.

**Expose desktop updater state through the Web application.** Rejected because the renderer intentionally has no Electron preload bridge, Node integration, or desktop-specific HTTP API. A native menu presents an application-lifecycle function without adding desktop transport to the Harness profile or Web client.

## Consequences

- Desktop users get ordinary installers while the Web profile remains the only interactive Harness application implementation.
- The loopback child process adds one local HTTP lifecycle and makes startup failure visible in a native localized dialog.
- Installed desktop state is isolated from CLI state; a schema-invalid session projection cache has one user-approved disposable reset instead of preventing application startup indefinitely.
- Update checks are automatic and manually reachable, but downloading and restart installation remain user decisions. Stable users do not receive prereleases. Only the signed macOS release artifacts constitute the external update channel; Windows public updates still require signing credentials and a protected publication path.
- Desktop changes run through one watched development command without generating installers; development data and installed data remain separate.
- The full runtime dependency closure and unpacked files make the installer larger than a dedicated client; this cost avoids a second application runtime and keeps Loader and native-module paths ordinary.
- Signing and notarization credentials remain protected deployment inputs. The internal packaging workflow cannot access them or publish a release.
