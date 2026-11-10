import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = globalThis.defineEventHandler
afterEach(() => { original === undefined ? delete globalThis.defineEventHandler : globalThis.defineEventHandler = original })
test('all unsafe HTTP requests receive Origin checks, including case and path variants', () => {
  globalThis.defineEventHandler = work => work
  const checked = []
  const origin = loadTypeScriptWithMocks('server/middleware/00-request-origin.ts', {
    '../utils/securityTransport': { assertUnsafeRequestOrigin: event => checked.push(event.path) },
  }).default
  for (const path of ['/api/maps/map', '/API/maps/map', '/API/AUTH/REGISTER/', '//api/maps/map', '/internal']) origin({ path })
  assert.equal(checked.length, 5)
})
test('case-variant and trailing-slash authentication/creation paths keep their rate limits and original campaign IDs', () => {
  globalThis.defineEventHandler = work => work
  const limits = [], campaigns = []
  const rate = loadTypeScriptWithMocks('server/middleware/01-rate-limit.ts', {
    '../utils/securityTransport': { getClientIp: () => 'ip', enforcePasswordAttemptLimit: (_event, id) => campaigns.push(id), consumeHttpLimit: (_event, key, max) => limits.push({ key, max }) },
  }).default
  rate({ path: '/API/AUTH/REGISTER/', node: { req: { method: 'POST' } } })
  assert.ok(limits.some(limit => limit.key === 'account-auth:ip' && limit.max === 30))
  assert.ok(limits.some(limit => limit.key === 'create-delete:ip' && limit.max === 10))
  rate({ path: '/API/CAMPAIGNS/CaseSensitiveId/VERIFY-PASSWORD/', node: { req: { method: 'POST' } } })
  assert.deepEqual(campaigns, ['CaseSensitiveId'])
  assert.ok(limits.some(limit => limit.key === 'password-attempt:ip' && limit.max === 30))
})
