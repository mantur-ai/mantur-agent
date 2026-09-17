# Embedded Mantur CLI input

English | [中文](README.zh.md)

This directory pins the MIT-licensed `@manturhub/cli` 1.1.4 delivery from source commit `1caaf98213982c5f811c62967ef6c757b9649062`. The archive is 46,050 bytes with SHA-256 `2d27ab31ce1de4dbd1032f82f63a983539300fbb9598ca6cb78a79233af2473c`; its 24 entries include the upstream license and unmodified CLI source.

[prepare-cli.ts](../scripts/prepare-cli.ts) verifies the archive, installs only its locked production dependencies with `npm ci`, and prepares desktop resources with retained license files. The independent lock pins `@vercel/detect-agent` 1.2.1 under Apache-2.0. It does not change the root pnpm graph or install a global command.

Run the resource preparation from the repository root:

```sh
pnpm --dir apps/desktop run prepare:cli
```

The package and development workflows invoke this preparation before launching or packaging the desktop. The [desktop runtime](../README.md) owns launcher selection and account identity. Replacing this archive requires a reviewed source delivery, new hash, updated independent lock and CLI/broker verification; an absent npm release never selects another version.
