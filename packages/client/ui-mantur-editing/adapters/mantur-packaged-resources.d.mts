/** Verified absolute resource paths from a platform-specific editor package. */
export interface PackagedResources {
  server: string
  web: string
  remotionBundle: string
  browserExecutable: string
  ffmpeg: string
  ffprobe: string
  compositor: string
  whisperCli: string
  whisperServer: string
}

/**
 * Resolve only declared package resources; invalid manifests and missing files throw.
 * @param root - Absolute installed editor resource directory.
 * @param platform - Target operating system, defaulting to this process.
 * @param arch - Target CPU architecture, defaulting to this process.
 * @returns Verified absolute paths without creating directories or starting processes.
 */
export function resolvePackagedResources(root: string, platform?: string, arch?: string): PackagedResources
