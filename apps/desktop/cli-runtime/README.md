# Embedded Mantur CLI input

English | [中文](README.zh.md)

This directory pins the MIT-licensed `@manturhub/cli` 0.11.0 delivery from source commit `c43f29eba2f6e63ac37f64a6a51a70b76a533d2d`. The archive is 37,891 bytes with SHA-256 `44e93ee513e9cad0805679209e27298b85dfdd9d7a1537d535c660206bd14013`; its 22 entries include the upstream license and unmodified CLI source.

[prepare-cli.ts](../scripts/prepare-cli.ts) verifies the archive, installs only its locked production dependencies with `npm ci`, and prepares desktop resources with retained license files. The independent lock pins `@vercel/detect-agent` 1.2.1 under Apache-2.0. It does not change the root pnpm graph or install a global command.

Run the resource preparation from the repository root:

```sh
pnpm --dir apps/desktop run prepare:cli
```

The package and development workflows invoke this preparation before launching or packaging the desktop. The [desktop runtime](../README.md) owns launcher selection and account identity. Replacing this archive requires a reviewed source delivery, new hash, updated independent lock and CLI/broker verification; an absent npm release never selects another version.
