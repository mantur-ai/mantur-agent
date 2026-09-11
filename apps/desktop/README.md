# Mantur Agent desktop

English | [中文](README.zh.md)

The desktop application is 漫途Agent, built by Mantur to create and produce comic dramas locally. Electron owns the native window and one child process; the child starts the shipped `dsh --profile mantur` application on a random loopback port. Development and packaged applications use the approved blue infinity-loop logo for the native window, macOS Dock, About panel, and installer assets. The desktop package does not implement another agent runtime.

Windows uses the NSIS installation wizard with a selectable application directory. The EXE carries the application resources; its extraction progress is not a second application download. A missing browser-login create endpoint reports an unavailable server route separately from network and incompatible-response failures. Successful packaging does not verify production login availability or provide a Windows signing identity.

Create-attempt retries accept the server's remaining lifetime from zero to 600 seconds while retaining the original absolute expiry.

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

Editor staging excludes only the webpack build cache, the duplicate `.remotion/chrome-headless-shell` cache, and non-target ONNX native directories. The manifest-selected browser, target bindings, other cache content and license files remain. macOS staging rewrites the compositor executables and adjacent dylibs to `@loader_path` references before signing; unresolved non-system libraries stop packaging. Signing options and entitlements remain unchanged. See the [resource staging decision](../../.agents/notes/implemented/bug-fix/2026-09-09-mantur-native-resource-staging.md).

The editor's pinned renderer patch exposes each browser child's process-and-pipe close completion. Installation preparation waits for that evidence and the public browser close operation; missing evidence or cleanup failure remains blocking. See [render browser closure](../../.agents/notes/implemented/bug-fix/2026-09-09-mantur-render-browser-close.md).

The macOS commands let electron-builder sign and produce the update ZIP, then create the DMG with Apple's `hdiutil`. A temporary unique volume name prevents collisions with an installed or mounted copy of the application; the finished image restores the `漫途Agent` volume name, adds an Applications shortcut, and receives a separate update blockmap. The mountpoint uses a unique directory under macOS `getconf DARWIN_USER_TEMP_DIR`, while image files stay under the build output directory; failure to resolve or create the mountpoint stops packaging.

For local Apple Silicon acceptance without Developer ID credentials, use `pnpm run desktop:dist:mac:arm64:local` in a separate clean build checkout. It explicitly selects electron-builder's ad-hoc identity, disables certificate discovery and notarization, and requires strict signature verification. The standard signer seals the assembled bundle before the ZIP is produced; an additional `codesign --verify --deep --strict` check must pass before DMG creation. Do not modify the signed application afterward. This local identity proves bundle integrity, not Apple approval, notarization, Gatekeeper acceptance or suitability for public updates. The signed release workflow and its certificate requirements are unchanged; see the [local signature decision](../../.agents/notes/implemented/bug-fix/2026-09-09-local-macos-bundle-signing.md).

Run the x64 macOS command on an Intel Mac and the Windows command on x64 Windows. The manual `Desktop package` GitHub Actions workflow checks out one commit on three native runners, runs the packaged smoke, and retains these files, generated blockmaps, and each platform's update metadata (`latest-mac.yml` or `latest.yml`) for seven days. These CI attachments do not publish a release feed:

| Runner | Command | Artifact |
|---|---|---|
| macOS arm64 | `pnpm run desktop:dist:mac:arm64` | `Mantur-Agent-macOS-arm64.dmg`, `Mantur-Agent-macOS-arm64.zip` |
| macOS x64 | `pnpm run desktop:dist:mac:x64` | `Mantur-Agent-macOS-x64.dmg`, `Mantur-Agent-macOS-x64.zip` |
| Windows x64 | `pnpm run desktop:dist:win:x64` | `Mantur-Agent-Windows-x64.exe` |

The smoke starts `dsh` from the unpacked application's own dependency directory, exchanges the printed process token for a session cookie, and requires the branded Web page to return HTTP 200. It also validates every Mantur Cut manifest path, starts the packaged Whisper CLI and server with `--help`, requires the source, license, build, and security records, and checks the updater dependency and GitHub release configuration. It uses an empty temporary Harness home so developer data cannot make the package check pass or fail.

The smoke also checks the embedded CLI's pinned source manifest, package versions, licenses and dependency entry, creates the real profile-local launcher, and requires `manturhub --version` to report `0.11.0` using the packaged Electron executable. The launcher disables CLI and skill update checks. Missing resources fail without searching for a global CLI. This check does not open an account attempt or verify browser authorization, Main's operating-system storage, or Windows behavior on macOS.

