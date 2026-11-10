import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { withWebSocketOrigins } = loadTypeScript('server/utils/securityCsp.ts')
test('CSP preserves its nonce and limits socket connections to configured application origins', () => {
  const policy = withWebSocketOrigins("script-src 'nonce-unique' 'strict-dynamic'; img-src https: data: blob:; connect-src 'self'", 'https://dda.example,https://dda.example,http://127.0.0.1:3210')
  assert.ok(policy.includes("script-src 'nonce-unique' 'strict-dynamic'"))
  assert.ok(policy.endsWith("connect-src 'self' wss://dda.example ws://127.0.0.1:3210"))
  assert.equal((policy.match(/wss:\/\/dda.example/g) ?? []).length, 1)
  assert.throws(() => withWebSocketOrigins(policy, 'https://dda.example/path'))
})

test('report-only defaults and runtime enforcement use the same nonce policy', async () => {
  const previous = process.env.DDA_CSP_REPORT_ONLY
  const origins = process.env.APP_ALLOWED_ORIGINS
  const define = globalThis.defineNitroPlugin
  globalThis.defineNitroPlugin = work => work
  try {
    const plugin = loadTypeScriptWithMocks('server/plugins/security-csp.ts', {
      h3: { getResponseHeader: (event, name) => event.headers[name], removeResponseHeader: (event, name) => delete event.headers[name], setResponseHeader: (event, name, value) => { event.headers[name] = value } },
    }).default
    let handler
    plugin({ hooks: { hook: (name, work) => { assert.equal(name, 'beforeResponse'); handler = work } } })
    process.env.APP_ALLOWED_ORIGINS = 'https://dda.example'
    for (const enforce of [false, true]) {
      if (enforce) process.env.DDA_CSP_REPORT_ONLY = 'false'; else delete process.env.DDA_CSP_REPORT_ONLY
      const event = { headers: { 'Content-Security-Policy-Report-Only': "script-src 'nonce-unique'; connect-src 'self'" } }
      await handler(event)
      const expected = enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
      assert.ok(event.headers[expected].includes("'nonce-unique'"))
      assert.ok(event.headers[expected].includes('wss://dda.example'))
      assert.equal(Object.keys(event.headers).length, 1)
    }
  } finally {
    for (const [name, value] of [['DDA_CSP_REPORT_ONLY', previous], ['APP_ALLOWED_ORIGINS', origins]]) value === undefined ? delete process.env[name] : process.env[name] = value
    define === undefined ? delete globalThis.defineNitroPlugin : globalThis.defineNitroPlugin = define
  }
})
