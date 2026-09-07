---
description: "Command identity preparation and whole-process-tree cleanup for deployments and maintainers composing shell or persistent terminal consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-scopes

English | [中文](README.zh.md)

## Summary

Prepare command identity before starting a shell process or persistent terminal. Keep that identity until the complete process tree exits and its owner acknowledges release. Reject new work during shutdown and retain cleanup failures instead of reporting successful shutdown. Protocol subprocesses can use the subprocess service directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service beside the subprocess provider before mounting shell or terminal consumers.

```yaml
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: command-scopes
  name: '@deepseek-ai/dsh-command-scopes'
  config:
    identity: none
```

| Field | Default | Meaning |
|---|---|---|
| `identity` | `none` | `required` refuses command admission until one identity provider registers; `none` prepares no identity. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-command-scopes) owns accepted configuration fields. An identity provider registers through a composition effect and supplies environment overrides, cancellation and an asynchronous release operation. Identity values override the command's explicit environment; missing required identity never switches to an unscoped command.

Process allocation returns asynchronously after preparation. The returned process has separate direct-child completion and whole-tree cleanup promises. A persistent terminal retains its identity across sends until its entire session closes. Shutdown stops admission synchronously, cancels pending preparation and active commands, and awaits cleanup acknowledgments. An allocation that completes after cancellation is cleaned up before its caller receives a rejection.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command owner records admission before awaiting identity preparation. It retains cancellation after direct-child exit while descendants remain alive. The subprocess provider proves tree exit; the identity provider then releases authority. A failed tree-exit check or release remains recorded and causes shutdown to reject.

[The implementation](src/index.ts) owns registration, allocation and cleanup together. No runtime invariant companion is published: there is no independently maintained event projection or mutable relation to compare. [Ownership tests](tests/command-scopes.spec.ts) exercise cancellation races, late allocation and failed cleanup at the process provider, plus actual POSIX processes and terminals.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Shell execution](../shell/README.md) — foreground results and asynchronous background handles.
- [Local subprocesses](../../subprocess/subprocess-local/README.md) — process-tree and terminal primitives.
- [Mantur account authorization](../../credentials/authorization-manturhub/README.md) — desktop-managed identity provider.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-bash`, `dsh-tool-pwsh` and persistent shell consumers, which present command output, cancellation and cleanup failures.

#### KV Cache effect

No direct invalidation; the named consumers own request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The service does not authenticate accounts, confine commands or stop protocol subprocesses that bypass it.
- The subprocess provider must prove complete tree or terminal exit. Missing proof retains authority and rejects shutdown; elapsed time alone is not proof.
- Each required-identity composition accepts one provider. A provider's removal cancels and joins its admitted commands.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
