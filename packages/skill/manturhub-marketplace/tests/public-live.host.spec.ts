import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareBundledSkills } from '../../../../scripts/mantur-skills-resources.ts'
import { it, expect } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'

it.skipIf(process.env.MANTUR_MARKETPLACE_LIVE !== '1')('reads production public catalogs, details and installs every published Skill without credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mantur-public-live-'))
  const ctx = new Context()
  ctx.provide('manturAccount', {
    request: (path: string, options: { signal?: AbortSignal; redirect?: RequestRedirect }) =>
      fetch(new URL(path, 'https://hub.mantur.ai'), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.redirect === undefined ? {} : { redirect: options.redirect }),
      }),
    status: () => Promise.resolve({ status: 'signed-out' }),
  } as never)
  try {
    const bundledSkillDir = join(home, 'bundled')
    await prepareBundledSkills(fileURLToPath(new URL('../../../../apps/desktop/mantur-skills/source.json', import.meta.url)), bundledSkillDir)
    const service = new ManturHubMarketplace(ctx, { dshHome: home, bundledSkillDir })
    const updated = await service.updateBundled(new AbortController().signal)
    expect(updated.skills).toHaveLength(4)
    expect(updated.updates).toHaveLength(4)
    for (const item of updated.skills) {
      if (updated.updates.find(update => update.name === item.name)?.status === 'verified') {
        expect(item.version).toBe((await service.detail(item.name)).version)
      }
      expect(await service.resolveBundled(item.reference, new AbortController().signal)).toEqual(item)
    }
    console.log('Verified production recommended Skills:', updated.skills.map(item => `${item.name}@${item.version}`).join(', '))
    const skills = await service.list()
    expect(skills.skills.length).toBeGreaterThan(0)
    const studio = await service.detail('mantur-drama-visual-studio')
    expect(studio.usesOperators).toContain('op.drama.asset-extract')
    const recipes = await service.listRecipes({})
    expect(recipes.recipes.length).toBeGreaterThan(0)
    expect((await service.recipeDetail(recipes.recipes[0]!.slug)).title).toBe(recipes.recipes[0]!.title)
    const dance = await service.recipeDetail('rcp.video.max-level-patient')
    expect(dance.steps.map(step => step.operatorCode)).toEqual(['op.image.generate', 'op.video.generate', 'op.video.compose'])
    expect(dance.steps[0]?.note).toContain('不得生成绿幕')
    const miniature = await service.recipeDetail('rcp.video.tiny-person')
    expect(miniature.inputSchema).toMatchObject({ required: ['prompt'], properties: { prompt: { type: 'string' } } })
    for (const skill of skills.skills) {
      expect(await service.installSkill(skill.slug), `Install ${skill.slug}`).toMatchObject({ installed: true, version: skill.version })
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
}, 120_000)
