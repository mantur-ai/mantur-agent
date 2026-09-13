/** Retire loopback authentication cookies before a new desktop Host connects. */
import type { Cookies } from 'electron'

/**
 * Remove only root-scoped Harness cookies from this desktop profile's loopback host.
 * Cookies span ports, so random-port restarts otherwise grow every subsequent request header.
 * @param cookies - Cookie store owned by the desktop window.
 * @returns number of removed local connection cookies; failures reject before navigation.
 */
export async function clearDesktopConnectionCookies(cookies: Pick<Cookies, 'get' | 'remove'>): Promise<number> {
  const entries = await cookies.get({ domain: '127.0.0.1' })
  const owned = entries.filter(cookie => cookie.domain === '127.0.0.1' && cookie.path === '/'
    && /^dsh-auth-[A-Za-z0-9_-]{43}$/u.test(cookie.name))
  await Promise.all(owned.map(cookie => cookies.remove('http://127.0.0.1/', cookie.name)))
  return owned.length
}
