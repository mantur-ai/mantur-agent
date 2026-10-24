import { expect, it } from 'vitest'
import { webWorkbenchUrl } from '../src/web-url.ts'

it('accepts explicit-port local workbenches while preserving route and query', () => {
  expect(webWorkbenchUrl('http://127.0.0.1:43123/project?token=example#shots')).toBe('http://127.0.0.1:43123/project?token=example#shots')
  expect(webWorkbenchUrl('http://127.0.0.1:80/project')).toBe('http://127.0.0.1/project')
})
it.each(['https://127.0.0.1:1234/', 'http://localhost:1234/', 'http://127.0.0.1/', 'http://user@127.0.0.1:1234/', 'http://127.0.0.1:0/', 'http://127.0.0.1:99999/', 'http://127.0.0.1:1234.evil.com/', 'file:///tmp/workbench.html'])('rejects unsupported URL %s', (value) => {
  expect(() => webWorkbenchUrl(value)).toThrow()
})