Packaging copies the CLI source record and its `node_modules` directory as separate resource inputs. Electron Builder excludes a top-level `node_modules` child when copying a directory; selecting the module directory itself preserves the embedded CLI and its dependency.

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

Directory selection uses the parameterless `manturDirectoryPicker.pick()` preload capability. Main accepts only the current local main frame and parents Electron's single-directory dialog to the current application window. Cancellation returns `null`; failures remain errors without invoking the Host picker. A pending dialog rejects duplicate requests and blocks update preparation until the native call settles. Main rejects new requests during update preparation or quitting and invalidates late results after main-frame navigation, window close, or quitting.

The main process reuses Electron as the Node executable with `ELECTRON_RUN_AS_NODE=1` and launches the built `@deepseek-ai/dsh` entry with `--profile mantur --host 127.0.0.1 --port 0 --no-open`. The readiness parser accepts only a tokenized `127.0.0.1` URL. The renderer keeps Node integration disabled, enables context isolation and sandboxing, and sends navigation outside the local origin to the operating-system browser.

The installer carries the existing runtime dependency closure and built Web frontend. `asar` remains disabled because Loader profiles, plugin manifests, native modules, and subprocess helpers require ordinary files. Closing or restarting the application waits for the child process to terminate before Electron exits. A Node IPC channel connects the Electron parent and its child; feature owners validate their own messages.

Packaged Main supplies `resources/mantur-cut` and its own executable to the Mantur editing profile. The editor runs in Electron's Node mode on first workbench open, not in a second Electron window. The package must contain the declared production server, static frontend and target rendering binaries; an incomplete editor package fails explicitly. Development does not inherit this packaged selection. See the [editing runtime](../../packages/client/ui-mantur-editing/README.md) for Session-owned writable paths and the remaining distribution checks.

Main owns browser-account-v2 authorization and OS-encrypted profile storage. The login button opens the configured issuer's ordinary website login and consent page. Main registers an exact `127.0.0.1` callback, checks state and issuer, seals the one-use code, and exchanges it with PKCE and device proof. Only confirmed grant metadata enables sign-in and window activation. The renderer receives neither the state-bearing URL nor credentials.

Exchange recovery reuses the original encrypted request before the attempt deadline. A restarted no-code attempt is cancelled instead of registering another port. Logout immediately blocks local calls and retains encrypted cancellation or revocation until server HTTP 204 or the grant's absolute lifetime ends; an uncertain exchange retains the ninety-day upper bound. Browser-account storage uses version 2. Before the Host starts on macOS, Main offers explicit reauthorization for a version-1 database. Confirmation preserves an owner-only backup beside the account directory and atomically replaces only the account database with empty version-2 storage; cancellation leaves the database untouched. Replacement failures retain the original database or its private backup and stop startup with a fixed error. Old credentials are never decrypted, reused or remotely revoked by this operation; projects, drafts and model credentials are unchanged. Other nonempty formats remain rejected. Windows version-1 recovery is unavailable until native durable publication is implemented; it fails explicitly without replacing data. See the [account upgrade decision](../../.agents/notes/implemented/architecture/2026-09-09-native-account-reauthorization.md).

The [embedded CLI input](cli-runtime/README.md) is a reviewed archive plus an independent npm lockfile. Development and packaging prepare `mantur-cli` resources. Main creates a profile-local launcher, prepends it to the supervised Host's PATH, and uses its own Electron executable in Node mode. Missing resources fail startup. Commands use broker-v2 descriptors; only Main attaches the device bearer upstream. Runtime never installs or searches for a global CLI.

The permanent application identifier is `ai.mantur.agent`. Before Electron becomes ready, the carrier sets a stable `mantur-agent` user-data directory below the operating system's application-data root. Its `harness` child directory is the only `DSH_HOME` used by the installed application, so ambient CLI or development data under `~/.dsh` cannot affect desktop startup. The child starts in an application-owned neutral directory and appends stdout, stderr, recovery, and updater diagnostics to `logs/harness.log` below the same user-data root.

If startup identifies only a stale `session_projcache` schema, the carrier closes the failed child process and its log before the localized native dialog can remove that disposable projection cache and retry after the user explicitly approves the action. It never deletes session logs, settings, credentials, profiles, or workspaces. Other startup failures offer the log and quit instead of guessing a repair.

