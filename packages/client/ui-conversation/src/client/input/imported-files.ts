/** Native file copies use the same editable reference chips as workspace selections. */
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { ReferenceInsert } from '../contract/input.ts'
import type { NativeFileReference } from '../contract/native-files.ts'

/**
 * Build a settled, closed file mention while keeping storage paths out of the chip label.
 * @param file - The native carrier's completed local copy.
 * @returns A reference, or undefined when the path cannot be represented by file-mention syntax.
 */
export function importedFileReference(file: NativeFileReference): ReferenceInsert | undefined {
  const path = file.kind === 'directory' ? `${file.path}/` : file.path
  const mention = formatFileMention({ path, kind: 'file' }, false)
  if (mention === undefined) return undefined
  return {
    source: 'reference', ref: mention, clipboardText: mention,
    label: file.name, appearance: file.kind === 'directory' ? 'folder' : 'file',
  }
}
