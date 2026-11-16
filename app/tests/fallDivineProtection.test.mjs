import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'
import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'

const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const copy = value => structuredClone(value)

function fixture(overrides = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async event => event
  globalThis.createError = details => Object.assign(new Error(details.message), details)
  const actor = { id: 'tai', entityId: 'owner', name: 'Tai', type: 'tamer', currentWounds: 1, maxWounds: 20,
    currentInspiration: 2, actionsRemaining: { simple: 2 }, activeEffects: [], ...overrides }
  const encounter = { id: 'enc', phase: 'combat', round: 1, participants: [actor],
    pendingRequests: [], requestResponses: [], battleLog: [], turnOrder: ['tai'], currentTurnIndex: 0 }
  const tamer = { id: 'owner', inspiration: actor.currentInspiration }
  const tables = Object.fromEntries(['encounters', 'tamers', 'digimon', 'campaigns', 'maps'].map(name => [name, { name, id: name }]))
  const writes = []
  const db = {
    select: () => ({ from: table => ({ where: async () => table === tables.encounters ? [copy(encounter)] : table === tables.tamers ? [copy(tamer)] : [] }) }),
    update: table => ({ set: fields => ({ where: () => {
      let done = false
      const save = () => {
        const row = table === tables.encounters ? encounter : tamer
        if (!done) { Object.assign(row, copy(fields)); writes.push({ table: table.name, fields: copy(fields) }); done = true }
        return [copy(row)]
      }
      return { then: (yes, no) => Promise.resolve().then(save).then(yes, no), returning: async () => save() }
    } }) }),
  }
  const store = { db, ...tables }, sql = { eq: (_column, value) => ({ value }) }
  const falls = loadTypeScriptWithMocks('server/utils/fallDamage.ts', { '../db': store, 'drizzle-orm': sql })
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './fallDamage': falls,
    './combatSpatial': { getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: false, hasTumbler: false, hasAdvJumper: false }) },
    './encounterRoom': {}, './guidingLight': {},
  })
  const response = loadTrustedGameplayModule('server/api/encounters/[id]/responses.post.ts', {
    '../../../db': store, 'drizzle-orm': sql,
  }).default
  return { encounter, tamer, writes, falls, gravity, store, sql,
    fall: async damage => { falls.applyFallDamage(encounter.participants[0], damage, 'Tai'); return falls.finishFallProtection('enc', encounter) },
    respond: async used => {
      const request = encounter.pendingRequests.find(r => r.type === 'divine-protection-offer')
      assert.ok(request)
      const result = await response({ requestId: request.id, tamerId: 'owner', response: { type: used ? 'divine-protection-used' : 'divine-protection-declined' } })
      return falls.finishFallProtection('enc', result)
    },
  }
}

test('a falling Tamer lands immediately and receives a free protection decision before any fall wounds', async () => {
  const f = fixture({ currentInspiration: 0 })
  const map = { groundTiles: [{ x: 0, y: 0, z: 0 }], spaceTiles: [], voxels: [], stairs: [], walls: [], doors: [], ceilings: [] }
  const dropped = await f.gravity.computeGravityDrops({ tai: { x: 0, y: 10, z: 0 } }, f.encounter.participants, map, new Map(), 1)
  assert.deepEqual(dropped.patch, { tai: { x: 0, y: 0, z: 0 } })
  assert.equal(f.encounter.participants[0].currentWounds, 1)
  await f.falls.finishFallProtection('enc', f.encounter)
  const request = f.encounter.pendingRequests[0]
  assert.equal(request.targetTamerId, 'owner')
  assert.equal(request.data.damageSource, 'fall')
  assert.equal(request.data.pendingDamage, 4)
  assert.equal(request.data.firstUse, true)
  assert.equal(request.data.inspirationCost, 0)
  await f.respond(true)
  assert.equal(f.encounter.participants[0].currentWounds, 1)
  assert.equal(f.encounter.participants[0].divineProtectionUsesThisBattle, 1)
  assert.equal(f.encounter.participants[0].pendingSimpleActionPenalty, 1)
  assert.deepEqual(f.encounter.pendingRequests, [])
})

