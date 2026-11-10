import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

test('verification preloads an inert database and real database access fails before connecting', () => {
  assert.equal(process.env.DDA_OFFLINE_VERIFY, '1')
  assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1')
  const { db } = loadTypeScript('server/db/index.ts')
  assert.throws(() => db.select(), /Unexpected database access during offline verification/)
})
