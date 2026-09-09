# Script workbench prototype

English | [中文](README.zh.md)

## Summary

This isolated browser prototype reads episode files, preserves manual drafts across navigation and collapse, and validates an explicit selection rewrite against the original file. It is not a shipped DSH plugin or a connected main Agent. The controlled adapter accepts `改为：replacement`; it never invokes a model, account or operator. Production integration follows the [integrated workbench decision](../../.agents/notes/implemented/feature/2026-09-09-script-workbench.md).

## Preview

From the repository root, run:

```sh
python3 prototypes/script-workbench/preview.py
```

Open the printed local URL. The server binds a random loopback port and copies the two synthetic episodes into a private temporary project. It only serves allowlisted prototype assets and writes those two copies. Stopping the server removes the copies. The page initially shows an empty state; opening the synthetic project requires an explicit click. No repository installation or package build is needed. Local browser modules include Marked 16.4.2 (MIT) and DOMPurify 3.4.11 (Apache-2.0 or MPL-2.0), copied from the existing external-disk dependency tree; their license texts are retained in browser/. Active HTML, links and remote media are excluded from the rendered subset.

Select an episode, edit and save it, select text, enter `改为：replacement`, and click the submission button. Expand the validation tools to execute the queued request. Admission, execution, commit and readback are separate states. Inspect the last file change or restore its predecessor through the file menu. A request cannot be cancelled after its commit begins.

The local-project picker uses browser directory handles and requires a supporting browser. It lists non-hidden `.md`, `.txt` and `.fountain` files recursively, treating each file as one episode. It does not infer episodes inside a combined document. Use a disposable project for this experimental path. Draft export keeps the original file extension. Markdown files open in rendered reading mode with headings, quotes, emphasis, lists and tables. Switch to source editing to select a rewrite range. Text and Fountain files retain plain-text preview. Rendering never rewrites the source file.

## Data protection and limits

Selection coordinates are UTF-16 offsets plus selected text, nearby context and a SHA-256 full-file version. Repeated text is never searched for or relocated. A changed draft revision or disk baseline rejects a controlled result. Switching episodes and hiding the panel retain drafts; refreshing a changed file refuses to replace an unsaved draft. Restoration also checks the current baseline. Drafts and undo history are memory-only; closing or reloading the page loses them, with a browser warning for unsaved body text.

The fixture server serializes its own writes. Browser writes compare before opening and again before writing an exclusive browser writer. Neither mechanism provides atomic compare-and-swap against arbitrary external programs; an external write in the final comparison/commit window remains a production blocker. A post-write read detects later divergence but cannot undo an overwritten external edit. Do not treat this prototype as a production concurrency guarantee.

The UI has no authentication gate. Its adapter and history are explicit test data, not a substitute for the real Agent. `dsh-bridge.mjs` validates the existing session id and invokes an injected scoped `conversation.send`; the preview does not mount it. Production requests must use the normal logged user-message path, and file completion must be observed independently of admission. A production writer must also enforce permissions, version matching, request cancellation, atomic commit and recovery across every competing write path.

## Verification

```sh
node --test prototypes/script-workbench/tests/model.test.mjs
```

Thirteen controlled tests pass against private real filesystem copies: episode navigation, manual save/restore, exact delivery payload, second identical occurrence, concurrent drafts, external changes, refresh protection, cancellation, failed admission, readback conflict, wrong-session denial, save-lock ownership and commit cancellation. No model is used. Tests do not boot the DSH Loader or replay a released Session.

Real local browser verification covers empty state, loading both files, second-occurrence rewrite, queued versus completed state, difference display, episode switching, manual draft retention through collapse/reopen, suppressed Agent opening and version restoration. The redesigned document-first layout is separately inspected in the browser. Native directory-picker permissions and real model end-to-end execution remain unverified. The preview server and controlled tests are independent of the current running client.

## Research and integration

See [research](research.md) for official sources, license implications, measured editor file sizes and the exact old/new DSH panel differences.
