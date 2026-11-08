import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { combatAttackStats } = loadTypeScript('utils/combatDice.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

function fixture(type = 'support', tags = [], effect = 'Taunt') {
  const attack = { id: 'taunt-attack', name: 'Provoke', type, range: 'ranged', effect, tags }
  const baseStats = { accuracy: 12, damage: 8, dodge: 0, armor: 0, health: 20 }
  const records = [
    { id: 'taunter-form', name: 'Twinmon', stage: 'rookie', size: 'medium', baseStats, bonusStats: {}, qualities: [], attacks: [attack] },
    { id: 'defender-form', name: 'Defender', stage: 'rookie', size: 'medium', baseStats, bonusStats: {}, qualities: [], attacks: [] },
  ]
  const participants = records.map((record, index) => ({
    id: index ? 'defender-token' : 'taunter-token', type: 'digimon', entityId: record.id,
    activeEffects: [], currentWounds: 0, maxWounds: 100, totalHealth: 100, actionsRemaining: { simple: 2 },
  }))
  const encounter = { id: 'encounter', phase: 'combat', round: 1, participants, turnOrder: participants.map(p => p.id),
    currentTurnIndex: 0, battleLog: [], pendingRequests: [], requestResponses: [] }
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'maps', 'evolutionLines'].map(name => [name, { name, id: name }]))
  const db = {
    select: () => ({ from: table => ({ where: async condition => {
      if (table === tables.encounters) return [encounter]
      if (table === tables.digimon) return records.filter(record => Array.isArray(condition.value) ? condition.value.includes(record.id) : record.id === condition.value)
      return []
    } }) }),
    update: table => ({ set: patch => ({ where: async () => {
      assert.equal(table, tables.encounters)
      Object.assign(encounter, patch)
    } }) }),
  }
  const store = { db, ...tables }
  const sql = { eq: (_column, value) => ({ value }), inArray: (_column, value) => ({ value }) }
  const support = loadTypeScriptWithMocks('server/utils/resolveSupportAttack.ts', { '../db': store, 'drizzle-orm': sql })
  const damage = loadTypeScriptWithMocks('server/utils/computeAttackDamage.ts', {
    '../db': store, 'drizzle-orm': sql, './resolveSupportAttack': support,
    './clashArmor': { getOutsideClashArmorBonus: async () => 0 }, './damageOverTime': { isImmuneToEffect: () => false },
  })
  const unchanged = async state => ({ ...state, changed: false, logEntries: [] })
  const knockouts = { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: unchanged }
  const refresh = { refreshGuidingLightForParticipants: async (_id, current) => current }
  const unexpected = () => { throw new Error('Unexpected unrelated combat operation') }
  const mocks = {
    'drizzle-orm': sql,
    '../../../db': store,
    '../../../utils/resolveSupportAttack': support,
    '../../../utils/clashArmor': { getOutsideClashArmorBonus: async () => 0 },
    '../../../utils/partnerDevolution': { autoDevolveParticipant: async () => null },
    '../../../utils/damageOverTime': { isImmuneToEffect: () => false },
    '../../../utils/enemyKnockouts': knockouts,
    '../../../utils/guidingLight': refresh,
    '../../../utils/triggerCounterattack': { triggerCounterattack: unexpected },
    '../../../utils/resolveNpcAttack': { resolveNpcAttack: unexpected },
    '../../../../db': store,
    '../../../../utils/resolveSupportAttack': support,
    '../../../../utils/partnerDevolution': { autoDevolveParticipant: async () => null },
    '../../../../utils/enemyKnockouts': knockouts,
    '../../../../utils/guidingLight': refresh,
  }
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async event => event
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const params = {
    participants, battleLog: [], pendingRequests: [], attackerParticipantId: participants[0].id,
    targetParticipantId: participants[1].id, attackDef: attack, attackId: attack.id,
    accuracySuccesses: 3, accuracyDice: [6, 6, 6], round: 1, attackerName: 'Twinmon', targetName: 'Defender',
    encounterId: 'encounter', turnOrder: encounter.turnOrder,
  }
  let positions = {}
  const room = { getRoomPositions: async () => positions, broadcastPositionPatch: unexpected }
  const area = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
    '../db': store, 'drizzle-orm': sql, './resolveNpcAttack': { resolveNpcAttack: unexpected },
    './enemyKnockouts': knockouts, '~/server/utils/resolveSupportAttack': support,
  })
  const decision = loadTypeScriptWithMocks('server/utils/intercedeDecision.ts', {
    '../db': store, 'drizzle-orm': sql, '~/server/utils/resolveSupportAttack': support,
    '~/server/utils/encounterRoom': room, '~/server/utils/resolveAreaIntercedeGroup': area,
    '~/server/utils/combatSpatial': { loadEncounterMap: async () => ({ id: 'map' }) },
  })
  return {
    attack, records, participants, encounter, support, params,
    damage: overrides => damage.computeAttackDamage({
      ...params, attackerParticipant: participants[0], targetParticipant: participants[1], dodgeSuccesses: 0, ...overrides,
    }),
    offer: async (areaAttack = false, playerAttack = false) => {
      records.push({ ...records[1], id: 'guard-form', name: 'Guard' })
      participants.push({ ...participants[1], id: 'guard-token', entityId: 'guard-form', activeEffects: [] })
      const mapMocks = {}
      if (areaAttack) {
        encounter.mapId = 'map'
        positions = { 'taunter-token': { x: 0, y: 0, z: 0 }, 'defender-token': { x: 2, y: 0, z: 0 }, 'guard-token': { x: 5, y: 0, z: 0 } }
        // Eligibility geometry is covered by intercedeClaims; keep this regression
        // focused on preserving the attack through the deferred queue.
        mapMocks['~/server/utils/combatSpatial'] = {
          loadEncounterMap: async () => ({ id: 'map' }),
          getMovementProfile: () => ({ budget: 10, caps: {}, bodyStat: 10 }),
        }
        mapMocks['~/server/utils/mapMovement'] = {
          ...loadTypeScript('server/utils/mapMovement.ts'),
          findAreaIntercedePosition: () => ({ x: 3, y: 0, z: 0 }), hasValidThrowOutOfAreaCell: () => true,
        }
      }
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-offer.post.ts', {
        '../../../../db': store, 'drizzle-orm': sql,
        '~/server/utils/resolveSupportAttack': support,
        '~/server/utils/encounterRoom': room,
        '~/server/utils/intercedePasses': { applyActivePasses: unexpected, passableOfferOwners: () => [] },
        ...mapMocks,
      }).default
      return handler({ attackerId: participants[0].id,
        ...(areaAttack ? { targetIds: [participants[1].id] } : { targetId: participants[1].id }),
        attackId: attack.id, attackName: attack.name, accuracySuccesses: 3, accuracyDice: [6, 6, 6],
        attackData: playerAttack ? { dicePool: 3 } : { dicePool: 3, attackStats: { accuracy: 3 } },
        ...(areaAttack ? { areaShapeData: { shape: 'blast', rangeType: 'ranged', attackerPos: positions['taunter-token'],
          dir: { x: 1, y: 0, z: 0 }, bit: 1, ram: 1, movement: 5, attackerDims: { width: 1, height: 1, depth: 1 }, blastCenter: positions['defender-token'] } } : {}) })
    },
    skip: async requestId => {
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-skip.post.ts', {
        '../../../../db': store, 'drizzle-orm': sql, '~/server/utils/intercedeDecision': decision,
      }).default
      return handler({ requestId })
    },
    respond: async (accuracySuccesses = 3) => {
      encounter.pendingRequests = [{ id: 'defense', type: 'dodge-roll', targetTamerId: 'owner', targetParticipantId: participants[1].id,
        data: { attackerParticipantId: participants[0].id, attackerEntityId: records[0].id, targetEntityId: records[1].id,
          attackerName: 'Twinmon', targetName: 'Defender', attackId: attack.id, attackData: attack, isSupportAttack: type === 'support',
          accuracySuccesses, accuracyDice: [6, 6, 6], totalTargetCount: 1 } }]
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', mocks).default
      return handler({ requestId: 'defense', tamerId: 'owner', response: { type: 'dodge-rolled', dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [] } })
    },
    legacy: async () => {
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/npc-attack.post.ts', mocks).default
      return handler({ participantId: participants[0].id, targetId: participants[1].id, attackId: attack.id,
        accuracyDicePool: 3, accuracySuccesses: 3, accuracyDiceResults: [6, 6, 6], dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [] })
    },
  }
}

