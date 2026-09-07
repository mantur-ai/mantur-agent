/** Mantur product layer composition and model-visible identity. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt, { renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as ManturApp from '../src/index.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))

function patches(path: string): PatchOptions[] {
  const value = yaml.load(readFileSync(resolve(root, path), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(value)) throw new Error(`${path} must contain a patch list`)
  return value as PatchOptions[]
}

function composedRows() {
  const warnings = vi.fn()
  let rows = applyEntryPatches([], patches('bundle/base/cordis.patch.yml'), warnings)
  rows = applyEntryPatches(rows, patches('bundle/web-app/cordis.patch.yml'), warnings)
  rows = applyEntryPatches(rows, patches('bundle/mantur-app/cordis.patch.yml'), warnings)
  expect(warnings).not.toHaveBeenCalled()
  return rows
}

describe('dsh-mantur-app bundle', () => {
  it.each([
    [undefined, 'none', 'standalone'],
    ['1', 'required', 'desktop-managed'],
  ])('evaluates identity configuration with native account flag %s', (flag, commands, account) => {
    const rows = composedRows()
    const context = { process: { env: { DSH_MANTUR_NATIVE_ACCOUNT: flag } } }
    expect(interpolate(context, rows.find(row => row.id === 'command-scopes')?.config))
      .toEqual({ identity: commands })
    expect(interpolate(context, rows.find(row => row.id === 'mantur-account')?.config))
      .toMatchObject({ identity: account, native: flag === '1' ? { environmentLabel: 'ManturHub' } : undefined })
  })

  it('replaces the Web product identity without changing model and permission controls', () => {
    const rows = composedRows()
    const row = (id: string) => rows.find(candidate => candidate.id === id)
    expect(row('ui-brand-official')?.disabled).toBe(true)
    expect(row('ui-brand-mantur')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-brand-mantur',
    })
    expect(row('ui-mantur-navigation')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-mantur-navigation',
    })
    expect(row('authorization')).toMatchObject({ name: '@deepseek-ai/dsh-authorization' })
    expect(row('mantur-account')).toMatchObject({ name: '@deepseek-ai/dsh-authorization-manturhub' })
    expect(row('mantur-projects')).toMatchObject({ name: '@deepseek-ai/dsh-mantur-projects' })
    expect(row('ui-workspace')?.config).toMatchObject({ newSessionWorkspace: 'explicit' })
    expect(row('ui-mantur-account')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-mantur-account' })
    expect(row('mantur-identity')).toMatchObject({
      name: '@deepseek-ai/dsh-mantur-app',
    })
    expect(row('ui-agent-preset')?.disabled).toBe(true)
    expect(row('ui-plan')?.disabled).toBe(true)
    expect(row('ui-model-selection')?.disabled).not.toBe(true)
    expect(row('ui-permission')?.disabled).not.toBe(true)
    expect(row('ui-settings-models')?.disabled).not.toBe(true)
    expect(row('web-runtime')?.config).toMatchObject({ surfaceContext: false, printUrl: true })
  })

  it('assembles only the complete Mantur persona as the product identity', async () => {
    const rows = composedRows()
    const systemPromptConfig = rows.find(row => row.id === 'system-prompt')?.config as {
      includeHarnessIdentity: boolean
      persona: string
    } | undefined
    const manturConfig = rows.find(row => row.id === 'mantur-identity')?.config as ManturApp.Config | undefined
    expect(systemPromptConfig).toBeDefined()
    expect(manturConfig).toBeDefined()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, systemPromptConfig)
    await ctx.plugin(ManturApp, manturConfig)
    ctx.systemPrompt.variable('cwd', () => '/work')
    ctx.systemPrompt.section({ name: 'product:guidance', order: 100, text: 'Keep the project organized.' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(section => section.name)).toEqual(['deployment:persona', 'product:guidance'])
    expect(renderPrompt(assembly)).toMatchInlineSnapshot(`
      "你是漫途Agent，由漫途（Mantur）打造，专门在用户电脑本地完成漫剧创作与生产。你的职责是围绕漫剧项目完成故事构思、剧本、分镜、视觉素材、音频、剪辑方案和制作交付。你应使用当前本地工作区与可用工具直接推进制作，在获得必要授权后执行本地操作，并保持项目文件清晰有序。你的工作目录是 /work。\n\nKeep the project organized."
    `)
    await ctx.fiber.dispose()
  })

  it('adds the Mantur persona when the delegated assembly has no persona section', async () => {
    let transform: ((
      assembly: PromptAssembly,
      context: unknown,
      next: () => Promise<PromptAssembly>,
    ) => Promise<PromptAssembly>) | undefined
    const ctx = {
      on: (_event: string, listener: typeof transform) => { transform = listener },
    } as unknown as Context
    ManturApp.apply(ctx, { persona: 'Mantur persona.' })
    const delegated: PromptAssembly = {
      sections: [{ name: 'product:guidance', text: 'Keep the project organized.' }],
      contexts: [],
      tools: [],
      variables: {},
    }

    const assembly = await transform!(delegated, {}, () => Promise.resolve(delegated))

    expect(assembly.sections).toEqual([
      { name: 'deployment:persona', text: 'Mantur persona.' },
      { name: 'product:guidance', text: 'Keep the project organized.' },
    ])
  })
})
