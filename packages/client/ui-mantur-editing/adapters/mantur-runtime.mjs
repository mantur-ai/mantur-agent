/** Pinned OpenChatCut development runtime, launched and owned by Mantur's Host plugin. */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installRuntimeShutdown } from './mantur-runtime-shutdown.mjs'

const root = process.cwd()
const adapters = dirname(fileURLToPath(import.meta.url))
const parentOrigin = process.env.MANTUR_CUT_PARENT_ORIGIN
if (!parentOrigin) throw new Error('Missing Mantur parent origin')
const acquisition = (async () => {
  const { createServer } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href)
  return createServer({
  root, configFile: join(root, 'config/vite.config.ts'),
  plugins: [{
    name: 'mantur-cut-host',
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module' }, injectTo: 'head-prepend',
      children: `import { installManturTheme } from ${JSON.stringify(`/@fs${adapters}/openchatcut-theme.mjs`)}; installManturTheme(window, ${JSON.stringify(parentOrigin)});`,
    }],
  }],
  server: { host: '127.0.0.1', port: 0, open: false, fs: { allow: [root, adapters] } },
})
})()
installRuntimeShutdown({
  drain: async () => {
    const server = await acquisition
    const owner = server.httpServer?.manturShutdown
    if (!owner || typeof owner.stopForShutdown !== 'function') throw new Error('Editor does not expose its authoritative shutdown owner')
    await owner.stopForShutdown()
  },
  close: async () => {
    const server = await acquisition
    const owner = server.httpServer?.manturShutdown
    if (!owner || typeof owner.finishTransportShutdown !== 'function') throw new Error('Editor does not expose its transport shutdown owner')
    await owner.finishTransportShutdown()
    await server.close()
  },
})
const server = await acquisition
// Vite treats port 0 as its default port. Bind the exposed HTTP server directly
// so concurrent Session runtimes receive distinct OS-assigned ports.
await new Promise((resolve, reject) => {
  server.httpServer.once('error', reject)
  server.httpServer.listen(0, '127.0.0.1', resolve)
})
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Editor did not bind a TCP port')
server.config.server.port = address.port
server.config.inlineConfig.server.port = address.port
server.resolvedUrls = { local: [`http://127.0.0.1:${address.port}/`], network: [] }
process.send({ type: 'mantur-cut:ready', port: address.port })