test('declining fall protection applies the held wounds exactly once without spending Inspiration or actions', async () => {
  const f = fixture()
  await f.fall(7)
  await f.falls.finishFallProtection('enc', f.encounter)
  assert.equal(f.encounter.pendingRequests.length, 1)
  await f.respond(false)
  const actor = f.encounter.participants[0]
  assert.equal(actor.currentWounds, 8)
  assert.equal(actor.currentInspiration, 2)
  assert.equal(actor.pendingSimpleActionPenalty, undefined)
  assert.equal(actor.pendingDivineProtectionDamage, undefined)
  assert.equal(actor.divineProtectionUsesThisBattle, undefined)
  assert.deepEqual(f.encounter.pendingRequests, [])
})

test('later fall protection spends two Inspiration on both the combat participant and Tamer sheet', async () => {
  const f = fixture({ divineProtectionUsesThisBattle: 1 })
  await f.fall(5)
  assert.equal(f.encounter.pendingRequests[0].data.inspirationCost, 2)
  await f.respond(true)
  assert.equal(f.encounter.participants[0].currentWounds, 1)
  assert.equal(f.encounter.participants[0].currentInspiration, 0)
  assert.equal(f.encounter.participants[0].divineProtectionUsesThisBattle, 2)
  assert.equal(f.encounter.participants[0].pendingSimpleActionPenalty, 1)
  assert.equal(f.tamer.inspiration, 0)
})

test('Digimon, harmless falls and Tamers without another affordable use do not receive a prompt', async () => {
  for (const [overrides, damage, wounds] of [
    [{ type: 'digimon' }, 4, 5], [{}, 0, 1],
    [{ divineProtectionUsesThisBattle: 1, currentInspiration: 1 }, 4, 5],
  ]) {
    const f = fixture(overrides)
    await f.fall(damage)
    assert.equal(f.encounter.participants[0].currentWounds, wounds)
    assert.deepEqual(f.encounter.pendingRequests, [])
  }
})

test('queued falls share the free use, then require Inspiration for the next decision', async () => {
  const f = fixture()
  await f.fall(3)
  await f.fall(4)
  assert.equal(f.encounter.pendingRequests.length, 1)
  await f.respond(true)
  assert.equal(f.encounter.pendingRequests.length, 1)
  assert.equal(f.encounter.pendingRequests[0].data.firstUse, false)
  assert.equal(f.encounter.pendingRequests[0].data.pendingDamage, 4)
  await f.respond(true)
  assert.equal(f.encounter.participants[0].currentWounds, 1)
  assert.equal(f.encounter.participants[0].currentInspiration, 0)
  assert.equal(f.encounter.participants[0].pendingSimpleActionPenalty, 2)
  assert.deepEqual(f.encounter.pendingRequests, [])
})

test('a queued fall applies wounds if the preceding decision spends the last available use', async () => {
  const f = fixture({ currentInspiration: 0 })
  await f.fall(3)
  await f.fall(4)
  await f.respond(true)
  assert.equal(f.encounter.participants[0].currentWounds, 5)
  assert.deepEqual(f.encounter.pendingRequests, [])
  assert.equal(f.encounter.participants[0].pendingFallDamage, undefined)
})

test('movement commands finalize fall protection in their nested encounter result', async () => {
  const f = fixture()
  const result = { success: true, encounter: copy(f.encounter) }
  f.falls.applyFallDamage(result.encounter.participants[0], 4, 'Tai')
  await f.falls.finishFallProtection('enc', result)
  assert.equal(result.encounter.participants[0].currentWounds, 1)
  assert.equal(result.encounter.pendingRequests[0].data.pendingDamage, 4)
  assert.equal(f.encounter.pendingRequests[0].id, result.encounter.pendingRequests[0].id)
})

test('Divine Protection rechecks available Inspiration rather than trusting an old offer', async () => {
  const f = fixture({ divineProtectionUsesThisBattle: 1 })
  await f.fall(3)
  f.encounter.participants[0].currentInspiration = 0
  await assert.rejects(f.respond(true), /Not enough Inspiration/)
  assert.equal(f.encounter.participants[0].currentWounds, 1)
  assert.equal(f.encounter.participants[0].divineProtectionUsesThisBattle, 1)
})

