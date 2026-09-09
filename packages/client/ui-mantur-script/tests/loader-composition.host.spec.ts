/** Real Loader composition exercises script tools over real project files. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Llm from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import Script from '../src/index.ts'

it('loads, executes, and disposes the script plugin from cordis.yml', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-script-loader-'))
  const ctx = new Context()
  try {
    await writeFile(join(root, '01.md'), '# 第一集\n重复\n重复\n')
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-typert-registry', Typert], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-agent', Agents], ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-session', Sessions], ['@deepseek-ai/dsh-session-projection', Projections], ['@deepseek-ai/dsh-llm', Llm],
      ['@deepseek-ai/dsh-tools', Tools], ['@deepseek-ai/dsh-fs-local', FileSystem], ['@deepseek-ai/dsh-client-ui-mantur-script', Script],
    ])
    const config = join(root, 'cordis.yml')
    await writeFile(config, [
      "- name: '@deepseek-ai/dsh-typert-registry'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      '  config: { includeHarnessIdentity: false }',
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-agent-loop'",
      '  config: { agents: [] }',
      "- name: '@deepseek-ai/dsh-fs-local'",
      `  config: ${JSON.stringify({ cwd: root })}`,
      "- name: '@deepseek-ai/dsh-client-ui-mantur-script'",
      '  config: { maxBytes: 4096, maxEntries: 20 }', '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error(`Unexpected plugin ${name}`)
      return modules.get(name)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    const responses: StreamChunk[][] = []
    ctx.llm.registerAdapter(['mock'], new MockAdapter(responses))
    const handle = await ctx.agents.create({
      sessionId: SessionId('script-main-agent'), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'mock' },
    })
    const agent = handle.agent
    const document = await ctx.manturScript.read(agent, '01.md')
    const start = document.content.lastIndexOf('重复')
    const selection = { path: document.path, version: document.version, start, end: start + 2, selected: '重复' }
    const request = JSON.stringify({ ...selection, instruction: '只改第二处' })
    responses.push(toolCallResponse('loader-selection', 'replace_script_selection', { ...selection, replacement: '只改第二处' }), textResponse('已修改第二处。'))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: request }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    expect(events.find(event => event.type === 'user/message')?.data).toMatchObject({ content: [{ type: 'text', text: request }] })
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'replace_script_selection')).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && event.data.error === undefined)).toBe(true)
    expect(await readFile(join(root, '01.md'), 'utf8')).toBe('# 第一集\n重复\n只改第二处\n')
    expect(ctx.tools.schemas(agent).find(tool => tool.name === 'replace_script_selection')).toMatchSnapshot()
    const entry = [...ctx.loader.entries()].find(item => item.options.name === '@deepseek-ai/dsh-client-ui-mantur-script')
    await entry!.fiber!.dispose()
    expect(ctx.get('manturScript')).toBeUndefined()
    expect(ctx.tools.schemas(agent).some(tool => tool.name === 'replace_script_selection')).toBe(false)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
