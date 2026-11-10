import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { parseOptions, explicitDatabaseUrl, readPassword, secureCampaignGm } from '../scripts/secure-campaign-gm.mjs'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const password = loadTypeScript('server/utils/password.ts')
function fixture(overrides = {}) {
  const row = { id: 'campaign', name: 'Test campaign', owner_id: null, password_hash: 'private-hash', dm_password_hash: null, ...overrides }
  const writes = []
  const sql = async (strings, ...values) => {
    if (strings.join('').startsWith('SELECT')) return [row]
    writes.push(values)
    return row.owner_id || row.dm_password_hash ? [] : [{ id: row.id }]
  }
  return { row, writes, sql }
}

test('operator utility requires explicit options/database and cannot accidentally use offline or unsupported DB settings', () => {
  assert.deepEqual(parseOptions(['--help']), { help: true })
  assert.deepEqual(parseOptions(['--campaign-id', 'campaign']), { campaignId: 'campaign', apply: false })
  assert.throws(() => parseOptions([]), /campaign ID/)
  assert.throws(() => parseOptions(['--password', 'secret']), /Use --campaign-id/)
  assert.throws(() => explicitDatabaseUrl({}), /Set DATABASE_URL explicitly/)
  assert.throws(() => explicitDatabaseUrl({ DATABASE_URL: 'postgres://operator@private/db', DDA_OFFLINE_VERIFY: '1' }), /offline/)
  assert.throws(() => explicitDatabaseUrl({ DATABASE_URL: 'https://private.example' }), /PostgreSQL/)
  assert.equal(explicitDatabaseUrl({ DATABASE_URL: 'postgres://operator@private/db' }), 'postgres://operator@private/db')
})

test('dry run neither prompts nor writes and exposes no password hashes', async () => {
  const f = fixture()
  const result = await secureCampaignGm(f.sql, { campaignId: 'campaign', apply: false }, () => { throw new Error('Should not prompt') })
  assert.equal(result.dryRun, true)
  assert.equal(f.writes.length, 0)
  assert.ok(!JSON.stringify(result).includes('private-hash'))
})

test('only missing ownerless GM credentials can be repaired, with the production password format', async () => {
  for (const row of [{ owner_id: 'owner' }, { dm_password_hash: 'existing' }]) {
    const f = fixture(row)
    await assert.rejects(secureCampaignGm(f.sql, { campaignId: 'campaign', apply: true }, async () => 'new-password'))
    assert.equal(f.writes.length, 0)
  }
  const f = fixture()
  const result = await secureCampaignGm(f.sql, { campaignId: 'campaign', apply: true }, async () => 'new-password')
  assert.equal(result.hasGmPassword, true)
  assert.equal(result.dryRun, false)
  assert.equal(f.writes.length, 1)
  assert.match(f.writes[0][0], /^pbkdf2-sha512\$220000\$/)
  assert.equal(await password.verifyPassword('new-password', f.writes[0][0]), true)
  assert.ok(!JSON.stringify(result).includes('new-password'))
})

test('stdin accepts a password without command-line disclosure and bounded input rejects oversized secrets', async () => {
  assert.equal(await readPassword(Readable.from(['strong-password\n'])), 'strong-password')
  await assert.rejects(readPassword(Readable.from(['x'.repeat(2049)])), /too long/)
})
