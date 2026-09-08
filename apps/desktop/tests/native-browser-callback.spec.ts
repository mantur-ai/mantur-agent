/** Loopback callback acceptance and cleanup without a browser, account or remote endpoint. */
import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { connect } from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { NativeBrowserCallback } from '../src/auth/browser-callback.ts'

const issuer = 'https://hub.mantur.cn'
const code = 'a'.repeat(43)

async function bench() {
  const abort = new AbortController()
  const state = randomBytes(32).toString('base64url')
  const callback = await NativeBrowserCallback.open({ state, issuer, signal: abort.signal, requestTimeoutMs: 1_000 })
  onTestFinished(() => callback.close())
  const url = new URL(callback.redirectUri)
  url.search = new URLSearchParams({ code, state, iss: issuer }).toString()
  return { callback, abort, url, state }
}

function rawRequest(url: URL, path: string, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { path, headers: { host }, agent: false }, (response) => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode) })
      response.once('error', reject)
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

describe('native browser callback', () => {
  it('binds an exact loopback redirect and accepts one issuer-bound code without echoing it', async () => {
    const b = await bench()
    expect(b.callback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/mantur\/callback$/u)
    const result = await fetch(b.url)
    expect(result.status).toBe(204)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.text()).toBe('')
    await expect(b.callback.code).resolves.toBe(code)
    expect((await fetch(b.url)).status).toBe(410)
    await b.callback.close()
    await expect(fetch(b.url)).rejects.toThrow()
  })

  it.each([
    'wrong-state', 'wrong-issuer', 'duplicate-state', 'duplicate-code', 'extra-key', 'bad-code',
    'wrong-path', 'post', 'wrong-origin',
  ])('rejects %s without consuming the valid callback', async (invalid) => {
    const b = await bench()
    const url = new URL(b.url)
    let options: RequestInit = {}
    switch (invalid) {
      case 'wrong-state': url.searchParams.set('state', 'b'.repeat(43)); break
      case 'wrong-issuer': url.searchParams.set('iss', 'https://hub.mantur.ai'); break
      case 'duplicate-state': url.searchParams.append('state', b.state); break
      case 'duplicate-code': url.searchParams.append('code', code); break
      case 'extra-key': url.searchParams.set('api_key', 'must-not-echo'); break
      case 'bad-code': url.searchParams.set('code', 'short'); break
      case 'wrong-path': url.pathname = '/other'; break
      case 'post': options = { method: 'POST' }; break
      case 'wrong-origin': options = { headers: { origin: 'https://other.invalid' } }; break
    }
    const response = await fetch(url, options)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
    expect((await fetch(b.url)).status).toBe(204)
    await expect(b.callback.code).resolves.toBe(code)
  })

  it('rejects a forged Host and absolute request target', async () => {
    const b = await bench()
    expect(await rawRequest(b.url, b.url.pathname + b.url.search, 'other.invalid')).toBe(400)
    expect(await rawRequest(b.url, b.url.href, b.url.host)).toBe(400)
    expect((await fetch(b.url)).status).toBe(204)
  })

  it('settles denial once without accepting a later successful callback', async () => {
    const b = await bench()
    const url = new URL(b.url)
    url.searchParams.delete('code')
    url.searchParams.set('error', 'access_denied')
    expect((await fetch(url)).status).toBe(204)
    await expect(b.callback.code).rejects.toMatchObject({ kind: 'denied' })
    expect((await fetch(b.url)).status).toBe(410)
  })

  it('closes on cancellation and rejects a late callback', async () => {
    const b = await bench()
    b.abort.abort()
    await b.callback.close()
    await expect(b.callback.code).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(fetch(b.url)).rejects.toThrow()
  })

  it('rejects an already cancelled start without opening a listener', async () => {
    await expect(NativeBrowserCallback.open({
      state: randomBytes(32).toString('base64url'), issuer,
      signal: AbortSignal.abort(), requestTimeoutMs: 1_000,
    })).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('joins a partial HTTP connection when its attempt closes', async () => {
    const b = await bench()
    const socket = connect(Number(b.url.port), '127.0.0.1')
    let reset: string | undefined
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => { resolve() })
      socket.once('error', (error: NodeJS.ErrnoException) => { reset = error.code })
    })
    onTestFinished(() => { socket.destroy() })
    await new Promise<void>(resolve => socket.once('connect', resolve))
    socket.write('GET /oauth/mantur/callback HTTP/1.1\r\n')
    b.abort.abort()
    await b.callback.close()
    await closed
    // Destroying an unfinished HTTP request may reset the peer instead of sending FIN.
    expect([undefined, 'ECONNRESET']).toContain(reset)
    await expect(b.callback.code).rejects.toMatchObject({ kind: 'cancelled' })
  })
})
