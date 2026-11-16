import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
globalThis.readBody = async event => event.body
const point = y => ({ x: 0, y, z: 0 })

function fixture({ y = 10, turn = true, actor = {} } = {}) {
  const participant = { id: 'actor', entityId: 'tai', type: 'tamer', currentWounds: 0, maxWounds: 20,
    actionsRemaining: { simple: 0 }, ...actor }
  const encounter = { id: 'enc', mapId: 'map', phase: 'combat', round: 1, participants: [participant],
    turnOrder: ['actor'], currentTurnIndex: 0, battleLog: [] }
  const map = { groundTiles: [point(0)], voxels: [], stairs: [], spaceTiles: [], walls: [], doors: [], ceilings: [] }
  const writes = [], patches = [], knockouts = []
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './combatSpatial': { getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: false, hasTumbler: false, hasAdvJumper: false }) },
    './encounterRoom': {}, './guidingLight': {},
  })
  const route = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/fall.post.ts', {
    'drizzle-orm': { eq: () => null },
    h3: { readBody: async event => event.body },
    '../../../../db': { encounters: { id: 'id' }, db: { update: () => ({ set: value => ({ where: () => ({ returning: async () => {
      writes.push(value)
      return [{ ...encounter, ...value }]
    } }) }) }) } },
    '../../../../utils/encounterCommand': { defineEncounterCommand: handler => handler },
    '../../../../utils/participantTurn': { canActOnEncounterTurn: async () => turn },
    '../../../../utils/encounterRoom': {
      getRoomSnapshot: async () => ({ participantPositions: { actor: point(y) }, destructibleStates: [] }),
      getDestroyedStructureIds: () => new Set(), publishCommittedPositions: async (_id, patch) => patches.push(patch),
    },
    '../../../../utils/combatSpatial': { loadEncounterMap: async () => map,
      loadParticipantDigimon: async () => new Map(), loadTamersByIds: async () => new Map([['tai', { name: 'Tai' }]]) },
    '../../../../utils/endOfTurnGravity': gravity,
    '../../../../utils/enemyKnockouts': { resolveEnemyKnockouts: async (state, ids) => {
      knockouts.push(ids)
      return { ...state, logEntries: [] }
    } },
    '../../../../utils/guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  }).default
  return { encounter, writes, patches, knockouts, run: () => route({ body: { participantId: 'actor' } }, { encounter }) }
}

test('Fall commits position, damage and log without spending an action when protection is unavailable', async () => {
  const f = fixture({ actor: { divineProtectionUsesThisBattle: 1 } })
  const result = await f.run()
  assert.equal(f.writes.length, 1)
  assert.deepEqual(result.participantPositions, { actor: point(0) })
  assert.equal(result.participants[0].currentWounds, 4)
  assert.equal(result.participants[0].actionsRemaining.simple, 0)
  assert.equal(result.battleLog[0].actorName, 'Tai')
  assert.deepEqual(f.patches, [{ actor: point(0) }])
  assert.deepEqual(f.knockouts, [['actor']])
  assert.equal(f.encounter.participants[0].currentWounds, 0, 'stored input is unchanged until committed')
})

test('Fall lands the Tamer and holds eligible damage for Divine Protection', async () => {
  const f = fixture()
  const result = await f.run()
  assert.deepEqual(result.participantPositions, { actor: point(0) })
  assert.equal(result.participants[0].currentWounds, 0)
  assert.deepEqual(result.participants[0].pendingFallDamage, [{ damage: 4, targetName: 'Tai' }])
  assert.match(result.battleLog[0].result, /pending Divine Protection/)
  assert.deepEqual(f.patches, [{ actor: point(0) }])
})

for (const [label, options] of [
  ['grounded', { y: 0 }], ['out of turn', { turn: false }],
  ['in reserve', { actor: { inReserve: true } }], ['in a clash', { actor: { clash: {} } }],
]) test(`Fall rejects a character who is ${label}`, async () => {
  const f = fixture(options)
  await assert.rejects(f.run())
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.patches, [])
})
