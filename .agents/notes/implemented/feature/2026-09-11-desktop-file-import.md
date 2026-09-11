# Agent Note: Native file and folder import

Status: implemented

English | [中文](2026-09-11-desktop-file-import.zh.md)

## Problem

The shipped desktop composer rejects non-image files and does not retain dropped directory trees. Native draft persistence also blocks Windows saves and changes Session switching behavior.

## Decision

The desktop imports explicitly selected local documents and directories as durable copies and appends their paths to the originating composer. These references use ordinary logged user text; no unlogged model context is added. Import preserves original bytes and directory structure without depending on MIME detection or document conversion.

The importer owns a unique batch directory and publishes its results only after every entry succeeds. Failure removes that batch. Original files remain unchanged, duplicate names receive separate parent directories, and symlinks and self-containing imports fail explicitly. IPC accepts only the authenticated native main frame. A pending import locks its originating composer; navigation cannot redirect completion into a different draft.

The carrier removes native draft-checkpoint exposure and uses original browser draft persistence as requested. Existing checkpoint files are not deleted. Origin-independent recovery is no longer promised. Host save and exit verification still precede update installation. Internal draft-lock guards remain intact for attachment import and other explicit transactions.

## Alternatives considered

Backporting the newer upstream generic upload service requires a separate multi-package migration. This change targets the native DMG and EXE: it copies local material and logs references, rather than introducing another remote upload protocol. A browser-only deployment still accepts images. Import does not perform Word text extraction.

## Consequences

Local copies consume disk space until explicitly removed. File paths in sent messages refer to this computer. Word extraction remains a separate tool operation; browser-origin changes may lose unsent drafts.

## Verification

Unit tests cover nested Chinese names, byte preservation, empty directories, duplicate names, rejected links and failed batches. A real Loader browser test uses an explicit test-native transport backed by real disk copies. The supplied 47-file directory was copied into an isolated temporary directory and every relative path and SHA-256 digest matched; originals were not modified. Platform installers still require their native build and smoke results.