async function assertTaunt(f, effect) {
  assert.ok(effect, 'a successful Taunt attack must add its effect')
  assert.equal(effect.type, 'debuff')
  const derived = await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])
  assert.equal(effect.duration, 3)
  assert.equal(effect.potency, derived.cpu * 2)
  assert.equal(effect.potencyStat, 'cpu')
  assert.equal(effect.source, f.participants[0].id)
  const defender = { ...f.participants[1], activeEffects: [effect] }
  const normalAttack = { range: 'ranged', type: 'damage', tags: [] }
  const accuracy = (targetIds, attack = normalAttack) => combatAttackStats(f.records[1], defender, attack, { targetIds }).accuracy
  assert.equal(accuracy([effect.source]), 12, 'attacking the taunter has no penalty')
  assert.equal(accuracy(['a-different-Twinmon']), Math.max(0, 12 - derived.cpu * 2), 'another token is not the taunter')
  assert.equal(accuracy(['other', effect.source], { ...normalAttack, tags: ['Area Attack: Burst'] }),
    12 - Math.max(0, derived.cpu - 2), 'an area attack including the taunter uses CPU -2')
}

test('Taunt potency is twice the attacker CPU, regardless of the target CPU', () => {
  const { support } = fixture()
  assert.deepEqual(support.calculateEffectPotency('Taunt', { cpu: 4 }, { cpu: 99 }), { potency: 8, potencyStat: 'cpu' })
  assert.deepEqual(support.calculateEffectPotency('Lifesteal', { cpu: 4 }, null), { potency: 4, potencyStat: 'cpu' })
})

