/** Materialize only the checked-in Skill archives for desktop resource packaging. */
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { prepareBundledSkills } from '../../../scripts/mantur-skills-resources.ts'

const desktop = resolve(import.meta.dirname, '..')
const generated = join(desktop, '.generated')
await mkdir(generated, { recursive: true })
const staging = await mkdtemp(join(generated, '.mantur-skills-'))
try {
  const resources = join(staging, 'resources')
  const manifest = await prepareBundledSkills(join(desktop, 'mantur-skills/source.json'), resources)
  const destination = join(generated, 'mantur-skills')
  await rm(destination, { recursive: true, force: true })
  await rename(resources, destination)
  console.log(`Prepared ${manifest.skills.length} verified App-bundled Skills`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
