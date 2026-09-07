/** Real controller activation and loopback streaming; no native OS or production-backend acceptance. */
import { request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { nativeBrokerBench, nativeBrokerHeaders, nativeBrokerScope } from './native-account-broker-support.ts'

describe('Main command broker transport', () => {
  it('binds a local capability to the activated device, streams both directions and strips caller/provider authentication headers', async () => {
    const b = await nativeBrokerBench((request, response) => {
      expect(request.headers.cookie).toBeUndefined()
      expect(request.headers['proxy-authorization']).toBeUndefined()
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        response.writeHead(201, { 'Content-Type': 'application/octet-stream', 'Set-Cookie': 'must-not-leave-main',
          Authorization: 'must-not-leave-main', 'Content-Length': Buffer.concat(chunks).length })
        response.end(Buffer.concat(chunks))
      })
    })
    const scope = await nativeBrokerScope(b.broker)
    const response = await fetch(`${scope.descriptor.proxy_origin}/api/v1/echo?keep=1`, {
      method: 'POST', body: 'binary request body', headers: { ...nativeBrokerHeaders(scope.descriptor), Cookie: 'caller-cookie',
        'X-API-Key': 'ambient-not-used', 'Proxy-Authorization': 'caller-proxy', 'X-Mantur-Client': 'caller-client' },
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('authorization')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('binary request body')
    expect(b.observed).toEqual([{ path: '/api/v1/echo?keep=1', authorization: `Bearer ${String(b.bearer())}`, apiKey: undefined, client: 'cli' }])
    expect(scope.descriptor.bridge_secret).not.toBe(b.bearer())
    expect(JSON.stringify(scope.descriptor)).not.toContain(b.bearer())
    expect(Date.parse(scope.descriptor.expires_at)).toBeLessThanOrEqual(Date.parse(b.expiry))
    scope.release()
    await scope.done
    const stale = await fetch(`${scope.descriptor.proxy_origin}/api/v1/echo`, { headers: nativeBrokerHeaders(scope.descriptor) })
    expect(stale.status).toBe(401)
    expect(await stale.json()).toMatchObject({ error: 'MANTUR_BROKER_SIGNED_OUT' })
    expect(b.observed).toHaveLength(1)
  })

  it('rejects raw traversal, non-API and absolute targets before issuing an upstream request', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end('unexpected') })
    const scope = await nativeBrokerScope(b.broker)
    for (const path of ['/api/v1/../secret', '/api/v1/%2e%2e/secret', '/api/v1/%252e/secret', '/api/v1/%2fsecret',
      '//other.invalid/api/v1/me', 'https://other.invalid/api/v1/me', '/auth/agent', '/api/v1/x#secret']) {
      const result = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(scope.descriptor.proxy_origin, { path, headers: nativeBrokerHeaders(scope.descriptor) }, (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode) })
        })
        request.on('error', reject)
        request.end()
      })
      expect(result, path).toBe(400)
    }
    expect(b.observed).toEqual([])
  })

  it('rejects browser-origin, foreign Host and unknown capability requests without forwarding', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end('unexpected') })
    const scope = await nativeBrokerScope(b.broker)
    for (const extra of [{ Origin: 'https://other.invalid' }, { Host: 'other.invalid' }, { Authorization: 'Bearer unknown' }]) {
      // Native fetch normalizes Host; the negative control must send the hostile header on the wire.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${scope.descriptor.proxy_origin}/api/v1/me`, {
          headers: { ...nativeBrokerHeaders(scope.descriptor), ...extra },
        }, (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode) })
        })
        request.on('error', reject)
        request.end()
      })
      expect([400, 401]).toContain(status)
    }
    expect(b.observed).toEqual([])
  })

  it('does not follow an upstream redirect, retry a mutation or report the transport error as expiry', async () => {
    const redirected = vi.fn()
    const b = await nativeBrokerBench((request, response) => {
      if (request.url === '/api/v1/redirected') redirected()
      request.resume()
      request.on('end', () => { response.writeHead(307, { Location: '/api/v1/redirected' }).end() })
    })
    const scope = await nativeBrokerScope(b.broker)
    const response = await fetch(`${scope.descriptor.proxy_origin}/api/v1/start`, {
      method: 'POST', body: 'once', headers: nativeBrokerHeaders(scope.descriptor),
    })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'MANTUR_BROKER_UPSTREAM_UNAVAILABLE' })
    expect(b.observed).toHaveLength(1)
    expect(redirected).not.toHaveBeenCalled()
  })

  it('aborts a partial response on logout but waits for the command owner before reporting local quiescence', async () => {
    const bodyClosed = Promise.withResolvers<undefined>()
    const b = await nativeBrokerBench((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('first chunk')
      response.on('close', () => { bodyClosed.resolve(undefined) })
    })
    const scope = await nativeBrokerScope(b.broker)
    const response = await fetch(`${scope.descriptor.proxy_origin}/api/v1/slow`, { headers: nativeBrokerHeaders(scope.descriptor) })
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('Expected broker stream')
    expect((await reader.read()).done).toBe(false)
    const rejected = expect(reader.read()).rejects.toThrow()
    const settled = vi.fn()
    const signingOut = b.controller.signOut().then(settled)
    expect(scope.signal.aborted).toBe(true)
    await bodyClosed.promise
    await rejected
    expect(settled).not.toHaveBeenCalled()
    const denied = await fetch(`${scope.descriptor.proxy_origin}/api/v1/late`, { headers: nativeBrokerHeaders(scope.descriptor) })
    expect(denied.status).toBe(401)
    await denied.body?.cancel()
    scope.release()
    await expect(scope.done).rejects.toMatchObject({ name: 'AbortError' })
    await signingOut
    expect(settled).toHaveBeenCalledOnce()
    expect(b.observed).toHaveLength(1)
    reader.releaseLock()
  })

  it('propagates a local body disconnect upstream without ending the enclosing command scope', async () => {
    const bodyClosed = Promise.withResolvers<undefined>()
    const b = await nativeBrokerBench((_request, response) => {
      response.write('first chunk')
      response.on('close', () => { bodyClosed.resolve(undefined) })
    })
    const scope = await nativeBrokerScope(b.broker)
    const response = await fetch(`${scope.descriptor.proxy_origin}/api/v1/slow`, { headers: nativeBrokerHeaders(scope.descriptor) })
    await response.body?.cancel()
    await bodyClosed.promise
    expect(scope.signal.aborted).toBe(false)
  })

  it('denies an expired absolute lease without renewing it', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end('unexpected') })
    const scope = await nativeBrokerScope(b.broker)
    b.now.value = Date.parse(scope.descriptor.expires_at)
    const response = await fetch(`${scope.descriptor.proxy_origin}/api/v1/me`, { headers: nativeBrokerHeaders(scope.descriptor) })
    expect(await response.json()).toMatchObject({ error: 'MANTUR_BROKER_SESSION_EXPIRED' })
    expect(b.observed).toEqual([])
  })

  it('closes its listener and awaits an accepted command cleanup barrier', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end('unused') })
    const scope = await nativeBrokerScope(b.broker)
    const settled = vi.fn()
    const closing = b.broker.close().then(settled)
    expect(scope.signal.aborted).toBe(true)
    expect(() => b.broker.run(new AbortController().signal, async () => {})).toThrow('closed')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    scope.release()
    await expect(scope.done).rejects.toMatchObject({ name: 'AbortError' })
    await closing
    await expect(fetch(`${scope.descriptor.proxy_origin}/api/v1/me`, { headers: nativeBrokerHeaders(scope.descriptor) })).rejects.toThrow()
  })
})