for (const type of ['support', 'damage']) {
  test(`the canonical ${type} attack/intercede calculation builds a usable Taunt`, async () => {
    const f = fixture(type)
    const result = await f.damage()
    assert.equal(result.hit, true)
    assert.equal(result.appliedEffectName, 'Taunt')
    await assertTaunt(f, result.effectData)
  })

  test(`a player's completed defense adds Taunt from a ${type} attack`, async () => {
    const f = fixture(type)
    const result = await f.respond()
    const defender = result.participants.find(p => p.id === 'defender-token')
    await assertTaunt(f, defender.activeEffects.find(e => e.name === 'Taunt'))
    assert.equal(type === 'support' ? defender.currentWounds : defender.currentWounds > 0, type === 'support' ? 0 : true)
  })

  test(`the GM's completed ${type} attack adds Taunt with source and potency`, async () => {
    const f = fixture(type)
    const result = await f.legacy()
    await assertTaunt(f, result.participants.find(p => p.id === 'defender-token').activeEffects.find(e => e.name === 'Taunt'))
  })
}

test('a negative support attack adds Taunt after an NPC dodge, without dealing damage', async t => {
  t.mock.method(Math, 'random', () => 0)
  const f = fixture()
  const result = await f.support.resolveNegativeSupportNpc(f.params)
  const defender = result.participants.find(p => p.id === 'defender-token')
  await assertTaunt(f, defender.activeEffects.find(e => e.name === 'Taunt'))
  assert.equal(defender.currentWounds, 0)
})

