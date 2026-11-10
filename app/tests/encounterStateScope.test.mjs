import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const point = { id: 'actor', entityId: 'mon', type: 'digimon' }
function fixture(fields = {}) {
  const tables = Object.fromEntries(['digimon', 'tamers', 'evolutionLines', 'maps'].map(name => [name, { id: name }]))
  const rows = { digimon: [{ id: 'mon', campaignId: 'camp' }, { id: 'foreign', campaignId: 'other' }], tamers: [{ id: 'tamer', campaignId: 'camp' }], evolutionLines: [{ id: 'line', campaignId: 'camp' }, { id: 'foreign-line', campaignId: 'other' }], maps: [{ id: 'map', campaignId: fields.mapCampaign ?? 'camp' }] }
  const db = { select: () => ({ from: table => ({ where: () => Promise.resolve(rows[Object.keys(tables).find(name => tables[name] === table)]) }) }) }
  const scope = loadTypeScriptWithMocks('server/utils/encounterStateScope.ts', { '../db': { db, ...tables } })
  return { ...scope, encounter: { campaignId: 'camp' } }
}
test('trusted encounter writes validate current actors, saved forms, evolution lines and maps before mutation', async () => {
  const f = fixture()
  await f.validateEncounterStateScope(f.encounter, { participants: [{ ...point, evolutionLineId: 'line', woundsHistory: [{ entityId: 'mon' }] }], turnOrder: ['actor'], mapId: 'map', phase: 'combat', round: 1 })
  for (const participants of [[{ ...point, entityId: 'foreign' }], [{ ...point, woundsHistory: [{ entityId: 'foreign' }] }], [{ ...point, evolutionLineId: 'foreign-line' }]]) {
    await assert.rejects(f.validateEncounterStateScope(f.encounter, { participants }), { statusCode: 400 })
  }
})
test('scope validation rejects foreign maps, top-level scope injection, invalid turn slots and malformed participants', async () => {
  const foreign = fixture({ mapCampaign: 'other' })
  await assert.rejects(foreign.validateEncounterStateScope(foreign.encounter, { mapId: 'map' }), { statusCode: 400 })
  const f = fixture()
  for (const body of [{ campaignId: 'other' }, { phase: 'invented' }, { round: Infinity }, { participants: [point, point] }, { participants: [point], turnOrder: ['foreign-slot'] }, { participants: [{ ...point, type: 'gm' }] }]) {
    await assert.rejects(f.validateEncounterStateScope(f.encounter, body), { statusCode: 400 })
  }
})

test('server snapshot preservation cannot revive Charge movement after its turn, form, map or phase changes', () => {
  const { combatTurnKey } = loadTypeScriptWithMocks('utils/specialOrderCombat.ts', {})
  const f = fixture()
  const allowance = { castId: 'cast', turnKey: combatTurnKey(1, 0), entityId: 'mon', mapId: 'map' }
  const participant = { ...point, pendingChargeMove: allowance }
  const encounter = { phase: 'combat', mapId: 'map', round: 1, currentTurnIndex: 0, participants: [participant] }
  assert.equal(f.clearInvalidChargeMoves(encounter, { participants: [{ ...participant }] })[0].pendingChargeMove, allowance)
  for (const update of [
    { round: 2 }, { currentTurnIndex: 1 }, { mapId: 'other-map' }, { mapId: null }, { phase: 'ended' },
    { participants: [{ ...participant, entityId: 'new-form' }] },
    { participants: [{ ...participant, inReserve: true }] },
  ]) {
    const result = f.clearInvalidChargeMoves(encounter, update)
    assert.equal(result[0].pendingChargeMove, undefined)
    assert.equal(participant.pendingChargeMove, allowance, 'the earlier snapshot stays immutable')
  }
})
