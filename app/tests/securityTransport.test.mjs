import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const savedEnv = Object.fromEntries(['APP_ALLOWED_ORIGINS', 'CLIENT_IP_SOURCE', 'NODE_ENV', 'IP_DIAGNOSTIC_TOKEN'].map(key => [key, process.env[key]]))
const savedGlobals = Object.fromEntries(['defineEventHandler', 'getRequestHeader', 'setResponseHeader', 'createError'].map(key => [key, globalThis[key]]))
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) value === undefined ? delete process.env[key] : process.env[key] = value
  for (const [key, value] of Object.entries(savedGlobals)) value === undefined ? delete globalThis[key] : globalThis[key] = value
})
const transport = loadTypeScript('server/utils/securityTransport.ts')
function event(ip = '127.0.0.1', path = '/api/encounters/enc/actions/move') {
  const responseHeaders = {}
  return { path, context: {}, node: { req: { method: 'POST', url: path, headers: {}, socket: { remoteAddress: ip } }, res: { setHeader: (key, value) => { responseHeaders[key] = value } } }, responseHeaders }
}

test('forwarded IPs are ignored by default; Railway requires an explicitly selected valid single X-Real-IP', () => {
  delete process.env.CLIENT_IP_SOURCE
  const headers = { 'x-forwarded-for': '203.0.113.7, 198.51.100.1', 'x-real-ip': '203.0.113.8' }
  assert.equal(transport.clientIpFromHeaders(headers, '127.0.0.10'), '127.0.0.10')
  process.env.CLIENT_IP_SOURCE = 'railway'
  assert.equal(transport.clientIpFromHeaders(headers, '127.0.0.10'), '203.0.113.8')
  assert.equal(transport.clientIpFromHeaders({ ...headers, 'x-real-ip': '203.0.113.8, 198.51.100.1' }, '127.0.0.10'), '127.0.0.10')
  assert.equal(transport.clientIpFromHeaders({ 'x-forwarded-for': '203.0.113.7' }, '127.0.0.10'), '127.0.0.10')
})

test('production requires exact configured HTTP Origins and development permits only loopback by default', () => {
  process.env.NODE_ENV = 'production'
  delete process.env.APP_ALLOWED_ORIGINS
  assert.throws(() => transport.assertAllowedOrigin('https://game.example'), { statusCode: 403 })
  process.env.APP_ALLOWED_ORIGINS = 'https://game.example,https://play.example'
  transport.assertAllowedOrigin('https://game.example')
  transport.assertAllowedOrigin('https://play.example')
  for (const bad of [undefined, 'null', 'https://game.example.evil', 'https://game.example/path', 'https://evil.example', 'http://game.example']) {
    assert.throws(() => transport.assertAllowedOrigin(bad), { statusCode: 403 })
  }
  process.env.NODE_ENV = 'development'; delete process.env.APP_ALLOWED_ORIGINS
  transport.assertAllowedOrigin('http://localhost:3000')
  transport.assertAllowedOrigin('http://127.0.0.1:4000')
  assert.throws(() => transport.assertAllowedOrigin('http://game.example'), { statusCode: 403 })
})

test('startup refuses missing or malformed production origins before serving requests', () => {
  process.env.NODE_ENV = 'production'; delete process.env.APP_ALLOWED_ORIGINS
  assert.throws(() => transport.validateSecurityConfiguration(), /APP_ALLOWED_ORIGINS/)
  for (const invalid of ['https://game.example/path', 'https://user:secret@game.example', 'file:///tmp/app', 'null']) {
    process.env.APP_ALLOWED_ORIGINS = invalid
    assert.throws(() => transport.validateSecurityConfiguration(), /APP_ALLOWED_ORIGINS/)
  }
  process.env.APP_ALLOWED_ORIGINS = 'https://game.example,https://play.example'
  transport.validateSecurityConfiguration()
  process.env.NODE_ENV = 'development'; delete process.env.APP_ALLOWED_ORIGINS
  transport.validateSecurityConfiguration()
})