for (const areaAttack of [false, true]) {
  for (const playerAttack of [false, true]) {
    test(`${playerAttack ? 'player' : 'GM'} ${areaAttack ? 'area' : 'single-target'} support Taunt survives an intercede offer and Skip`, async t => {
      t.mock.method(Math, 'random', () => 0)
      const f = fixture('support', areaAttack ? ['Area Attack: Burst'] : [])
      const offered = await f.offer(areaAttack, playerAttack)
      const offer = offered.pendingRequests.find(request => request.type === 'intercede-offer')
      assert.ok(offer, 'a third NPC can intercede before the target dodges')
      assert.equal(offer.data.attackData.effect, 'Taunt')
      assert.equal(offer.data.attackData.type, 'support')
      assert.equal(offer.data.attackData.dicePool, 3)
      assert.equal(offered.participants[1].activeEffects.length, 0, 'the effect waits for the decision')
      const result = await f.skip(offer.id)
      const defender = result.participants.find(p => p.id === 'defender-token')
      await assertTaunt(f, defender.activeEffects.find(effect => effect.name === 'Taunt'))
      assert.equal(defender.currentWounds, 0)
      assert.equal(result.pendingRequests.some(request => request.type === 'intercede-offer' || request.type === 'intercede-group-state'), false)
      assert.ok(result.battleLog.some(entry => entry.effects?.includes('Applied: Taunt')))
    })
  }

  test(`an already-pending ${areaAttack ? 'area' : 'single-target'} Taunt recovers a missing effect definition`, async t => {
    t.mock.method(Math, 'random', () => 0)
    const f = fixture('support', areaAttack ? ['Area Attack: Burst'] : [])
    const offered = await f.offer(areaAttack, true)
    const offer = offered.pendingRequests.find(request => request.type === 'intercede-offer')
    for (const pending of offered.pendingRequests) pending.data.attackData = { dicePool: 3 }
    const result = await f.skip(offer.id)
    await assertTaunt(f, result.participants[1].activeEffects.find(effect => effect.name === 'Taunt'))
  })

  for (const effect of ['Stun', 'Poison', 'Shield', 'Fury']) {
    test(`${effect} also resolves after a ${areaAttack ? 'area' : 'single-target'} intercede wait`, async t => {
      t.mock.method(Math, 'random', () => 0.99)
      const f = fixture('support', areaAttack ? ['Area Attack: Burst'] : [], effect)
      const offered = await f.offer(areaAttack, true)
      const offer = offered.pendingRequests.find(request => request.type === 'intercede-offer')
      const result = await f.skip(offer.id)
      const defender = result.participants.find(p => p.id === 'defender-token')
      assert.ok(defender.activeEffects.some(active => active.name === effect))
      assert.equal(defender.currentWounds, 0)
    })
  }
}

test('a missed attack does not add Taunt', async () => {
  const f = fixture('damage')
  const result = await f.damage({ dodgeSuccesses: 4 })
  assert.equal(result.hit, false)
  assert.equal(result.effectData, null)
})

test('damage effects retain their existing two-damage threshold', async () => {
  const f = fixture('damage')
  f.records[0].baseStats = { ...f.records[0].baseStats, damage: 0 }
  const result = await f.damage({ accuracySuccesses: 0 })
  assert.equal(result.damageDealt, 1)
  assert.equal(result.effectData, null)
})

test('Selective Targeting shields allies from the negative Taunt effect in an area attack', async () => {
  const f = fixture('support', ['Area Attack: Burst'])
  f.records[0].qualities.push({ id: 'selective-targeting' })
  assert.equal((await f.damage({ totalTargetCount: 2 })).effectData, null)
  f.participants[1].isEnemy = true
  await assertTaunt(f, (await f.damage({ totalTargetCount: 2 })).effectData)
})
