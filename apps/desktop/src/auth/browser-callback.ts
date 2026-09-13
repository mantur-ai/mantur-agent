/** One pending browser authorization callback, bound to a loopback listener and an issuer. */
import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

/** Fixed local failures never include a callback URL, authorization code or transport exception. */
export class NativeBrowserCallbackFailure extends Error {
  /** @param kind - callback rejection or cancellation category. */
  constructor(readonly kind: 'cancelled' | 'denied' | 'listener') {
    super('Browser authorization callback failed: ' + kind)
  }
}

/** Main-owned values for one attempt; the signal also covers expiry and application shutdown. */
export interface NativeBrowserCallbackOptions {
  readonly state: string
  readonly issuer: string
  readonly signal: AbortSignal
  readonly requestTimeoutMs: number
}

/** Owns the listening socket until Main finishes exchange or cancels the attempt. */
export class NativeBrowserCallback {
  private readonly server: Server
  private readonly outcome = Promise.withResolvers<string>()
  private accepted = false
  private closed: Promise<void> | undefined
  private redirect = ''

  private constructor(private readonly options: NativeBrowserCallbackOptions) {
    this.server = createServer({ maxHeaderSize: 4_096 }, (request, response) => {
      const reject = (status: number): void => {
        response.writeHead(status, { 'Cache-Control': 'no-store', Connection: 'close' })
        response.end()
      }
      if (this.accepted || options.signal.aborted || this.closed !== undefined) { reject(410); return }
      if (request.method !== 'GET' || request.headers.host !== new URL(this.redirect).host
        || request.socket.remoteAddress !== '127.0.0.1') { reject(400); return }
      const raw = request.url
      if (raw === undefined || !raw.startsWith('/oauth/mantur/callback?') || raw.length > 2_048) { reject(400); return }
      let url: URL
      try { url = new URL(raw, this.redirect) } catch { reject(400); return }
      const values = url.searchParams
      const state = values.get('state')
      const code = values.get('code')
      const denied = values.get('error') === 'access_denied'
      const keys = denied ? ['error', 'state', 'iss'] : ['code', 'state', 'iss']
      const origin = request.headers.origin
      if (url.pathname !== '/oauth/mantur/callback' || url.hash !== '' || values.size !== keys.length
        || keys.some(key => values.getAll(key).length !== 1)
        || values.get('iss') !== options.issuer
        || (origin !== undefined && origin !== options.issuer)
        || state === null || Buffer.byteLength(state) !== Buffer.byteLength(options.state)
        || !timingSafeEqual(Buffer.from(state), Buffer.from(options.state))) {
        reject(400)
        return
      }
      if (denied) this.outcome.reject(new NativeBrowserCallbackFailure('denied'))
      else {
        if (code === null || !/^[A-Za-z0-9_-]{43}$/u.test(code)) { reject(400); return }
        this.outcome.resolve(code)
      }
      this.accepted = true
      response.writeHead(204, {
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', Connection: 'close',
      })
      response.end()
    })
    this.server.requestTimeout = options.requestTimeoutMs
    this.server.headersTimeout = options.requestTimeoutMs
    this.server.on('error', () => {
      this.outcome.reject(new NativeBrowserCallbackFailure('listener'))
      void this.close()
    })
    // Main may still be awaiting the create receipt when the callback settles.
    void this.outcome.promise.catch(() => {})
  }

  /**
   * Bind a fresh OS-assigned IPv4 loopback port before registering the exact redirect with the issuer.
   * @param options - attempt binding and resource lifetime, never renderer input.
   * @returns listener whose code is untrusted until the issuer verifies PKCE during exchange.
   */
  static async open(options: NativeBrowserCallbackOptions): Promise<NativeBrowserCallback> {
    if (options.signal.aborted) throw new NativeBrowserCallbackFailure('cancelled')
    const callback = new NativeBrowserCallback(options)
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (): void => { reject(new NativeBrowserCallbackFailure('listener')) }
        callback.server.once('error', failed)
        callback.server.listen(0, '127.0.0.1', () => {
          callback.server.removeListener('error', failed)
          const address = callback.server.address()
          if (address === null || typeof address === 'string') { failed(); return }
          callback.redirect = 'http://127.0.0.1:' + String(address.port) + '/oauth/mantur/callback'
          resolve()
        })
      })
      options.signal.addEventListener('abort', callback.aborted, { once: true })
      if (callback.options.signal.aborted) {
        await callback.close()
        throw new NativeBrowserCallbackFailure('cancelled')
      }
      return callback
    } catch (error) {
      await callback.close()
      throw error
    }
  }

  /** Exact redirect registered for this pending attempt; never includes state or code. */
  get redirectUri(): string { return this.redirect }

  /** One accepted code; authorization still requires the issuer's token exchange. */
  get code(): Promise<string> { return this.outcome.promise }

  /** Reject unfinished callbacks and await listener closure, including idle and partial requests. */
  close(): Promise<void> {
    this.closed ??= (async () => {
      this.options.signal.removeEventListener('abort', this.aborted)
      this.outcome.reject(new NativeBrowserCallbackFailure('cancelled'))
      await new Promise<void>((resolve) => {
        this.server.close(() => { resolve() })
        this.server.closeAllConnections()
      })
    })()
    return this.closed
  }

  private readonly aborted = (): void => { void this.close() }
}
