import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as host from '../src/index.ts'

// This ordinary Client package compiles its settings-only Host entry in the Client program.
class MemorySettings extends SettingsProvider {
  readonly writable = false

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  protected persist(): Promise<void> {
    return Promise.reject(new Error('Test settings are read-only'))
  }
}

describe('editing host settings', () => {
  it('publishes a normalized local address and removes its namespace on unload', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(host, { editorUrl: 'http://localhost:5299' })
    await fiber.await()
    expect(ctx.settings.describe()).toMatchObject([{
      ns: 'ui-mantur-editing', value: { editorUrl: 'http://localhost:5299/' },
    }])
    await fiber.dispose()
    expect(ctx.settings.describe()).toEqual([])
  })

  it('rejects missing configuration and non-local addresses before publishing settings', async () => {
    expect(() => host.Config({} as host.Config)).toThrow()
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(MemorySettings).await()
    expect(() => { host.apply(ctx, { editorUrl: 'https://example.com/' }) }).toThrow('loopback HTTP')
    expect(ctx.settings.describe()).toEqual([])
  })
})
