# Isolated drama asset workbench

English | [中文](README.zh.md)

Inspect existing images/videos, save prompt drafts, send selected IDs to a controlled Agent, review differences and confirm edits. The prototype uses labeled fixtures with two episodes, two scene chains, base assets/variants and missing-media/failure/tail-wait states. It does not connect to a real main Agent, production projects, Feishu or paid operators.

## Preview

Start a localhost-only static preview from the repository root:

```sh
python3 -m http.server 4318 --bind 127.0.0.1 --directory prototypes/drama-asset-workbench
```

Open http://127.0.0.1:4318 . ManturHub login is unnecessary. The page stores isolated drafts, revisions, receipts and closure state in this browser origin's localStorage, with Web Locks serializing cross-tab writes. Corrupt storage stops explicitly; fixture data never replaces existing edits. This command previews static prototype files; it is not another Harness application launcher.

## Interaction

1. Image/video tabs and episode/scene filters limit the view; changing a filter clears selection.
2. Open an asset and edit its next prompt/negative prompt. Input remains a browser draft; Save draft confirms storage. Apply draft creates a source revision. Neither action calls a model or generates media.
3. Enter instructions for one or several selected items and explicitly send them to the controlled Agent. Acceptance and execution receipts differ. Each item shows original text, proposed text and status; accept or reject individually, or confirm all pending proposals.
4. The lantern's first controlled rewrite deliberately fails. Retry failed items retains the request ID, increments only failed attempt numbers and excludes successful items.
5. Verification tools simulate another Agent updating a source revision. Conflicts retain drafts; compare current text before explicitly continuing against the current version. History restoration creates another revision.
6. Hiding the panel leaves its Worker alive. Reload ends the controlled Worker; same-tab recovery marks pending items interrupted and permits explicit resumption with the original request ID and only interrupted items. Closing the entire tab and opening a new tab does not recover cross-page Worker ownership. This differs from a real background main Agent; acceptance is not completion.

## Verification

```sh
node --test prototypes/drama-asset-workbench/model.test.mjs
node --check prototypes/drama-asset-workbench/app.mjs
```

[Field mapping and integration gaps](evidence/mapping.md) distinguish live inputs, local Skill documentation and unverified output paths. [Design](DESIGN.md) and [product constraints](PRODUCT.md) belong only to this directory. No third-party npm dependency was added; images are authored test cards and the video encodes an FFmpeg test source, not generated story content.

## Production integration limitations

Real updates require source fingerprints and atomic writes, correlated main-session proposals/receipts, Base readback, safe signed-URL media access and renewed validation/price approval before generation. Only the shell.overlay list slot and SessionController.prompt admission API have source evidence. No plugin is registered and no existing client package changed. Missing production APIs must not be disguised by the controlled channel.

[Browser and test evidence](evidence/verification.md) records observed results. expected-workflow.json is a keyless controlled-channel snapshot, not a real Harness Session replay.
