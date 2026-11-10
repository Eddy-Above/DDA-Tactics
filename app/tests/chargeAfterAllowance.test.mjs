import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const { combatTurnKey } = loadTypeScript('utils/specialOrderCombat.ts')
const attack = { id: 'charge', tags: ['Charge Attack'] }
function fixture(update = {}) {
  const original = { id: 'enc', mapId: 'map', phase: 'combat', round: 3, currentTurnIndex: 1,
    participants: [{ id: 'actor', entityId: 'form', currentWounds: 0, maxWounds: 10, actionsRemaining: { simple: 1 } }],
  }
  const fresh = { ...structuredClone(original), ...update }
  const writes = []
  const module = loadTypeScriptWithMocks('server/utils/attackMovement.ts', {
    '../db': { encounters: { id: 'id' }, db: { select: () => ({ from: () => ({ where: async () => [fresh] }) }), update: () => ({ set: value => ({ where: async () => writes.push(value) }) }) } },
    'drizzle-orm': { eq: () => null },
    './encounterMovement': {}, './encounterRoom': {}, './combatSpatial': {}, './resolveSupportAttack': {}, './enemyKnockouts': {},
  })
  return { ...module, original, fresh, writes, grant: () => module.grantChargeAfter('enc', 'actor', attack, 'after', original) }
}
test('Charge-after binds a valid allowance to the form, map and turn that declared the attack', async () => {
  const f = fixture()
  await f.grant()
  assert.equal(f.writes.length, 1)
  const allowance = f.writes[0].participants[0].pendingChargeMove
  assert.equal(allowance.entityId, 'form')
  assert.equal(allowance.mapId, 'map')
  assert.equal(allowance.turnKey, combatTurnKey(3, 1))
  assert.equal(allowance.attackId, 'charge')
  assert.match(allowance.castId, /^[0-9a-f-]{36}$/)
  assert.equal(f.original.participants[0].pendingChargeMove, undefined)
})
for (const [reason, changed] of [
  ['form auto-devolved', { participants: [{ id: 'actor', entityId: 'previous-form', currentWounds: 0, maxWounds: 10 }] }],
  ['turn advanced', { currentTurnIndex: 2 }],
  ['round advanced', { round: 4 }],
  ['map changed', { mapId: 'another-map' }],
  ['map removed', { mapId: null }],
  ['combat ended', { phase: 'ended' }],
  ['actor entered reserve', { participants: [{ id: 'actor', entityId: 'form', currentWounds: 0, maxWounds: 10, inReserve: true }] }],
  ['actor was removed', { participants: [] }],
  ['actor remains knocked out', { participants: [{ id: 'actor', entityId: 'form', currentWounds: 10, maxWounds: 10 }] }],
]) test(`Charge-after cannot grant movement after the ${reason}`, async () => {
  const f = fixture(changed)
  await f.grant()
  assert.deepEqual(f.writes, [])
})
