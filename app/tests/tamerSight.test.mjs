import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions } from './helpers/loadTypeScript.mjs'

globalThis.createError = options => Object.assign(new Error(options.message), options)
globalThis.getRouterParam = event => event.id
globalThis.readBody = async event => event.body
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const { createTamerSightCheck } = loadTypeScript('utils/tamerSight.ts')
const { getFootprintDimensions } = loadTypeScript('utils/movementRules.ts')
const dims = getFootprintDimensions('medium')
function fixture() {
  const map = { groundTiles: [], voxels: [], walls: [{ id: 'wall', ...point(1), face: 'east' }], doors: [], ceilings: [] }
  const positions = { tamer: point(), mon: point(3) }
  const room = { participantPositions: positions, destructibleStates: [] }
  const sight = loadTypeScriptWithMocks('server/utils/tamerSight.ts', {
    './combatSpatial': { loadEncounterMap: async () => map },
    './encounterRoom': { getRoomSnapshot: async () => room, getDestroyedStructureIds: states => new Set(states.filter(s => s.currentWounds <= 0).map(s => s.structureId)) },
  })
  const actor = { id: 'tamer', entityId: 'owner', type: 'tamer', actionsRemaining: { simple: 2 } }
  const target = { id: 'mon', entityId: 'record', type: 'digimon' }
  const encounter = { id: 'enc', mapId: 'map', turnOrder: ['tamer'], participants: [actor, target], battleLog: [] }
  const writes = []
  const tables = Object.fromEntries(['encounters', 'tamers', 'digimon'].map(name => [name, { name, id: name }]))
  const db = {
    select: () => ({ from: table => ({ where: async () => table === tables.encounters ? [encounter]
      : table === tables.tamers ? [{ name: 'Owner', attributes: { charisma: 4 } }]
      : [{ size: 'medium', partnerId: 'owner' }] }) }),
    update: () => ({ set: value => ({ where: async () => { writes.push(value); Object.assign(encounter, value) } }) }),
  }
  const direct = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/direct.post.ts', {
    '../../../../utils/encounterCommand': { defineEncounterCommand: fn => fn },
    '../../../../utils/encounterAuthorization': { authorizeEncounterIntent: async () => {} },
    '../../../../db': { db, ...tables }, 'drizzle-orm': { eq: () => null },
    '../../../../utils/tamerSight': sight,
  }).default
  return { map, positions, room, actor, target, encounter, writes,
    requireSight: () => sight.requireTamerDigimonSight(encounter, actor, target, { size: 'medium' }, 'Digivolution'),
    direct: bolstered => direct({ id: 'enc', body: { participantId: 'tamer', targetDigimonId: 'mon', bolstered } }, { encounter }) }
}

test('Tamer sight follows walls, doors and destroyed structures', () => {
  const f = fixture()
  assert.equal(createTamerSightCheck(f.map, point())(point(3), dims), false)
  assert.equal(createTamerSightCheck(f.map, point())(point(3), getFootprintDimensions('huge')), true,
    'a larger Digimon can be seen above a low wall')
  assert.equal(createTamerSightCheck(f.map, point(), new Set(['wall']))(point(3), dims), true)
  f.map.doors = [{ id: 'door', wallId: 'wall', isOpen: true }]
  assert.equal(createTamerSightCheck(f.map, point())(point(3), dims), true)
  f.map.doors[0].isOpen = false
  assert.equal(createTamerSightCheck(f.map, point())(point(3), dims), false)
  assert.equal(createTamerSightCheck(f.map, undefined)(point(3), dims), false)
})

test('server sight rejects occlusion and missing placements, accepts destroyed blockers and mapless encounters', async () => {
  const f = fixture()
  await assert.rejects(f.requireSight(), /requires line of sight/)
  f.room.destructibleStates = [{ structureId: 'wall', currentWounds: 0 }]
  await f.requireSight()
  delete f.positions.tamer
  await assert.rejects(f.requireSight(), /placed on the map/)
  f.encounter.mapId = null
  await f.requireSight()
})

test('blocked Bolster Direct spends no actions or writes; ordinary Direct retains its rules', async () => {
  const f = fixture()
  await assert.rejects(f.direct(true), /requires line of sight/)
  assert.deepEqual(f.writes, [])
  assert.equal(f.actor.actionsRemaining.simple, 2)
  await f.direct(false)
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 1)
  assert.equal(f.encounter.participants[1].activeEffects[0].value, 4)
})

test('visible Bolster Direct applies the bonus and spends two actions', async () => {
  const f = fixture()
  f.map.walls = []
  await f.direct(true)
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 0)
  assert.equal(f.encounter.participants[1].activeEffects[0].value, 6)
})

test('map target choices filter by the same Tamer sight rules', () => {
  const f = fixture()
  const props = { targetSightSourceId: 'tamer', encounter: f.encounter, digimonMap: { record: { size: 'medium' } } }
  const { filterTargetSight } = loadPageFunctions('components/EncounterMap.vue', ['filterTargetSight'], {
    props, map: { value: f.map }, positions: { value: f.positions }, destroyedIds: () => new Set(),
    createTamerSightCheck, getFootprintDimensions,
  })
  assert.deepEqual(filterTargetSight(['mon']), [])
  f.map.walls = []
  assert.deepEqual(filterTargetSight(['mon']), ['mon'])
  f.map.walls = [{ id: 'wall', ...point(1), face: 'east' }]
  props.targetSightSourceId = null
  assert.deepEqual(filterTargetSight(['mon']), ['mon'])
})
