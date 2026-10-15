/** Persistent per-client skill switches, independent of installed resources. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const schema = z.object({ disabled: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)) })

/** Own the local disabled-name set; callers serialize writes. */
export class SkillPreferences {
  private loaded: Promise<Set<string>> | undefined

  /** @param path - Private preferences file inside the active Harness home. */
  constructor(private readonly path: string) {}

  private read(): Promise<Set<string>> {
    this.loaded ??= (async () => {
      let raw: string
      try { raw = await readFile(this.path, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set<string>()
        throw error
      }
      return new Set(schema.parse(JSON.parse(raw)).disabled)
    })()
    return this.loaded
  }

  /**
   * Read the persisted invocation switch.
   * @param name - Skill identifier.
   * @returns Whether the local user allows new invocations.
   */
  async enabled(name: string): Promise<boolean> {
    return !(await this.read()).has(name)
  }

  /**
   * Atomically persist a switch before publishing the in-memory value.
   * @param name - Validated skill identifier.
   * @param enabled - Requested invocation availability.
   */
  async set(name: string, enabled: boolean): Promise<void> {
    const disabled = new Set(await this.read())
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ disabled: [...disabled].sort() }) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true })
    }
    this.loaded = Promise.resolve(disabled)
  }
}
