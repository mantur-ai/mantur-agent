import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { expect, it } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'

it('persists disabled skills, rejects body loads, and restores access when reenabled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mantur-switches-'))
  const contexts: Context[] = []
  const boot = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'example', title: '示例技能', description: 'Test skill', source: 'custom', content: 'Instructions' })
    const service = new ManturHubMarketplace(ctx, { dshHome: home })
    return { ctx, service }
  }
  try {
    const first = await boot()
    expect(await first.service.installedSkills()).toMatchObject([{ name: 'example', enabled: true }])
    let changes = 0
    first.ctx.on('skills/change', () => { changes += 1 })
    await first.service.setSkillEnabled('example', false)
    expect(changes).toBe(1)
    expect(await first.ctx.skills.list()).toMatchObject([{ invocation: { modelInvocable: false, userInvocable: false } }])
    expect(await first.ctx.skills.get('example')).toBeUndefined()
    const restarted = await boot()
    expect(await restarted.service.installedSkills()).toMatchObject([{ name: 'example', enabled: false }])
    expect(await restarted.ctx.skills.get('example')).toBeUndefined()
    await restarted.service.setSkillEnabled('example', true)
    expect(await restarted.ctx.skills.get('example')).toMatchObject({ content: 'Instructions' })
    restarted.ctx.skills.register({ name: 'builtin', description: 'Bundled', source: 'bundled', content: 'Body' })
    expect(await restarted.service.installedSkills()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'builtin', source: 'bundled' })]))
    await expect(restarted.service.setSkillEnabled('unknown', false)).rejects.toThrow('not installed')
    await expect(restarted.service.setSkillEnabled('../example', false)).rejects.toThrow('Invalid skill')
  } finally {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
