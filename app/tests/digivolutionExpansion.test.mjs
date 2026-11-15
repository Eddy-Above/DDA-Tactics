import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })

function fixture({ newSize = 'large', qualities = [], obstacle = { ...point(1, 1), materialId: 'steel' }, placed = true, mapId = 'map', phase = 'combat' } = {}) {
  const tables = Object.fromEntries(['encounters', 'digimon', 'evolutionLines', 'tamers'].map(name => [name, { name, id: name }]))
  const actor = { id: 'actor', type: 'digimon', entityId: 'before', evolutionLineId: 'line', isEnemy: true,
    currentWounds: 2, maxWounds: 10, totalHealth: 10, actionsRemaining: { simple: 2 }, activeEffects: [] }
  const positions = placed ? { actor: point(), other: point(10) } : { other: point(10) }
  const encounter = { id: 'enc', campaignId: 'campaign', mapId, phase, round: 1, currentTurnIndex: 0,
    participants: [actor], turnOrder: ['actor'], battleLog: [], participantPositions: structuredClone(positions) }
  const records = new Map([
    ['before', { id: 'before', campaignId: 'campaign', name: 'Before', isEnemy: true, size: 'medium', stage: 'rookie', baseStats: { health: 10 }, qualities: [] }],
    ['after', { id: 'after', campaignId: 'campaign', name: 'After', isEnemy: true, size: newSize, stage: 'champion', baseStats: { health: 15 }, qualities }],
  ])
  const line = { id: 'line', campaignId: 'campaign', currentStageIndex: 0, chain: [
    { digimonId: 'before', species: 'Before', stage: 'rookie', evolvesFromIndex: null },
    { digimonId: 'after', species: 'After', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
  ] }
  const map = { groundTiles: Array.from({ length: 25 }, (_, n) => point(n % 5 - 2, 0, Math.floor(n / 5) - 2)),
    voxels: [obstacle], walls: [], doors: [], ceilings: [], stairs: [], spaceTiles: [] }
  const writes = [], published = [], auraPositions = []
  let mapsLoaded = 0
  const db = {
    select: () => ({ from: table => ({ where: async filter => {
      if (table === tables.encounters) return [encounter]
      if (table === tables.evolutionLines) return [line]
      if (table === tables.digimon) return records.has(filter.value) ? [records.get(filter.value)] : []
      return []
    } }) }),
    update: table => ({ set: value => ({ where: async () => {
      writes.push({ table: table.name, value: structuredClone(value) })
      if (table === tables.encounters) Object.assign(encounter, value)
    } }) }),
  }
  const { performDigivolution } = loadTypeScriptWithMocks('server/utils/digivolutionAction.ts', {
    '../db': { db, ...tables }, 'drizzle-orm': { eq: (_column, value) => ({ value }) },
    './combatRecordCache': { invalidateCombatRecord() {} },
    './entitySecurity': { entityCampaignId: async (_type, record) => record.campaignId },
    './digizoidArmor': { getDigizoidArmorBonus: () => ({ health: 0 }) },
    './combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', eddySoulRules: {}, houseRules: {} }) },
    './encounterRoom': { getRoomPositions: async () => structuredClone(positions), getRoomSnapshot: async () => ({ destructibleStates: [] }),
      getDestroyedStructureIds: () => new Set(), publishCommittedPositions: async (_id, patch) => {
      assert.equal(writes.at(-1).table, 'encounters', 'publish only after persisting the form and position')
      published.push(structuredClone(patch))
      Object.assign(positions, patch)
    } },
    './combatSpatial': { loadEncounterMap: async () => { mapsLoaded++; return map }, loadParticipantDigimon: async () => new Map(records) },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants, finalPositions) => {
      auraPositions.push(structuredClone(finalPositions))
      return participants
    } },
  })
  return { encounter, positions, writes, published, auraPositions, mapsLoaded: () => mapsLoaded,
    run: (force = false) => performDigivolution('enc', { participantId: 'actor', targetChainIndex: 1 }, force, encounter) }
}

for (const forced of [false, true]) test(`${forced ? 'GM forced' : 'ordinary'} digivolution persists and broadcasts the clear expansion anchor`, async () => {
  const f = fixture()
  const result = await f.run(forced)
  assert.equal(result.participants[0].entityId, 'after')
  assert.equal(result.participants[0].actionsRemaining.simple, forced ? 2 : 1)
  assert.deepEqual(result.participantPositions, { actor: point(-1), other: point(10) })
  assert.deepEqual(f.published, [{ actor: point(-1) }])
  assert.deepEqual(f.auraPositions, [{ actor: point(-1), other: point(10) }])
  assert.equal(f.writes.filter(write => write.table === 'encounters').length, 1)
})

for (const options of [
  { obstacle: { ...point(1, 1), materialId: 'steel', blocksMovement: false } },
  { obstacle: { ...point(1, 1), materialId: 'earth' }, qualities: [{ id: 'extra-movement', choiceId: 'digger' }] },
  { obstacle: { ...point(0, 1), materialId: 'steel' } },
]) test(`digivolution retains its anchor when relocation is unnecessary or impossible: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options)
  const result = await f.run()
  assert.deepEqual(result.participantPositions.actor, point())
  assert.deepEqual(f.published, [])
  assert.equal(result.participants[0].entityId, 'after')
})

test('unplaced forms, missing maps and unchanged sizes do not acquire a relocation', async () => {
  for (const options of [{ placed: false }, { mapId: null }, { newSize: 'medium' }]) {
    const f = fixture(options)
    await f.run()
    assert.deepEqual(f.published, [])
    assert.equal(f.mapsLoaded(), 0)
  }
})

test('forced evolution in setup also updates the map without adding combat auras', async () => {
  const f = fixture({ phase: 'setup' })
  const result = await f.run(true)
  assert.deepEqual(result.participantPositions.actor, point(-1))
  assert.deepEqual(f.auraPositions, [])
})