Packaged applications show the current version and **Check for Updates…** in the native application menu on macOS and the Help menu on Windows. The menu reports checking, download progress, ready-to-install, up-to-date, and failed states; a manual check also opens a localized result or error dialog. Checks start after launch and repeat every six hours. Stable builds accept only stable releases, while versions containing `alpha`, `beta`, or `rc` can accept prereleases. Background discovery remains silent. The Mantur sidebar displays an update entry above Settings in expanded and collapsed modes; it retains the installed version and manual check action while idle or up to date, and exposes failed checks without claiming the installed version is current. An explicit download click starts the transfer, with actual byte counts and percentage only when known. A downloaded and verified version requests confirmation before restart preparation. Confirmed installation requests the Host shutdown receipt over the owned IPC channel, then closes the account channel and asks the Host to exit normally. Main waits for actual process exit and diagnostic-log closure before invoking the installer. Unsupported Host compositions, failed saves, cancellation, abnormal exit, and deadlines block installation; checking and downloading do not freeze work. Host cleanup may continue after a failed wait and does not automatically resume work. See the [Host update policy](../../packages/bundle/mantur-app/README.md#use-this-package). Choosing Later leaves the restart-and-install action available without repeating the dialog. Sidebar and native menu actions share main-process confirmation; a failed save retains the verified download and reports the error. Closing the updater suppresses pending installation.

The same update controller runs on macOS Intel, macOS Apple Silicon, and Windows. macOS release updates require a signed and notarized application plus the generated ZIP and update metadata; the DMG remains the human installation artifact. Windows public updates require a code-signing identity, protected publication credentials, and the generated NSIS update assets; this repository does not supply or bypass those prerequisites.

## Draft checkpoints

<a id="draft-checkpoints"></a>

The desktop uses the original per-Session browser draft storage. It no longer exposes the native draft checkpoint bridge or locks drafts during Session navigation. Unsent browser drafts are not guaranteed to survive a change of loopback origin; sent messages remain in the Session log. Old native checkpoint files are retained on disk but are not restored automatically.

The desktop composer accepts native file and folder drops and provides Add files and Add folder buttons. Selected documents are copied byte-for-byte into unique directories below `userData/attachments`, including nested paths and empty directories. Names do not determine accepted file types: Markdown, Word documents, audio and other materials retain their original bytes. A failed batch is removed and the error is shown; original files are not changed. Symlinks and imports containing the attachment store are rejected.

Saved paths are appended to the originating draft and travel through ordinary user-message logging. Import completion cannot append to another Session after navigation. Document interpretation uses the Agent’s file tools; import does not claim to extract Word text. Images retain their preview and image submission path. Browser-only deployments retain image intake. The [native import decision](../../.agents/notes/implemented/feature/2026-09-11-desktop-file-import.md) records the storage and testing scope.

## Known limitations

- Main-application dependency pins and their verification scope are recorded in the [desktop dependency security decision](../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-main-app-security.md).
- Packaging and starting the Whisper executables proves that their native files and adjacent libraries load on the target; it does not make local transcription available in the embedded workbench. The Mantur iframe does not yet install OpenChatCut's desktop inference preload, so the editor's native-ASR adapter currently returns unavailable.
- A built internal installer is not distribution approval. OpenChatCut's AGPL source-delivery obligations, Remotion's entity and use terms, FFmpeg and ffprobe GPL/LGPL obligations, retained notices, binary redistribution terms, and every production audit finding require review for the exact patched tree before public release.
- Local callback, encrypted-store, simulated-preload and embedded-CLI tests do not establish real website authorization. The CLI balance fixture uses a controlled local response. Native macOS and Windows account storage, browser return, installer resources, PostgreSQL 16 and authorized test-site checks remain separate acceptance requirements; see the [browser authorization decision](../../.agents/notes/implemented/architecture/2026-09-08-browser-account-authorization.md).
- The `Desktop package` artifacts remain unsigned internal installers. macOS Gatekeeper and Windows SmartScreen can warn for those files; use only the `Desktop release` artifacts for external macOS distribution.
- The native icon source is a 1024 px PNG with a white rounded tile and transparent outer corners. The Web client uses the transparent logo separately. macOS and Windows packages derive their platform icon formats during the native build; a vector source remains unavailable.
- The signed release workflow publishes macOS only. Windows external updates remain unsupported until a Windows code-signing identity and protected publication path exist.
- Each target is valid only after its native runner completes both packaging and the smoke. A build on one architecture is not evidence for another target.
