# Embedded Mantur CLI input

English | [中文](README.zh.md)

This directory pins the MIT-licensed `@manturhub/cli` 1.2.5 delivery from source commit `fbb6e4c3929098b886c70b1e2223122ce2148e2d`. The archive is 58,235 bytes with SHA-256 `fcf0caad18ddd7e872bfd7833bc44cbd0e0222cfc805d896e2cacdb47bb42a66`; its 30 entries include the upstream license and unmodified CLI source.

[prepare-cli.ts](../scripts/prepare-cli.ts) verifies the archive, installs only its locked production dependencies with `npm ci`, and prepares desktop resources with retained license files. The independent lock pins `@vercel/detect-agent` 1.2.1 under Apache-2.0, plus the CLI’s JSON-schema validators and `libsql` 0.5.29 with its platform-specific native dependencies. It does not change the root pnpm graph or install a global command.

Run the resource preparation from the repository root:

```sh
pnpm --dir apps/desktop run prepare:cli
```

The package and development workflows invoke this preparation before launching or packaging the desktop. The [desktop runtime](../README.md) owns launcher selection and account identity. Replacing this archive requires a reviewed source delivery, new hash, updated independent lock and CLI/broker verification; an absent npm release never selects another version.
