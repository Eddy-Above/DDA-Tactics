import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const point = (x, z = 5) => ({ x, y: 0, z })

function fixture(effect = 'Knockback', type = 'damage', shape = 'Burst') {
  const attack = { id: 'area', name: 'Wave', effect, type, range: 'ranged', tags: [`Area Attack: ${shape}`] }
  const records = ['caster', 'east', 'north', 'guard'].map(id => ({ id, name: id, stage: 'rookie', size: 'medium',
    baseStats: { accuracy: 8, damage: 5, dodge: 0, armor: 0, health: 20 }, bonusStats: {}, qualities: [], attacks: id === 'caster' ? [attack] : [] }))
  const participants = records.map(record => ({ id: record.id, entityId: record.id, type: 'digimon', currentWounds: 0, maxWounds: 100,
    totalHealth: 100, activeEffects: [], actionsRemaining: { simple: 2 } }))
  const map = { id: 'map', dimensions: { width: 20, depth: 20 }, groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], stairs: [], ceilings: [] }
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) map.groundTiles.push({ x, y: 0, z, terrain: 'grass' })
  const positions = { caster: point(5), east: point(7), north: point(5, 7), guard: point(12, 12) }
  const room = structuredClone(positions), broadcasts = []
  const encounter = { id: 'encounter', mapId: 'map', participants, phase: 'combat', round: 1,
    turnOrder: participants.map(participant => participant.id), currentTurnIndex: 0, pendingRequests: [], requestResponses: [], battleLog: [] }
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'maps', 'evolutionLines'].map(name => [name, { name, id: name }]))
  const db = { select: () => ({ from: table => ({ where: async condition => {
    if (table === tables.encounters) return [encounter]
    if (table === tables.maps) return [map]
    if (table === tables.digimon) return records.filter(record => Array.isArray(condition.value) ? condition.value.includes(record.id) : record.id === condition.value)
    return []
  } }) }), update: () => ({ set: patch => ({ where: async () => { Object.assign(encounter, patch) } }) }) }
  const store = { db, ...tables }, sql = { eq: (_column, value) => ({ value }), inArray: (_column, value) => ({ value }) }
  const common = { '../db': store, 'drizzle-orm': sql }
  const support = loadTypeScriptWithMocks('server/utils/resolveSupportAttack.ts', common)
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', { ...common, './resolveSupportAttack': support })
  const knockouts = { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }) }
  const aura = { refreshGuidingLightForParticipants: async (_id, current) => current,
    applyGuidingLightAuras: async current => ({ changed: false, participants: current }) }
  const roomModule = { getRoomPositions: async () => ({ ...room }), broadcastPositionPatch: async (_id, patch) => {
    broadcasts.push(structuredClone(patch)); Object.assign(room, patch)
  } }
  const pushPull = loadTypeScriptWithMocks('server/utils/pushPull.ts', {
    './combatSpatial': spatial, './resolveSupportAttack': support, './encounterRoom': roomModule,
    './enemyKnockouts': knockouts, './guidingLight': aura,
    './damageOverTime': { loadEncounterRules: async () => ({ round: 1, rules: {} }), applyMovementBurn: current => ({ participants: current, damageById: {} }) },
  })
  const damage = loadTypeScriptWithMocks('server/utils/computeAttackDamage.ts', {
    ...common, './resolveSupportAttack': support, './clashArmor': { getOutsideClashArmorBonus: async () => 0 },
    './damageOverTime': { isImmuneToEffect: () => false },
  })
  const npc = loadTypeScriptWithMocks('server/utils/resolveNpcAttack.ts', {
    ...common, './computeAttackDamage': damage, './combatSpatial': spatial, './pushPull': pushPull,
    './enemyKnockouts': knockouts, './guidingLight': aura, './partnerDevolution': { autoDevolveParticipant: async () => null },
    './damageOverTime': { loadDamageOverTimeRules: async () => ({}) },
  })
  const area = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
    ...common, './resolveNpcAttack': npc, './combatSpatial': spatial, './pushPull': pushPull,
    './enemyKnockouts': knockouts, './guidingLight': aura, '~/server/utils/resolveSupportAttack': support,
    './partnerDevolution': { autoDevolveParticipant: async () => null },
  })
  const groupState = { id: 'group-state', type: 'intercede-group-state', data: { intercedeGroupId: 'cast', attackerId: 'caster',
    attackerName: 'Caster', attackId: attack.id, attackName: attack.name, attackData: attack, isSupportAttack: type === 'support',
    accuracySuccesses: 3, accuracyDice: [6, 6, 6], originalTargetIds: ['east', 'north'], npcTargetIds: ['east', 'north'], claims: [] } }
  const params = { groupState, participants, battleLog: [], pendingRequests: [groupState], turnOrder: encounter.turnOrder,
    round: 1, currentTurnIndex: 0, encounterId: encounter.id, positions, mapRecord: map, mapId: map.id, database: db }
  const decision = loadTypeScriptWithMocks('server/utils/intercedeDecision.ts', {
    ...common, '~/server/utils/encounterRoom': roomModule, '~/server/utils/resolveAreaIntercedeGroup': area,
  })
  return { attack, records, participants, map, positions, room, broadcasts, groupState, params, support,
    run: () => area.resolveAreaIntercedeGroup(params),
    skip: () => decision.resolveIntercedeGroupIfDecided({ encounterId: encounter.id, mapId: map.id, mapRecord: map,
      participantPositions: positions, campaignLevel: 'standard' }, { ...params, resolved: false },
      { data: { isAreaAttack: true, intercedeGroupId: 'cast' } }),
    respond: async () => {
      globalThis.defineEventHandler = handler => handler
      globalThis.getRouterParam = () => encounter.id
      globalThis.readBody = async body => body
      globalThis.createError = data => Object.assign(new Error(data.message), data)
      encounter.pendingRequests = [{ id: 'dodge', type: 'dodge-roll', targetTamerId: 'owner', targetParticipantId: 'east',
        data: { attackerParticipantId: 'caster', attackerEntityId: 'caster', targetEntityId: 'east', attackerName: 'Caster', targetName: 'east',
          attackId: attack.id, attackData: attack, accuracySuccesses: 3, accuracyDice: [6, 6, 6], isSupportAttack: type === 'support', totalTargetCount: 2 } }]
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', {
        '../../../db': store, 'drizzle-orm': sql, '../../../utils/resolveSupportAttack': support,
        '../../../utils/pushPull': pushPull, '../../../utils/enemyKnockouts': knockouts, '../../../utils/guidingLight': aura,
        '../../../utils/clashArmor': { getOutsideClashArmorBonus: async () => 0 },
        '../../../utils/partnerDevolution': { autoDevolveParticipant: async () => null }, '../../../utils/damageOverTime': { isImmuneToEffect: () => false },
      }).default
      return handler({ requestId: 'dodge', tamerId: 'owner', response: { type: 'dodge-rolled', dodgeDicePool: 0, dodgeDiceResults: [], dodgeSuccesses: 0 } })
    },
  }
}

