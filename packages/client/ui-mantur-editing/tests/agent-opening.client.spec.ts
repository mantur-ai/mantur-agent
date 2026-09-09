// @vitest-environment jsdom
/** Real Conversation assembly distinguishes live tool completion from replay and user visibility intent. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { installAgentOpening } from '../src/client/agent-opening.ts'

function call(seq: number, id: string): SessionEvent<'tool/call'> {
  return { seq: SessionSeq(seq), time: seq, type: 'tool/call', data: {
    turn: 1, step: 1, callId: id as never, name: 'open_editing_workbench', arguments: '{}',
  } }
}

function result(seq: number, id: string, sessionId = 'a', isError = false): SessionEvent<'tool/result'> {
  return { seq: SessionSeq(seq), time: seq, type: 'tool/result', data: {
    turn: 1, step: 1,
    message: { role: 'user', id: `message-${id}` as never, source: { kind: 'tool', callId: id as never }, content: [{
      type: 'tool-result', toolCallId: id as never, isError, content: [],
    }] },
    meta: { kind: 'mantur-editing-workspace', sessionId, editorUrl: 'http://127.0.0.1:5000/', directory: '/test/editing' },
  } }
}

async function setup() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const openWorkbench = vi.fn()
  runtime.ctx.provide('layout', { openWorkbench } as never)
  new UiConversation(runtime.ctx, runtime.sessions)
  let suppress!: () => void
  const feature = await runtime.mount({
    inject: ['uiConversation', 'sessions', 'layout'],
    apply: (ctx) => {
      const opening = installAgentOpening(ctx)
      suppress = opening.suppress
      opening.observe(openWorkbench)
    },
  })
  await runtime.sessions.add({ id: 'a' }, { current: true })
  const append = (event: SessionEvent) => runtime.sessions.appendEvent('a', { type: 'event', event })
  return { runtime, openWorkbench, suppress, append, feature }
}

it('opens once after successful live completion and suppresses later turns after manual collapse', async () => {
  const { append, openWorkbench, suppress } = await setup()
  await append(call(1, 'first'))
  expect(openWorkbench).not.toHaveBeenCalled()
  await append(result(2, 'first'))
  expect(openWorkbench).toHaveBeenCalledOnce()
  suppress()
  await append({ seq: SessionSeq(3), time: 3, type: 'turn/start', data: { turn: 2 } })
  await append(call(4, 'second'))
  await append(result(5, 'second'))
  expect(openWorkbench).toHaveBeenCalledOnce()
})

it('preserves a manual collapse made before the first Agent opening succeeds', async () => {
  const { append, openWorkbench, suppress } = await setup()
  await append(call(1, 'pending'))
  suppress()
  await append(result(2, 'pending'))
  expect(openWorkbench).not.toHaveBeenCalled()
})

it('opens for a successful programmatic tool dispatch without treating failures as success', async () => {
  const { append, openWorkbench } = await setup()
  const data = { rootCallId: 'program' as never, parentCallId: 'program' as never,
    subCallId: 'program:code:1' as never, name: 'open_editing_workbench', arguments: {} }
  await append({ seq: SessionSeq(1), time: 1, type: 'tool/code-dispatch-start', data })
  await append({ seq: SessionSeq(2), time: 2, type: 'tool/code-dispatch', data: { ...data, isError: true, content: [] } })
  expect(openWorkbench).not.toHaveBeenCalled()
  const second = { ...data, subCallId: 'program:code:2' as never }
  await append({ seq: SessionSeq(3), time: 3, type: 'tool/code-dispatch-start', data: second })
  await append({ seq: SessionSeq(4), time: 4, type: 'tool/code-dispatch', data: { ...second, isError: false,
    content: [{ type: 'text', text: JSON.stringify({ sessionId: 'a', editorUrl: 'http://127.0.0.1:5000/', directory: '/test/editing' }) }],
  } })
  expect(openWorkbench).toHaveBeenCalledOnce()
})

it('does not open failed or mismatched Session results and still accepts a later real success', async () => {
  const { append, openWorkbench } = await setup()
  await append(call(1, 'failed'))
  await append(result(2, 'failed', 'a', true))
  await append(call(3, 'mismatch'))
  await append(result(4, 'mismatch', 'b'))
  expect(openWorkbench).not.toHaveBeenCalled()
  await append(call(5, 'success'))
  await append(result(6, 'success'))
  expect(openWorkbench).toHaveBeenCalledOnce()
})

it('ignores replaced and prepended completed calls, including an older start arriving after its result', async () => {
  const { runtime, append, openWorkbench } = await setup()
  await runtime.sessions.replaceEvents('a', [{ type: 'event', event: result(4, 'history') }], true)
  await runtime.sessions.prependEvents('a', [{ type: 'event', event: call(3, 'history') }], true)
  await runtime.sessions.prependEvents('a', [
    { type: 'event', event: call(1, 'older') }, { type: 'event', event: result(2, 'older') },
  ])
  expect(openWorkbench).not.toHaveBeenCalled()
  await append(call(5, 'live'))
  await append(result(6, 'live'))
  expect(openWorkbench).toHaveBeenCalledOnce()
})

it('does not reopen on selection return and gives a new Session its own first live opening', async () => {
  const { runtime, append, openWorkbench, suppress, feature } = await setup()
  await append(call(1, 'a'))
  await append(result(2, 'a'))
  suppress()
  await runtime.sessions.add({ id: 'b' }, { current: true })
  await runtime.sessions.appendEvent('b', { type: 'event', event: call(1, 'b') })
  await runtime.sessions.appendEvent('b', { type: 'event', event: result(2, 'b', 'b') })
  expect(openWorkbench).toHaveBeenCalledTimes(2)
  await runtime.sessions.setCurrent('a')
  await append({ seq: SessionSeq(3), time: 3, type: 'turn/start', data: { turn: 2 } })
  expect(openWorkbench).toHaveBeenCalledTimes(2)
  await feature.dispose()
  await append(call(4, 'disposed'))
  await append(result(5, 'disposed'))
  expect(openWorkbench).toHaveBeenCalledTimes(2)
})

it('does not replay a background completion when returning to that Session', async () => {
  const { runtime, append, openWorkbench } = await setup()
  await append(call(1, 'background'))
  await runtime.sessions.add({ id: 'b' }, { current: true })
  await append(result(2, 'background'))
  expect(openWorkbench).not.toHaveBeenCalled()
  await runtime.sessions.setCurrent('a')
  await append({ seq: SessionSeq(3), time: 3, type: 'turn/start', data: { turn: 2 } })
  expect(openWorkbench).not.toHaveBeenCalled()
  await append(call(4, 'foreground'))
  await append(result(5, 'foreground'))
  expect(openWorkbench).toHaveBeenCalledOnce()
})

it('rejects invalid result metadata without opening a panel', async () => {
  const { append, openWorkbench } = await setup()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => error.mockRestore())
  await append(call(1, 'invalid'))
  const invalid = result(2, 'invalid', '')
  await append(invalid)
  expect(error).toHaveBeenCalledOnce()
  expect(openWorkbench).not.toHaveBeenCalled()
})
