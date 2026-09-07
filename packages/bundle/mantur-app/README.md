---
description: "Mantur Agent desktop product layer over the shipped Web profile, for maintainers building the branded local comic-drama client."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-mantur-app`

English | [中文](README.zh.md)

## Summary

This bundle is the final layer of the shipped `mantur` profile. It retains the Web runtime, model picker, permission picker, Models settings, DeepSeek API-key setup, and underlying agent capabilities while replacing the generic product identity with 漫途Agent: a Mantur-built agent for local comic-drama creation and production. It mounts independent Mantur brand, marketplace-navigation, and account plugins and disables the official brand row, preview notice, Agent Preset UI, Plan UI, Preview badge, and generic Web GUI prompt identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Launch the complete product through `dsh --profile mantur`; the desktop carrier selects that profile automatically. The ordered bundle stack is `dsh-base`, `dsh-web-app`, then this layer. The `web` profile remains unchanged.

New conversations remain unassigned until the user selects a project or submits the first draft. The layer mounts [automatic project preparation](../../workspace/mantur-projects/README.md) and supplies the desktop-resolved root through `DSH_MANTUR_PROJECTS_ROOT`. First send requires a durably saved native draft identity; opening the home page creates no project. The user can inspect or change the root in the composer footer.

The Mantur sidebar adds a Features group before Projects, with fixed Skill Marketplace and Recipe Marketplace entries. Each entry opens an independent root page and returns to the current conversation without persisting a route. The Skill page loads ManturHub's public catalog and details, reuses ManturHub device login, and asks the Host to install a verified archive into this profile's live Skill directory. The Recipe page defines a Recipe as a proven creative example with a result sample, prompt template, reproducible operator parameters, model and operator details, and an estimated recreation cost; it is not a generic workflow template. The account page exposes login and sign-out only. Login, both marketplaces, details, and downloads use the deployment selected in the machine-local profile configuration, with separate grants per origin.

Maintainers switch the installed macOS application by editing `~/Library/Application Support/mantur-agent/harness/profiles/mantur/cordis.patch.yml`. Development runs use the sibling `mantur-agent-dev` directory. The patch replaces the complete `mantur-account` config, so keep all three fields and change only `environment` during routine switching:

```yaml
- id: mantur-account
  config:
    environment: test
    baseUrl: https://hub.mantur.ai
    testBaseUrl: https://test.example.com
```

Use `environment: production` to return to production. Quit and reopen the desktop application after each edit so browser account and marketplace state cannot survive a deployment change. The profile rejects a missing test URL, a path-bearing URL such as `https://test.example.com/api`, and a test origin equal to `baseUrl`.

The desktop update consumer activates only after explicit installation confirmation. It stops profile reload and preset admission, freezes each owned agent registry, quiesces drivers, and joins native pickers, original Gateway/HTTP requests, and producer owners before closing settings, session writers, projection caches, and storage domains. A fresh writer verification produces the request-bound IPC receipt. The coordinator retains isolated and retired service instances throughout its lifetime so replacement cannot discard cleanup failures. Each repeated preparation rechecks writer seals.

Only modules reviewed in the update policy participate. Code execution with unmanaged OS descendants, module HMR, arbitrary Host plugins, unverified telemetry, and editing/MCP compositions without a shutdown owner prevent installation. A failure or expired Main wait never authorizes installation; already-started Host cleanup continues and stopped work does not restart automatically. The ordinary application-close path remains separate.

<a id="model-experience"></a>
## Model Experience

### Mantur comic-drama production identity

#### What the model sees

The system-prompt service omits its generic Harness identity. The Mantur identity row replaces the effective agent-preset persona after cooperative prompt transforms with one Chinese persona naming 漫途Agent, Mantur ownership, local execution, and comic-drama work from story and script through storyboard, visual assets, audio, editing, and production delivery. The layer also disables the Web surface prompt so no second product identity is added.

##### Mantur persona

```markdown
你是漫途Agent，由漫途（Mantur）打造，专门在用户电脑本地完成漫剧创作与生产。你的职责是围绕漫剧项目完成故事构思、剧本、分镜、视觉素材、音频、剪辑方案和制作交付。你应使用当前本地工作区与可用工具直接推进制作，在获得必要授权后执行本地操作，并保持项目文件清晰有序。你的工作目录是 {{cwd}}。
```

#### Token effect

One stable Mantur persona replaces the short generic coding-agent persona and Web GUI orientation section. Tool schemas and task-dependent context remain unchanged.

#### KV Cache effect

Stable for a fixed working directory and underlying agent composition. The desktop profile uses live patch reload during development.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Release assets remain pending** — the final macOS and Windows application icons require approved Mantur artwork.
- **Three-platform installer verification remains pending** — macOS arm64, macOS x64, and Windows x64 packaging and signing must run on their native release runners.
- **Capabilities remain installed** — Agent Preset and Plan packages are retained below this product layer; only their visible browser rows are disabled.
- **Local Skills remain shared** — machine-local environment selection isolates online requests and grants, while Skills installed into this profile's live local directory remain available in both environments.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The layer restates the complete `system-prompt` and `web-runtime` configs because an id-targeted patch replaces a row's whole config.

</details>

**Runtime invariant:** No companion is published. Composition tests apply the base, Web, and Mantur patches in production order and reject a missing target row.
