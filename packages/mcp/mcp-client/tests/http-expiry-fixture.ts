/** Stateful HTTP fixture exposing real MCP initialization and expired-session responses. */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export async function startExpiryFixture() {
  const sessions = new Map<string, StreamableHTTPServerTransport>()
  const servers: McpServer[] = []
  const initialized: Array<{ id: string; requestId: string | undefined }> = []
  const calls: string[] = []
  const initializeRequests: Array<string | undefined> = []
  let callsReleased: Promise<void> = Promise.resolve()
  let initializeReleased: Promise<void> = Promise.resolve()
  const failures = new Map<string, number | 'rpc' | 'tool'>()
  let initializeStatus: number | undefined
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const id = req.headers['mcp-session-id'] as string | undefined
    const chunks: Buffer[] = []
    for await (const chunk of req as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString()
    const body = raw === '' ? undefined : JSON.parse(raw) as { method?: string; id?: number }
    if (body?.method === 'initialize') {
      initializeRequests.push(id)
      await initializeReleased
      if (initializeStatus !== undefined) { res.writeHead(initializeStatus).end(); return }
      const mcp = new McpServer({ name: 'expiry-fixture', version: '1.0.0' })
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized(sessionId) {
          sessions.set(sessionId, transport)
          initialized.push({ id: sessionId, requestId: id })
        },
      })
      mcp.registerTool('mutate', { description: 'Record one explicit call.', inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'mutation saved' }],
        ...failures.get(transport.sessionId!) === 'tool' ? { isError: true } : {},
      }))
      servers.push(mcp)
      await mcp.connect(transport as Transport)
      await transport.handleRequest(req, res, body)
      return
    }
    if (body?.method === 'tools/call' && id !== undefined) {
      calls.push(id)
      await callsReleased
    }
    const failure = id === undefined ? undefined : failures.get(id)
    if (body?.method === 'tools/call' && failure !== undefined && failure !== 'tool') {
      res.writeHead(typeof failure === 'number' ? failure : 200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'Session is unavailable' } }))
      return
    }
    const transport = id === undefined ? undefined : sessions.get(id)
    if (transport === undefined) { res.writeHead(404).end(); return }
    await transport.handleRequest(req, res, body)
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => { res.writeHead(500).end(String(error)) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture did not bind TCP')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, initialized, initializeRequests, calls, failures,
    holdCalls(until: Promise<void>) { callsReleased = until },
    holdInitializations(until: Promise<void>) { initializeReleased = until },
    failInitialize(status: number) { initializeStatus = status },
    async close() {
      await Promise.all(servers.map(mcp => mcp.close()))
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
        server.closeAllConnections()
      })
    },
  }
}
