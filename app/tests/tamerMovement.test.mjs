import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const { detectCapabilities, getMovementCostProfile } = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
  'drizzle-orm': {}, '../db': {}, './combatRecordCache': {}, './resolveSupportAttack': {},
})
const { useTamers } = loadTypeScript('composables/useTamers.ts')
const previousRef = globalThis.ref
globalThis.ref = ref
const calculate = useTamers().calculateDerivedStats
if (previousRef === undefined) delete globalThis.ref
else globalThis.ref = previousRef

const point = (x, y = 0) => ({ x, y, z: 0 })
const key = p => `${p.x},${p.y},${p.z}`
const tamer = (agilityBonus = 2, survivalBonus = 2) => ({ id: 'owner', attributes: { agility: 2, body: 3 }, skills: { survival: 2 },
  xpBonuses: { attributes: { agility: agilityBonus }, skills: { survival: survivalBonus } } })

for (const [agility, survival] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
  test(`Tamer movement matches the sheet with XP Agility ${agility} and Survival ${survival}`, () => {
    const record = tamer(agility, survival)
    const profile = spatial.getMovementProfile({ type: 'tamer', entityId: 'owner' }, new Map(), new Map([['owner', record]]))
    assert.equal(profile.budget, calculate(record).speed)
    assert.equal(profile.caps.movementSpeed, profile.budget)
    assert.equal(getMovementCostProfile(profile.caps).budget, profile.budget)
    assert.equal(profile.caps.canJump, false)
    assert.equal(profile.caps.canSwim, false)
    assert.equal(profile.caps.canFly, false)
    assert.equal(profile.bodyStat, 3)
  })
}

function fixture(mode = 'flat', record = tamer()) {
  const height = x => mode === 'upstairs' ? Math.floor(x / 2) : mode === 'downstairs' ? 5 - Math.floor(x / 2) : 0
  const tile = x => point(x, height(x))
  const map = { groundTiles: Array.from({ length: 12 }, (_, x) => tile(x)), voxels: [], spaceTiles: [], walls: [], doors: [], stairs: [], ceilings: [] }
  const actor = { id: 'actor', entityId: 'owner', type: 'tamer', currentWounds: 0, maxWounds: 12, actionsRemaining: { simple: 2 } }
  const encounter = { id: 'enc', campaignId: 'campaign', mapId: 'map', revision: 1, phase: 'combat', round: 1,
    currentTurnIndex: 0, turnOrder: ['actor'], participants: [actor], battleLog: [], hazards: [] }
  const sheetSpeed = calculate(record).speed
  const caps = detectCapabilities([], sheetSpeed, 0, 0, 0, 0)
  const client = useMapMovement()
  const cells = client.computeReachable(tile(0), sheetSpeed, caps, map)
  let burnDistance = 0
  const { prepareEncounterMovement } = loadTypeScriptWithMocks('server/utils/encounterMovement.ts', {
    '../db': { db: {}, maps: { id: 'map' } }, './databaseScope': { scopedDatabase: () => undefined },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: { actor: tile(0) }, destructibleStates: [] }) },
    './combatSpatial': { getMovementProfile: spatial.getMovementProfile, loadEncounterMap: async () => map,
      loadParticipantDigimon: async () => new Map(), loadTamersByIds: async () => new Map([['owner', record]]) },
    './naturewalk': { applyNaturewalkEnvironment: async (_enc, participants) => ({ participants }) },
    './damageOverTime': { loadCampaignDamageOverTimeRules: async () => undefined, applyMovementBurn: (participants, moves) => {
      burnDistance = moves[0].meters
      return { participants, logEntries: [] }
    } },
  })
  const submit = (destination, path) => prepareEncounterMovement(encounter, {
    participantId: 'actor', kind: 'normal', operationId: 'move', expectedRevision: 1, origin: tile(0), destination, path,
  }, { isDm: false })
  return { actor, map, tile, caps, client, cells, submit, burnDistance: () => burnDistance }
}

for (const mode of ['flat', 'upstairs', 'downstairs']) {
  test(`the displayed 8m Tamer route commits on ${mode} terrain`, async () => {
    const f = fixture(mode)
    const destination = f.tile(8)
    assert.ok(f.cells.has(key(destination)))
    const path = f.client.computePath(f.tile(0), destination, f.caps, f.map)
    assert.equal(path.length, 9)
    const result = await f.submit(destination, path)
    assert.deepEqual(result.position, destination)
    assert.deepEqual(result.path, path)
    assert.equal(result.distance, 8)
    assert.equal(result.participants[0].actionsRemaining.simple, 1)
    assert.equal(f.burnDistance(), 8)
  })
}

test('XP-enhanced Tamer movement still rejects over-budget and obstructed routes', async () => {
  const f = fixture()
  assert.ok(!f.cells.has(key(f.tile(9))))
  await assert.rejects(f.submit(f.tile(9), Array.from({ length: 10 }, (_, x) => f.tile(x))), { statusCode: 400 })
  f.map.voxels.push({ id: 'wall', ...f.tile(4), materialId: 'steel' })
  await assert.rejects(f.submit(f.tile(8), Array.from({ length: 9 }, (_, x) => f.tile(x))), /movement path is blocked/)
  assert.equal(f.actor.actionsRemaining.simple, 2)
})

test('a Tamer without saved XP bonuses retains its base movement', async () => {
  const record = tamer()
  record.xpBonuses = null
  const f = fixture('flat', record)
  assert.ok(f.cells.has(key(f.tile(4))))
  assert.ok(!f.cells.has(key(f.tile(5))))
  const result = await f.submit(f.tile(4), f.client.computePath(f.tile(0), f.tile(4), f.caps, f.map))
  assert.equal(result.distance, 4)
})
