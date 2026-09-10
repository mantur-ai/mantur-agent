/** Regression checks for dependencies selected by the desktop's owning packages. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const bootRequire = createRequire(new URL('../packages/boot/app-boot/package.json', import.meta.url))
const mcpRequire = createRequire(new URL('../packages/mcp/mcp-client/package.json', import.meta.url))
const sdkRequire = createRequire(mcpRequire.resolve('@modelcontextprotocol/sdk/server/index.js'))
const ajvRequire = createRequire(sdkRequire.resolve('ajv'))
const rateLimitRequire = createRequire(sdkRequire.resolve('express-rate-limit'))
const yaml = bootRequire('js-yaml') as typeof import('js-yaml')
const uri = ajvRequire('fast-uri') as {
  parse(input: string): { error?: string; host?: string }
  normalize(input: string): string
  resolve(base: string, relative: string): string
}
const { ipKeyGenerator } = sdkRequire('express-rate-limit') as {
  ipKeyGenerator(ip: string, subnet?: number | false): string
}
const { Address4, Address6 } = rateLimitRequire('ip-address') as {
  Address4: new (input: string) => { correctForm(): string }
  Address6: new (input: string) => { correctForm(): string }
}

describe('desktop dependency security', () => {
  it('preserves YAML merge precedence and rejects excessive merge work', () => {
    expect(yaml.load('base: &b {a: 1, b: 2}\nresult: {<<: *b, a: 3}\n')).toEqual({
      base: { a: 1, b: 2 }, result: { a: 3, b: 2 },
    })
    const chain = ['a0: &a0 { k0: 0 }']
    for (let i = 1; i < 150; i++) chain.push('a' + i + ': &a' + i + ' { <<: *a' + (i - 1) + ', k' + i + ': ' + i + ' }')
    expect(() => yaml.load(chain.join('\n'))).toThrow('maxTotalMergeKeys')
  })

  it('keeps ordered mapping keys unique, including prototype names', () => {
    const expected: object[] = [
      { ['__proto__']: 1 }, { constructor: 2 },
    ]
    expect(yaml.load('!!omap\n- __proto__: 1\n- constructor: 2\n')).toEqual(expected)
    expect(() => yaml.load('!!omap\n- a: 1\n- a: 2\n')).toThrow()
  })

  it('resolves ordered mappings without quadratic array scans', () => {
    const file = join(dirname(bootRequire.resolve('js-yaml/package.json')), 'lib/type/omap.js')
    // A separate realm counts candidate key comparisons without patching the test worker.
    const realm = { module: { exports: {} }, require: createRequire(file), comparisons: 0 }
    runInNewContext(
      'const original = Array.prototype.indexOf; Array.prototype.indexOf = function (...args) { comparisons += this.length; return original.apply(this, args) };\n'
      + readFileSync(file, 'utf8'),
      realm,
    )
    const type = realm.module.exports as { resolve(data: object[]): boolean }
    const entries = Array.from({ length: 512 }, (_, i) => ({ ['key' + i]: i }))
    expect(type.resolve(entries)).toBe(true)
    expect(realm.comparisons).toBeLessThan(512 * 4)
  })

  it.each([
    'https://trusted.example\\@other.example/',
    '/\\other.example/private',
    'http://[1::2::3]/private',
    '%2f%2fother.example:/private',
    '%0d%0aX-Test:1',
  ])('rejects malformed URI resolution: %s', (input) => {
    expect(uri.parse(input).error).toBeTypeOf('string')
    expect(uri.normalize(input)).toBe(input)
    expect(() => uri.resolve('https://trusted.example/base/', input)).toThrow()
  })

  it('preserves nested hostname escapes', () => {
    const encoded = 'http://%256cocalhost/'
    expect(uri.normalize(encoded)).toBe(encoded)
  })

  it('canonicalizes Unicode hosts after resolving a relative reference', () => {
    expect(uri.resolve('https://trusted.example/', '//127。0。0。1/private')).toBe('https://127.0.0.1/private')
    expect(uri.normalize('https://bücher.example/')).toBe('https://xn--bcher-kva.example/')
    expect(uri.resolve('https://trusted.example/base/', '../schema.json')).toBe('https://trusted.example/schema.json')
  })

  it('keeps AJV references and invalid tool arguments distinct', () => {
    const Ajv = sdkRequire('ajv') as new () => { compile(schema: object): (data: unknown) => boolean }
    const validate = new Ajv().compile({
      $id: 'https://schemas.example/tool.json',
      $ref: '#/definitions/Tool%20Input',
      definitions: {
        'Tool Input': { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false },
      },
    })
    expect(validate({ text: 'hello' })).toBe(true)
    expect(validate({ text: 42 })).toBe(false)
    expect(validate({ other: 'hello' })).toBe(false)
  })

  it('retains IPv4, IPv6 and mapped-IPv4 rate-limit buckets', () => {
    expect(ipKeyGenerator('192.0.2.5')).toBe('192.0.2.5')
    expect(ipKeyGenerator('::ffff:192.0.2.5')).toBe('192.0.2.5')
    expect(ipKeyGenerator('2001:db8:abcd:1200::1')).toBe('2001:db8:abcd:1200::/56')
    expect(ipKeyGenerator('2001:db8:abcd:12ff::2')).toBe('2001:db8:abcd:1200::/56')
    expect(ipKeyGenerator('2001:db8:abcd:1300::1')).not.toBe(ipKeyGenerator('2001:db8:abcd:1200::1'))
    expect(ipKeyGenerator('2001:db8::1', false)).toBe('2001:db8::1')
    expect(() => new Address6('1::2::3')).toThrow()
  })

  it('rejects ambiguous leading-zero IPv4 octets', () => {
    expect(new Address4('12.0.0.1').correctForm()).toBe('12.0.0.1')
    expect(() => new Address4('012.0.0.1')).toThrow()
    expect(() => new Address6('::ffff:192.168.001.1')).toThrow()
  })
})
