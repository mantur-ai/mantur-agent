---
description: "Mantur Agent logo and product-copy occupants for the sidebar and blank-session hero, for maintainers composing the Mantur desktop client."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-brand-mantur`

English | [中文](README.zh.md)

## Summary

This package fills the generic sidebar and blank-session hero with the approved blue infinity-loop logo, the localized `漫途Agent` product name, and the Mantur product promise. The collapsed sidebar shows the same logo until hover reveals its ordinary panel control, while the empty hero badge occupant keeps the Web Preview badge out of the Mantur composition. It changes no layout, conversation, model, permission, or agent capability.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this row only through [`dsh-mantur-app`](../../bundle/mantur-app/README.md). The browser half registers `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`, `conversation.hero.headline`, and `conversation.hero.badge` after their owners declare them. Both locales render the confirmed product name `漫途Agent` in the sidebar, while the hero places the approved logo before the Chinese headline `故事起于一念，余下交给漫途` or its English equivalent. The Mantur Web application must serve `mantur-logo.png` beside its built page.

The light appearance uses the approved vermilion-and-blue storyboard palette: warm paper, cobalt actions, and darker status text. The application serves `mantur-storyboard-background.svg` beside its built page; decorative marks occupy only the outer frame edges and disappear below 900 px. Image previews use a neutral background; video letterboxing stays dark. Dark appearance and body-portaled onboarding retain their own palettes. The plugin removes its stylesheet and body marker when unloaded; [the theme decision](../../../.agents/notes/implemented/feature/2026-09-06-mantur-storyboard-theme.md) records the contrast and scoping constraints.

<a id="model-experience"></a>
## Model Experience

None, as this package contributes browser presentation only and the Mantur model identity belongs to the profile bundle.

#### KV Cache effect

None; no text from this package reaches a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The approved source is raster artwork** — Web and native packaging use byte-identical 1024 px PNG files until Mantur approves a vector source.
- **The complete product name remains visible** — the logo supplements `漫途Agent` in the expanded sidebar instead of replacing its localized name.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The expanded row, collapsed rail, and hero render the same image URL. The sidebar shell owns the collapsed hover swap from the logo to its panel-navigation affordance.

</details>

**Runtime invariant:** No companion is published. One browser effect installs and removes all five slot occupants together.
