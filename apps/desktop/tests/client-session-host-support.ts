/** Real gateway fixture for the client-session Main/child protocol. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { onTestFinished } from 'vitest'

/** @param api - business response owner. @returns an isolated gateway and callback browser. */
export async function clientSessionHostBackend(api: (request: IncomingMessage, response: ServerResponse) => void) {
  const observed: Array<{
    path: string | undefined
    authorization: string | undefined
    apiKey: string | string[] | undefined
    client: string | string[] | undefined
  }> = []
  let redirect = '', state = '', origin = ''
  const server = createServer((request, response) => {
    const reply = (data: unknown): void => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ code: 0, data })) }
    if (request.url?.startsWith('/api/auth/') || request.url?.startsWith('/api/agent/v1/api-keys')) {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        if (request.url?.endsWith('/sessions')) {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { redirectUri: string; state: string }
          redirect = body.redirectUri; state = body.state
          reply({ flow: 'LOOPBACK', sessionId: 'session-1', authorizeUrl: origin + '/auth/client-authorize?session=session-1', expiresIn: 600 })
        } else if (request.url?.endsWith('/token') || request.url?.endsWith('/refresh')) {
          reply({ accessToken: 'account-access', refreshToken: 'account-refresh', expiresIn: 86400, userId: 'user-1', nickname: 'Test' })
        } else if (request.url === '/api/agent/v1/api-keys' && request.method === 'POST') {
          reply({ id: 'key-1', plainSecret: 'broker-key', expiresAt: new Date(Date.now() + 86400000).toISOString() })
        } else reply({})
      })
      return
    }
    observed.push({ path: request.url, authorization: request.headers.authorization, apiKey: request.headers['x-api-key'], client: request.headers['x-mantur-client'] })
    api(request, response)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected fixture port')
  origin = 'http://127.0.0.1:' + String(address.port)
  onTestFinished(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }) })
  return { origin, observed, bearer: () => 'broker-key', password: 'account-refresh',
    openBrowser: async (_url: string): Promise<void> => { await fetch(redirect + '?' + new URLSearchParams({ state, code: 'authorization-code' }).toString()) } }
}
