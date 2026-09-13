/** Desktop-owned copies referenced in the ordinary durable user message. */
export interface NativeFileReference {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'directory'
}

/** File selection and drop capabilities exposed by the sandboxed Electron preload. */
export interface NativeFiles {
  /** Copy native files and directories, preserving complete contents. */
  importFiles(files: readonly File[]): Promise<readonly NativeFileReference[]>
  /** Select files or folders and copy them before returning their references. */
  pick(kind: 'file' | 'directory'): Promise<readonly NativeFileReference[]>
}

declare global {
  interface Window {
    /** Present only in the native desktop carrier. */
    manturFiles?: NativeFiles
  }
}
