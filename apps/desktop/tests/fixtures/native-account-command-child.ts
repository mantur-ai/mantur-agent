/** Test-only real Loader composition controlled through non-secret fixture IPC. */
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { z } from 'zod'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-authorization-manturhub'
import type {} from '@deepseek-ai/dsh-command-scopes'
import type {} from '@deepseek-ai/dsh-shell'

const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init'), id: z.string(), config: z.object({ origin: z.url() }) }),
  z.strictObject({ kind: z.literal('command'), id: z.string(), command: z.string(), env: z.record(z.string(), z.string()).optional() }),
  z.strictObject({ kind: z.literal('cancel'), id: z.string(), scope: z.string() }),
  z.strictObject({ kind: z.literal('status'), id: z.string() }),
  z.strictObject({ kind: z.literal('close'), id: z.string() }),
  z.strictObject({ kind: z.literal('dispose'), id: z.string() }),
  z.strictObject({ kind: z.literal('terminal-open'), id: z.string() }),
  z.strictObject({ kind: z.literal('terminal-send'), id: z.string(), sessionId: z.string(), text: z.string() }),
])
let ctx: Awaited<ReturnType<typeof boot>> | undefined
let terminalOwner: Agent | undefined
let disposed = false
const commands = new Map<string, AbortController>()

async function run(input: z.infer<typeof inputSchema>): Promise<unknown> {
  if (input.kind === 'init') {
    const configPath = process.argv[2]
    if (configPath === undefined || ctx !== undefined) throw new Error('Invalid fixture initialization')
    process.env.MANTUR_COMMAND_TEST_ORIGIN = input.config.origin
    ctx = await boot('native-command-fixture', resolveConfigPath(configPath, undefined))
    const id = SessionId('native-command-fixture')
    const session = Session.create(id)
    // Only the idle agent owner is a fixture; Loader, terminal registry, backend and OS processes are real.
    terminalOwner = { id, options: {}, session, ctx: ctx.plugin(() => {}).ctx, status: 'idle',
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel: () => {},
      runMaintenance: task => task(new AbortController().signal), whenIdle: async () => {} }
    ctx.agents.register(terminalOwner)
    return {}
  }
  if (ctx === undefined) throw new Error('Fixture is not initialized')
  if (input.kind === 'status') return await ctx.manturAccount.status()
  if (input.kind === 'close') {
    if (!disposed) { await ctx.commandScopes.stopAll(); await ctx.fiber.dispose(); disposed = true }
    return {}
  }
  if (input.kind === 'dispose') { await ctx.fiber.dispose(); disposed = true; return {} }
  if (input.kind === 'cancel') { commands.get(input.scope)?.abort(); return {} }
  if (input.kind === 'terminal-open' || input.kind === 'terminal-send') {
    if (terminalOwner === undefined) throw new Error('Terminal owner is not initialized')
    if (input.kind === 'terminal-open') return await ctx.terminals.spawn(terminalOwner, { type: 'shell' })
    return await ctx.terminals.startSend(terminalOwner, TerminalSessionId(input.sessionId), { text: input.text, submit: true }).done
  }
  const abort = new AbortController()
  commands.set(input.id, abort)
  try {
    return await ctx.shell.run(ctx.shell.resolve({ command: input.command, env: input.env,
      signal: abort.signal, timeoutMs: 10_000 }))
  } finally { commands.delete(input.id) }
}

process.on('message', (value) => {
  const parsed = inputSchema.safeParse(value)
  if (!parsed.success) return
  void run(parsed.data).then(
    (result) => { process.send?.({ type: 'fixture:reply', id: parsed.data.id, ok: true, result }) },
    () => { process.send?.({ type: 'fixture:reply', id: parsed.data.id, ok: false }) },
  )
})
process.send?.({ type: 'fixture:ready' })