test('Knockback settles a falling Tamer immediately but defers the fall wounds', async () => {
  const f = fixture()
  const map = { groundTiles: [{ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }],
    spaceTiles: [], voxels: [], stairs: [], walls: [], doors: [], ceilings: [] }
  const pushPull = loadTypeScriptWithMocks('server/utils/pushPull.ts', {
    './fallDamage': f.falls,
    './combatSpatial': { getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: false, hasTumbler: false, hasAdvJumper: false }) },
  })
  const moved = await pushPull.computePushPull({
    map, positions: { attacker: { x: -1, y: 10, z: 0 }, tai: { x: 0, y: 10, z: 0 } },
    participants: [{ id: 'attacker', type: 'tamer' }, ...f.encounter.participants], digimonById: new Map(),
    attackerParticipantId: 'attacker', targetParticipantId: 'tai', effect: 'Knockback', distance: 1,
  })
  assert.deepEqual(moved.patch, { tai: { x: 1, y: 0, z: 0 } })
  assert.equal(moved.participants.find(p => p.id === 'tai').currentWounds, 1)
  assert.match(moved.logNote, /fall damage pending Divine Protection/)
  f.encounter.participants = moved.participants
  await f.falls.finishFallProtection('enc', f.encounter)
  assert.equal(f.encounter.pendingRequests[0].data.pendingDamage, 4)
})

test('Clash Throw protection covers the fall portion while normal throw damage still applies', async () => {
  const f = fixture()
  const tai = f.encounter.participants[0]
  tai.clash = { clashId: 'clash', isController: false, opponentParticipantId: 'thrower' }
  const thrower = { id: 'thrower', type: 'tamer', entityId: 'other', actionsRemaining: { simple: 2 }, activeEffects: [],
    clash: { clashId: 'clash', isController: true, opponentParticipantId: 'tai' } }
  f.encounter.participants.push(thrower)
  f.encounter.turnOrder = ['thrower', 'tai']
  f.encounter.mapId = 'map'
  f.tamer.attributes = { body: 3 }
  const positions = { thrower: { x: -1, y: 10, z: 0 }, tai: { x: 0, y: 10, z: 0 } }
  const map = { groundTiles: [{ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }],
    spaceTiles: [], voxels: [], stairs: [], walls: [], doors: [], ceilings: [] }
  const handler = loadTrustedGameplayModule('server/api/encounters/[id]/actions/clash-action.post.ts', {
    '../../../../db': f.store, 'drizzle-orm': f.sql, '../../../../utils/fallDamage': f.falls,
    '~/server/utils/mapMovement': { ...loadTypeScript('server/utils/mapMovement.ts'), findThrowLandingCell: () => ({ x: 1, y: 10, z: 0 }) },
    '~/server/utils/combatSpatial': { loadEncounterMap: async () => map, loadParticipantDigimon: async () => new Map(),
      getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: false, hasTumbler: false, hasAdvJumper: false }) },
    '~/server/utils/encounterRoom': { getRoomPositions: async () => positions,
      getRoomSnapshot: async () => ({ participantPositions: positions, destructibleStates: [] }),
      broadcastPositionPatch: async (_id, patch) => Object.assign(positions, patch) },
    '~/server/utils/guidingLight': { recomputeGuidingLightForEncounter: async () => {} },
    '~/server/utils/damageOverTime': { loadCampaignDamageOverTimeRules: async () => ({}),
      applyMovementBurn: participants => ({ participants, damageById: {} }) },
    '~/server/utils/enemyKnockouts': { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: async state => ({ ...state, changed: false }) },
  }).default
  const result = await handler({ participantId: 'thrower', clashId: 'clash', actionType: 'throw', landingPos: { x: 1, y: 10, z: 0 } })
  await f.falls.finishFallProtection('enc', result)
  assert.deepEqual(positions.tai, { x: 1, y: 0, z: 0 })
  assert.equal(f.encounter.participants.find(p => p.id === 'tai').currentWounds, 2, 'one normal throw wound is applied immediately')
  assert.equal(f.encounter.pendingRequests[0].data.pendingDamage, 4, 'only the fall is offered for protection')
  assert.equal(f.encounter.battleLog[0].damage, 1)
  await f.respond(true)
  assert.equal(f.encounter.participants.find(p => p.id === 'tai').currentWounds, 2)
})
