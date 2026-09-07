/** Public result of opening the current Session's local editing runtime. */
export interface EditingWorkspace {
  /** Loopback editor URL; credentials remain on the Host. */
  editorUrl: string
  /** Canonical directory containing this Session's editing files. */
  directory: string
}
