import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const originals = Object.fromEntries(['getRouterParam', 'readBody', 'createError'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of Object.entries(originals)) value === undefined ? delete globalThis[name] : globalThis[name] = value })
function fixture({ isDm = true, doorIds = ['door'] } = {}) {
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async () => ({ participantId: 'actor', doorIds, isOpen: true })
  globalThis.createError = value => Object.assign(new Error(value.message), value)
  const encounter = { id: 'enc', mapId: 'map', participants: [{ id: 'actor', entityId: 'mon', type: 'digimon' }] }
  const tables = { encounters: { id: 'encounter-id' }, maps: { id: 'map-id' } }
  const map = { walls: [{ id: 'wall', x: 0, y: 0, z: 0, face: 'east' }, { id: 'remote-wall', x: 8, y: 0, z: 0, face: 'east' }], doors: [{ id: 'door', wallId: 'wall', isOpen: false, label: 'old' }] }
  let locked = false, writes = [], publications = []
  const db = {
    select: () => ({ from: table => ({ where: () => table === tables.encounters ? Promise.resolve([encounter]) : { for: async () => {
      locked = true
      // A geometry save completed before this command acquired the map row.
      map.doors = [{ ...map.doors[0], label: 'new definition', woundBoxes: 12 }, { id: 'new-door', wallId: 'remote-wall', isOpen: false }]
      return [{ id: 'map' }]
    } } }) }),
    update: table => ({ set: fields => ({ where: async () => { assert.equal(table, tables.maps); writes.push(structuredClone(fields)); map.doors = fields.doors } }) }),
  }
  const module = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/doors.post.ts', {
    '../../../../db': { db, ...tables },
    '../../../../utils/encounterCommand': { defineEncounterCommand: work => work },
    '../../../../utils/encounterAuthorization': { authorizeEncounterIntent: async () => ({ access: { isDm } }) },
    '../../../../utils/encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: { actor: { x: 0, y: 0, z: 0 } } }), broadcast: (...args) => publications.push(args) },
    '../../../../utils/combatSpatial': { loadEncounterMap: async () => { assert.equal(locked, true); return map }, loadParticipantDigimon: async () => new Map() },
    'drizzle-orm': { eq: () => null },
  })
  return { handler: module.default, map, writes, publications }
}
test('door toggles lock and read the latest map, preserving new door geometry and unrelated live states', async () => {
  const f = fixture()
  const result = await f.handler({})
  assert.equal(result.doors[0].isOpen, true)
  assert.equal(result.doors[0].label, 'new definition')
  assert.equal(result.doors[0].woundBoxes, 12)
  assert.equal(result.doors[1].id, 'new-door')
  assert.equal(result.doors[1].isOpen, false)
  assert.equal(f.writes.length, 1)
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ['doors', 'updatedAt'])
  assert.equal(f.publications.length, 1)
})
test('player door intents require adjacency and cannot change a remote door in the same locked map', async () => {
  const f = fixture({ isDm: false, doorIds: ['new-door'] })
  await assert.rejects(f.handler({}), { statusCode: 403 })
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.publications, [])
})