for (const shape of ['Blast', 'Burst', 'Close Blast', 'Cone', 'Line', 'Pass']) {
  for (const type of ['damage', 'support']) {
    for (const effect of ['Knockback', 'Pull']) {
      test(`${shape} ${type} ${effect} moves every uncovered NPC after intercede decisions`, async t => {
        t.mock.method(Math, 'random', () => 0)
        const f = fixture(effect, type, shape)
        const result = await f.run()
        const derived = await f.support.getDigimonDerivedStats('caster')
        const distance = derived.cpu + derived.stageBonus
        assert.deepEqual(result.positionPatch.east, point(effect === 'Knockback' ? 7 + distance : 6))
        assert.deepEqual(result.positionPatch.north, point(5, effect === 'Knockback' ? 7 + distance : 6))
        assert.equal(result.participants.find(participant => participant.id === 'east').currentWounds > 0, type === 'damage')
        assert.equal(f.broadcasts.length, 0, 'group resolution must not publish positions before its caller commits')
        assert.deepEqual(f.positions.east, point(7), 'the supplied board snapshot is immutable')
      })
    }
  }
}

test('the last Skip broadcasts the complete area displacement patch', async t => {
  t.mock.method(Math, 'random', () => 0)
  const f = fixture()
  await f.skip()
  assert.equal(f.broadcasts.length, 1)
  assert.deepEqual(Object.keys(f.broadcasts[0]).sort(), ['east', 'north'])
  assert.notDeepEqual(f.room.east, point(7))
})

test('later area Pull targets use the positions already changed by earlier targets', async t => {
  t.mock.method(Math, 'random', () => 0)
  const f = fixture('Pull')
  f.positions.north = point(9)
  const result = await f.run()
  assert.deepEqual(result.positionPatch.east, point(6))
  assert.deepEqual(result.positionPatch.north, point(7))
})

for (const type of ['support', 'damage']) {
  test(`an area ${type} Knockback moves the hit interceptor rather than the protected target`, async t => {
    t.mock.method(Math, 'random', () => 0)
    const f = fixture('Knockback', type)
    f.positions.east = point(7, 9)
    f.positions.guard = point(7)
    f.groupState.data.originalTargetIds = ['east']
    f.groupState.data.npcTargetIds = ['east']
    f.groupState.data.claims = [{ interceptorParticipantId: 'guard', targetId: 'east', interceptorName: 'Guard', targetName: 'east',
      damageDealt: type === 'damage' ? 3 : 0, appliedEffectName: 'Knockback', effectData: { name: 'Knockback', potency: 2 },
      isSupportAttack: type === 'support', netSuccesses: 3 }]
    const result = await f.run()
    assert.deepEqual(result.positionPatch.guard, point(9))
    assert.equal(result.positionPatch.east, undefined)
    assert.equal(f.broadcasts.length, 0)
  })

  test(`a player defense applies area ${type} Knockback to the defended character`, async () => {
    const f = fixture('Knockback', type)
    const result = await f.respond()
    assert.ok(f.room.east.x > 7)
    assert.equal(result.participants.find(participant => participant.id === 'east').currentWounds > 0, type === 'damage')
  })
}

test('Immunity prevents area displacement without preventing damage', async t => {
  t.mock.method(Math, 'random', () => 0)
  const f = fixture()
  f.records.find(record => record.id === 'east').qualities = [{ id: 'immunity' }]
  const result = await f.run()
  assert.equal(result.positionPatch.east, undefined)
  assert.ok(result.positionPatch.north)
  assert.ok(result.participants.find(participant => participant.id === 'east').currentWounds > 0)
})
