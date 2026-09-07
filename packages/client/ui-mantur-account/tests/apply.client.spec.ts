// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { AccountOnboarding } from '../src/client/AccountOnboarding.tsx'
import { AccountSection } from '../src/client/AccountSection.tsx'
import { NativeAccountOnboarding, NativeAccountSection, type NativeAccountInjected } from '../src/client/NativeAccountSurfaces.tsx'
import { apply, inject } from '../src/client/index.ts'
import { createNativeAccountDialogStore } from '../src/client/native-dialog.ts'
import type { NativeAccountDialogInjected } from '../src/client/NativeAccountDialog.tsx'
import { apply as hostApply } from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-authorization-manturhub/remote', () => ({
  default: { package: '@deepseek-ai/dsh-authorization-manturhub', descriptors: [] },
}))

afterEach(() => { vi.unstubAllGlobals() })

async function bench(mode: 'standalone' | 'desktop-managed' = 'standalone', available = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx, {
    manturAccount: {
      identityMode: vi.fn(() => Promise.resolve(available
        ? { ok: true, value: mode }
        : { ok: false, error: { code: 'gateway/internal', message: 'unavailable' } })),
      status: vi.fn(() => Promise.resolve({
        ok: true,
        value: { status: 'signed-out' },
      })),
      startLogin: vi.fn(),
      loginProgress: vi.fn(),
      cancelLogin: vi.fn(),
      signOut: vi.fn(),
    },
  })
  remote.$mount = vi.fn(() => Promise.resolve(() => Promise.resolve()))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, locale }
}

describe('ui-mantur-account apply', () => {
  it('registers one native dialog owner, preserves another modal and releases its pending request on unload', async () => {
    let revision = 0
    const unsubscribe = vi.fn()
    const subscribe = vi.fn(() => unsubscribe)
    window.manturAccount = { invoke: async () => ({ ok: true, revision: ++revision, snapshot: {
      phase: 'signed-out', busy: false, authenticated: false, skipped: true, pendingRevocations: 0,
    } }), subscribe }
    const subject = await bench('desktop-managed')
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    try {
      await fiber.await()
      const entry = subject.slots.entries('shell.overlay')[0]!
      const view = createNativeAccountDialogStore().create()
      const props = (entry.inject as unknown as (actions: typeof view.actions) => NativeAccountDialogInjected)(view.actions)
      const onboarding = (subject.slots.entries('settings.onboarding')[0]!.inject as unknown as () => NativeAccountInjected)()
      expect(props.hooks.nativeAccount).toBe(onboarding.hooks.nativeAccount)
      document.body.append(modal)
      expect(() => subject.ctx.bail('mantur/native-account-open')).toThrow('unavailable')
      modal.remove()
      document.body.append(appRoot)
      appRoot.inert = true
      expect(() => subject.ctx.bail('mantur/native-account-open')).toThrow('unavailable')
      appRoot.inert = false
      const request = subject.ctx.bail('mantur/native-account-open')!
      expect(view.store.getSnapshot().open).toBe(true)
      expect(subject.ctx.bail('mantur/native-account-open')).toBe(request)
      await props.run({ kind: 'skip' })
      expect(await request).toBe('skipped')
      const returned = subject.ctx.bail('mantur/native-account-open')!
      props.close()
      expect(await returned).toBe('closed')
      const pending = subject.ctx.bail('mantur/native-account-open')!
      const rejected = expect(pending).rejects.toThrow('unavailable')
      await fiber.dispose()
      await rejected
      expect(subject.ctx.bail('mantur/native-account-open')).toBeUndefined()
      expect(subject.slots.entries('shell.overlay')).toEqual([])
    } finally { await fiber.dispose(); delete window.manturAccount; modal.remove(); appRoot.remove() }
    expect(subscribe).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('selects Main only from the Host mode and supplies narrow native callbacks', async () => {
    const invoke = vi.fn(async () => ({ ok: true, revision: 1, snapshot: {
      phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0,
    } }))
    const unsubscribe = vi.fn()
    window.manturAccount = { invoke, subscribe: () => unsubscribe }
    const subject = await bench('desktop-managed')
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const onboarding = subject.slots.entries('settings.onboarding')[0]!
      expect(onboarding.component).toBe(NativeAccountOnboarding)
      expect(subject.slots.entries('settings.section')[0]!.component).toBe(NativeAccountSection)
      const props = (onboarding.inject as unknown as () => NativeAccountInjected)()
      expect(resolveSlotLabel(subject.slots.entries('settings.section')[0]!.options.label)).toBe('漫途账号')
      expect(props).not.toHaveProperty('controller')
      expect(props.hooks.nativeAccount.getSnapshot().snapshot?.authenticated).toBe(false)
      expect(props.formatExpiry(1_999_999_999_999)).toBe(new Intl.DateTimeFormat('zh', { dateStyle: 'medium', timeStyle: 'short' }).format(1_999_999_999_999))
      await props.run({ kind: 'browser' })
      expect(invoke).toHaveBeenLastCalledWith({ kind: 'browser' })
    } finally { await fiber.dispose(); delete window.manturAccount }
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it.each([true, false])('shows native unavailable without a legacy fallback when identity availability is %s', async (available) => {
    const subject = await bench('desktop-managed', available)
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      const onboarding = subject.slots.entries('settings.onboarding')[0]!
      expect(onboarding.component).toBe(NativeAccountOnboarding)
      const props = (onboarding.inject as unknown as () => NativeAccountInjected)()
      expect(props.hooks.nativeAccount.getSnapshot().failure).toEqual({ kind: 'unavailable' })
    } finally { await fiber.dispose() }
  })

  it('keeps the host Loader entry inert and declares the browser services', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale', 'remote'])
  })

  it('registers login before DeepSeek setup and exposes the account Settings page', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.slots.entries('settings.onboarding')[0]).toMatchObject({
      component: AccountOnboarding,
      options: { id: 'mantur-account', order: -100 },
    })
    const onboarding = subject.slots.entries('settings.onboarding')[0]!
    const injectOnboarding = onboarding.inject as () => {
      controller: unknown
      hooks: { account: unknown }
      t: unknown
    }
    const injected = injectOnboarding()
    expect(injected.controller).toBeDefined()
    expect(injected.hooks.account).toBeDefined()
    expect(typeof injected.t).toBe('function')
    const section = subject.slots.entries('settings.section')[0]!
    expect(section).toMatchObject({
      component: AccountSection,
      options: { id: 'mantur-account', order: 5 },
    })
    expect(resolveSlotLabel(section.options.label)).toBe('漫途账号')
    expect(subject.locale.bind('settings.manturAccount')('login')).toBe('登录漫途账号')
    await fiber.dispose()
    expect(subject.slots.entries('settings.onboarding')).toEqual([])
    expect(subject.slots.entries('settings.section')).toEqual([])
  })
})
