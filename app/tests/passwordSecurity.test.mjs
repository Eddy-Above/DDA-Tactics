import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { hashPassword, verifyPassword, needsPasswordRehash } = loadTypeScript('server/utils/password.ts')

test('new hashes use async versioned PBKDF2-SHA512 with 220,000 iterations and fresh salts', async () => {
  const first = await hashPassword('a strong password')
  const second = await hashPassword('a strong password')
  assert.match(first, /^pbkdf2-sha512\$220000\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('a strong password', first), true)
  assert.equal(await verifyPassword('wrong', first), false)
  assert.equal(needsPasswordRehash(first), false)
})

test('legacy passwords continue verifying and request an upgrade', async () => {
  const salt = '0123456789abcdef0123456789abcdef'
  const legacy = `${salt}:${pbkdf2Sync('legacy', salt, 10_000, 64, 'sha512').toString('hex')}`
  assert.equal(await verifyPassword('legacy', legacy), true)
  assert.equal(await verifyPassword('wrong', legacy), false)
  assert.equal(needsPasswordRehash(legacy), true)
})

test('malformed or excessive-cost hashes fail closed', async () => {
  for (const hash of ['', 'salt:hash', 'pbkdf2-sha512$999999999$' + 'a'.repeat(32) + '$' + 'b'.repeat(128),
    'pbkdf2-sha256$220000$' + 'a'.repeat(32) + '$' + 'b'.repeat(128)]) {
    assert.equal(await verifyPassword('password', hash), false)
  }
})