test('middleware permits successful repeat logins but caps total auth attempts and registration creations', () => {
  globalThis.defineEventHandler = handler => handler
  const middleware = loadTypeScriptWithMocks('server/middleware/01-rate-limit.ts', { '../utils/securityTransport': transport }).default
  for (let attempt = 0; attempt < 30; attempt++) middleware(event('127.0.0.61', '/api/auth/login'))
  assert.throws(() => middleware(event('127.0.0.61', '/api/auth/login')), { statusCode: 429 })
  for (let attempt = 0; attempt < 10; attempt++) middleware(event('127.0.0.62', '/api/auth/register'))
  assert.throws(() => middleware(event('127.0.0.62', '/api/auth/register')), { statusCode: 429 })
})

test('failed campaign guesses cannot lock out a different source, and spoofing XFF cannot reset the failed bucket', () => {
  delete process.env.CLIENT_IP_SOURCE
  const attacker = event('127.0.0.21')
  for (let attempt = 0; attempt < 5; attempt++) {
    attacker.node.req.headers['x-forwarded-for'] = `203.0.113.${attempt}`
    transport.enforcePasswordAttemptLimit(attacker, 'campaign')
    transport.recordPasswordFailure(attacker, 'campaign')
  }
  attacker.node.req.headers['x-forwarded-for'] = '192.0.2.1'
  assert.throws(() => transport.enforcePasswordAttemptLimit(attacker, 'campaign'), { statusCode: 429 })
  assert.ok(Number(attacker.responseHeaders['Retry-After']) > 0)
  transport.enforcePasswordAttemptLimit(event('127.0.0.22'), 'campaign')
})

test('principal writes are charged once per request and map autosaves have their separate allowance', () => {
  for (let i = 0; i < 120; i++) {
    const request = event('127.0.0.23')
    transport.enforcePrincipalWriteLimit(request, 'user:limit-normal')
    transport.enforcePrincipalWriteLimit(request, 'user:limit-normal')
  }
  const rejected = event('127.0.0.23')
  assert.throws(() => transport.enforcePrincipalWriteLimit(rejected, 'user:limit-normal'), { statusCode: 429 })
  assert.throws(() => transport.enforcePrincipalWriteLimit(rejected, 'user:limit-normal'), { statusCode: 429 }, 'a caught rejection must not mark the request as successfully limited')
  for (let i = 0; i < 300; i++) transport.enforcePrincipalWriteLimit(event('127.0.0.24', '/api/maps/map'), 'user:limit-map')
  assert.throws(() => transport.enforcePrincipalWriteLimit(event('127.0.0.24', '/api/maps/map'), 'user:limit-map'), { statusCode: 429 })
})

test('IP diagnostic is disabled by default, operator-only when enabled, and returns boolean comparisons without IPs', () => {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRequestHeader = (request, name) => request.node.req.headers[name]
  globalThis.setResponseHeader = () => {}
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const handler = loadTypeScriptWithMocks('server/api/ops/ip-diagnostic.get.ts', {}).default
  const request = event('198.51.100.9')
  assert.throws(() => handler(request), { statusCode: 404 })
  process.env.IP_DIAGNOSTIC_TOKEN = 'operator-only-token'
  assert.throws(() => handler(request), { statusCode: 403 })
  request.node.req.headers = { authorization: 'Bearer operator-only-token', 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8', 'x-diagnostic-expect': '198.51.100.9' }
  const result = handler(request)
  assert.equal(result.expectedMatchesSelected, true)
  assert.equal(result.forwardedForContainsSentinel, true)
  assert.equal(result.realIpMatchesSentinel, true)
  assert.ok(!JSON.stringify(result).includes('198.51.100.9'))
})

test('the production WebSocket adapter receives a frame-allocation limit and disabled compression', () => {
  const original = globalThis.defineNitroPlugin
  globalThis.defineNitroPlugin = plugin => plugin
  try {
    const plugin = loadTypeScriptWithMocks('server/plugins/websocket-limits.ts', {}).default
    const options = { resolve: () => {} }
    plugin({ h3App: { websocket: options } })
    assert.equal(options.serverOptions.maxPayload, 65536)
    assert.equal(options.serverOptions.perMessageDeflate, false)
  } finally { globalThis.defineNitroPlugin = original }
})
