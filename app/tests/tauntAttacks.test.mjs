import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { combatAttackStats } = loadTypeScript('utils/combatDice.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError', '$fetch']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
for (const area of [false, true]) for (const variant of ['ordinary', 'bolster', 'lifesteal', 'haste', 'lag', 'shield', 'shield-complex', 'pass', 'charge-pass', 'already-paid']) {
  test(`GM ${area ? 'area' : 'single-target'} ${variant} deduction matches the radial cost`, async () => {
    const effect = variant.startsWith('shield') ? 'Shield' : ({ haste: 'Haste', lag: 'Lag', lifesteal: 'Lifesteal' }[variant] ?? 'Taunt')
    const f = fixture(variant === 'lifesteal' ? 'damage' : 'support', variant.includes('pass') ? ['Area Attack: Pass', ...(variant === 'charge-pass' ? ['Charge Attack'] : [])] : [], effect)
    const updated = await f.offer(area, false, { bolstered: variant === 'bolster', lifestealed: variant === 'lifesteal', shieldComplex: variant === 'shield-complex', skipActionDeduction: variant === 'already-paid' })
    const spent = ['bolster', 'lifesteal', 'haste', 'lag', 'shield-complex', 'pass'].includes(variant) ? 2 : variant === 'already-paid' ? 0 : 1
    assert.equal(updated.participants.find(p => p.id === 'taunter-token').actionsRemaining.simple, 2 - spent)
  })
}
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
  const npc = loadTypeScriptWithMocks('server/utils/resolveNpcAttack.ts', {
    '../db': store, 'drizzle-orm': sql, './computeAttackDamage': damage, './enemyKnockouts': knockouts,
    './partnerDevolution': { autoDevolveParticipant: async () => null },
  })
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
    '../../../../utils/pushPull': { applyPushPullDisplacement: unexpected },
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
    '../db': store, 'drizzle-orm': sql, './resolveNpcAttack': npc,
    './enemyKnockouts': knockouts, '~/server/utils/resolveSupportAttack': support,
  })
  const decision = loadTypeScriptWithMocks('server/utils/intercedeDecision.ts', {
    '../db': store, 'drizzle-orm': sql, '~/server/utils/resolveSupportAttack': support,
    '~/server/utils/encounterRoom': room, '~/server/utils/resolveAreaIntercedeGroup': area,
    '~/server/utils/combatSpatial': { loadEncounterMap: async () => ({ id: 'map' }) },
    '~/server/utils/resolveNpcAttack': npc,
  })
  return {
    attack, records, participants, encounter, support, params,
    npc: overrides => npc.resolveNpcAttack({ ...params, ...overrides }),
    playerAttack: async flags => {
      const offerHandler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-offer.post.ts', {
        '../../../../db': store, 'drizzle-orm': sql, '~/server/utils/resolveSupportAttack': support,
        '~/server/utils/resolveNpcAttack': npc, '~/server/utils/encounterRoom': room,
        '~/server/utils/intercedePasses': { applyActivePasses: unexpected, passableOfferOwners: () => [] },
      }).default
      globalThis.$fetch = async (url, { body }) => { assert.ok(url.endsWith('/intercede-offer')); return offerHandler(body) }
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/attack.post.ts', mocks).default
      return handler({ participantId: participants[0].id, targetId: participants[1].id, attackId: attack.id, tamerId: 'owner',
        accuracyDicePool: 3, accuracySuccesses: 3, accuracyDiceResults: [6, 6, 6], ...flags })
    },
    health: async flags => {
      records[1].partnerId = 'owner'
      const prepared = await support.resolvePositiveHealth({ ...params, ...flags })
      encounter.participants = prepared.participants
      encounter.pendingRequests = prepared.pendingRequests
      const request = encounter.pendingRequests.find(request => request.type === 'health-roll')
      assert.ok(request)
      const pool = request.data.healthDicePool
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', mocks).default
      return handler({ requestId: request.id, tamerId: 'owner', response: { type: 'health-rolled', healthDicePool: pool,
        healthSuccesses: pool, healthDiceResults: Array(pool).fill(6) } })
    },
    damage: overrides => damage.computeAttackDamage({
      ...params, attackerParticipant: participants[0], targetParticipant: participants[1], dodgeSuccesses: 0, ...overrides,
    }),
    offer: async (areaAttack = false, playerAttack = false, bodyOverrides = {}) => {
      if (!records.some(record => record.id === 'guard-form')) {
        records.push({ ...records[1], id: 'guard-form', name: 'Guard' })
        participants.push({ ...participants[1], id: 'guard-token', entityId: 'guard-form', activeEffects: [] })
      }
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
        '~/server/utils/resolveNpcAttack': npc,
        '~/server/utils/encounterRoom': room,
        '~/server/utils/intercedePasses': { applyActivePasses: unexpected, passableOfferOwners: () => [] },
        ...mapMocks,
      }).default
      return handler({ attackerId: participants[0].id,
        ...(areaAttack ? { targetIds: [participants[1].id] } : { targetId: participants[1].id }),
        attackId: attack.id, attackName: attack.name, accuracySuccesses: 3, accuracyDice: [6, 6, 6],
        attackData: playerAttack ? { dicePool: 3 } : { dicePool: 3, attackStats: { accuracy: 3 } },
        ...(areaAttack ? { areaShapeData: { shape: 'blast', rangeType: 'ranged', attackerPos: positions['taunter-token'],
          dir: { x: 1, y: 0, z: 0 }, bit: 1, ram: 1, movement: 5, attackerDims: { width: 1, height: 1, depth: 1 }, blastCenter: positions['defender-token'] } } : {}), ...bodyOverrides })
    },
    skip: async requestId => {
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-skip.post.ts', {
        '../../../../db': store, 'drizzle-orm': sql, '~/server/utils/intercedeDecision': decision,
      }).default
      return handler({ requestId })
    },
    respond: async (accuracySuccesses = 3, flags = {}) => {
      const existing = encounter.pendingRequests.find(request => request.type === 'dodge-roll')
      if (!existing) encounter.pendingRequests = [...encounter.pendingRequests, { id: 'defense', type: 'dodge-roll', targetTamerId: 'owner', targetParticipantId: participants[1].id,
        data: { attackerParticipantId: participants[0].id, attackerEntityId: records[0].id, targetEntityId: records[1].id,
          attackerName: 'Twinmon', targetName: 'Defender', attackId: attack.id, attackData: attack, isSupportAttack: type === 'support',
          accuracySuccesses, accuracyDice: [6, 6, 6], totalTargetCount: 1, ...flags } }]
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', mocks).default
      return handler({ requestId: existing?.id ?? 'defense', tamerId: 'owner', response: { type: 'dodge-rolled', dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [] } })
    },
    legacy: async (flags = {}) => {
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/npc-attack.post.ts', mocks).default
      return handler({ participantId: participants[0].id, targetId: participants[1].id, attackId: attack.id,
        accuracyDicePool: 3, accuracySuccesses: 3, accuracyDiceResults: [6, 6, 6], dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [], ...flags })
    },
  }
}

for (const complex of [false, true]) {
  test(`Lifesteal ${complex ? 'Complex' : 'ordinary'} heals up to ${complex ? 'twice ' : ''}CPU against NPC and player defenses`, async () => {
    for (const player of [false, true]) {
      const f = fixture('damage', [], 'Lifesteal')
      f.participants[0].currentWounds = 20
      const cpu = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).cpu
      const result = player ? await f.respond(3, { lifestealed: complex }) : await f.npc({ lifestealed: complex })
      assert.equal(result.participants[0].currentWounds, 20 - cpu * (complex ? 2 : 1))
      assert.equal(result.participants[1].activeEffects.some(effect => effect.name === 'Lifesteal'), false, 'instant healing has no duration')
    }
  })
}

test('one Wound Box of damage still heals one with Lifesteal, even with the Complex option', async t => {
  t.mock.method(Math, 'random', () => 0) // NPC Dodge rolls must fail to guarantee exactly one damage.
  for (const player of [false, true]) for (const complex of [false, true]) {
    const f = fixture('damage', [], 'Lifesteal')
    f.records[0].baseStats.damage = 0
    f.participants[0].currentWounds = 10
    const result = player ? await f.respond(1, { lifestealed: complex }) : await f.npc({ accuracySuccesses: 1, lifestealed: complex })
    assert.equal(result.participants[0].currentWounds, 9)
    assert.equal(result.participants[1].currentWounds, 1)
  }
})

test('doubled Lifesteal survives the single-target and area intercede Skip paths', async () => {
  for (const area of [false, true]) {
    const f = fixture('damage', area ? ['Area Attack: Burst'] : [], 'Lifesteal')
    f.participants[0].currentWounds = 20
    const cpu = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).cpu
    await f.offer(area, false, { lifestealed: true })
    const offers = f.encounter.pendingRequests.filter(request => request.type === 'intercede-offer')
    assert.ok(offers.length)
    for (const offer of offers) await f.skip(offer.id)
    assert.equal(f.encounter.participants[0].currentWounds, 20 - cpu * 2)
  }
})

test('Triple Shield grants BIT times three temp wounds without increasing Combat Monster, and all Shield attacks share the round limit', async () => {
  const f = fixture('support', [], 'Shield')
  f.participants[1].combatMonsterBonus = 4
  const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
  await f.offer(false, false, { shieldComplex: true })
  for (const offer of f.encounter.pendingRequests.filter(request => request.type === 'intercede-offer')) await f.skip(offer.id)
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 0)
  assert.equal(f.encounter.participants[0].lastShieldRound, 1)
  assert.equal(f.encounter.participants[1].currentTempWounds, bit * 3)
  assert.equal(f.encounter.participants[1].activeEffects.find(effect => effect.name === 'Shield').duration, 0)
  assert.equal(f.encounter.participants[1].combatMonsterBonus, 4)
  f.encounter.participants[0].actionsRemaining.simple = 2
  f.attack.id = 'another-shield-attack'
  await assert.rejects(f.offer(), error => error.statusCode === 403 && /once per round/.test(error.message))
  f.encounter.round = 2
  await f.offer()
  assert.equal(f.encounter.participants[0].lastShieldRound, 2)
})

test('server declarations reject Bolster combined with doubled Lifesteal or Triple Shield before deducting actions', async () => {
  for (const effect of ['Lifesteal', 'Shield']) {
    const f = fixture(effect === 'Shield' ? 'support' : 'damage', [], effect)
    await assert.rejects(f.offer(false, false, { bolstered: true, lifestealed: effect === 'Lifesteal', shieldComplex: effect === 'Shield' }),
      error => error.statusCode === 400 && /Cannot combine Bolster/.test(error.message))
    assert.equal(f.encounter.participants[0].actionsRemaining.simple, 2)
  }
})

test('player attack declarations spend two actions for Triple Shield, Haste and Lag, and cannot repeat Shield this round', async () => {
  for (const effect of ['Shield', 'Haste', 'Lag']) {
    const f = fixture('support', [], effect)
    let result = await f.playerAttack(effect === 'Shield' ? { shieldComplex: true } : {})
    for (const offer of f.encounter.pendingRequests.filter(request => request.type === 'intercede-offer')) await f.skip(offer.id)
    result = f.encounter
    assert.equal(result.participants[0].actionsRemaining.simple, 0)
    if (effect === 'Shield') {
      const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
      assert.equal(result.participants[1].currentTempWounds, bit * 3, 'Triple Shield survives the player intercede decision')
      assert.equal(result.participants[0].lastShieldRound, 1)
      f.encounter.participants[0].actionsRemaining.simple = 2
      f.attack.id = 'other-shield'
      await assert.rejects(f.playerAttack({}), error => error.statusCode === 403 && /once per round/.test(error.message))
    }
    if (effect === 'Haste') assert.equal(result.participants[1].actionsRemaining.simple, 3)
    if (effect === 'Lag') assert.equal(result.participants[1].activeEffects.find(effect => effect.name === 'Lag').appliesRound, 2)
  }
})

test('Shield and Haste resource changes also apply after a player area Health response', async () => {
  for (const effect of ['Shield', 'Haste']) {
    const f = fixture('support', ['Area Attack: Burst'], effect)
    const result = await f.health({ shieldComplex: effect === 'Shield' })
    if (effect === 'Shield') {
      const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
      assert.equal(result.participants[1].currentTempWounds, bit * 3)
      assert.equal(result.participants[1].activeEffects.find(effect => effect.name === 'Shield').duration, 0)
    } else {
      assert.equal(result.participants[1].actionsRemaining.simple, 3)
      assert.equal(result.participants[1].activeEffects.find(effect => effect.name === 'Haste').duration, 1, 'the action credit never inherits a Health-based duration')
    }
  }
})

test('Lag’s roll is scheduled for next round on both NPC and player defenses', async t => {
  const random = Math.random
  t.after(() => { Math.random = random })
  Math.random = () => 0.99
  for (const player of [false, true]) {
    const f = fixture('support', [], 'Lag')
    const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
    const result = player ? await f.respond() : await f.npc()
    const lag = result.participants[1].activeEffects.find(effect => effect.name === 'Lag')
    assert.equal(lag.potency, bit)
    assert.equal(lag.appliesRound, 2)
  }
})

test('NPC area Shield and Haste retain their resource changes and chosen potency after intercede decisions', async t => {
  const random = Math.random
  t.after(() => { Math.random = random })
  Math.random = () => 0.99
  for (const effect of ['Shield', 'Haste']) {
    const f = fixture('support', ['Area Attack: Burst'], effect)
    await f.offer(true, false, { shieldComplex: effect === 'Shield' })
    for (const offer of f.encounter.pendingRequests.filter(request => request.type === 'intercede-offer')) await f.skip(offer.id)
    const target = f.encounter.participants[1]
    if (effect === 'Shield') {
      const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
      assert.equal(target.currentTempWounds, bit * 3)
      assert.equal(target.activeEffects.find(effect => effect.name === 'Shield').duration, 0)
    } else {
      assert.equal(target.actionsRemaining.simple, 3)
      assert.equal(target.activeEffects.find(effect => effect.name === 'Haste').duration, 1)
    }
  }
})

test('the legacy NPC endpoint also enforces Complex effect costs and applies Lifesteal, Shield, Haste and Lag', async () => {
  for (const effect of ['Lifesteal', 'Shield', 'Haste', 'Lag']) {
    const f = fixture(effect === 'Lifesteal' ? 'damage' : 'support', [], effect)
    f.participants[0].currentWounds = 20
    const stats = await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])
    const result = await f.legacy({ lifestealed: effect === 'Lifesteal', shieldComplex: effect === 'Shield' })
    assert.equal(result.participants[0].actionsRemaining.simple, 0)
    if (effect === 'Lifesteal') assert.equal(result.participants[0].currentWounds, 20 - stats.cpu * 2)
    if (effect === 'Shield') assert.equal(result.participants[1].currentTempWounds, stats.bit * 3)
    if (effect === 'Haste') assert.equal(result.participants[1].actionsRemaining.simple, 3)
    if (effect === 'Lag') assert.equal(result.participants[1].activeEffects.find(effect => effect.name === 'Lag').appliesRound, 2)
  }
})

for (const effect of ['Shield', 'Haste']) {
  test(`damage attacks also grant ${effect}'s resources through NPC, player and deferred area defenses`, async () => {
    for (const path of ['npc', 'player', 'legacy', 'single-skip', 'area-skip']) {
      const f = fixture('damage', path === 'area-skip' ? ['Area Attack: Burst'] : [], effect)
      const flags = { shieldComplex: effect === 'Shield' }
      let result
      if (path === 'npc') result = await f.npc(flags)
      else if (path === 'player') result = await f.respond(3, flags)
      else if (path === 'legacy') result = await f.legacy(flags)
      else {
        await f.offer(path === 'area-skip', false, flags)
        for (const offer of f.encounter.pendingRequests.filter(request => request.type === 'intercede-offer')) await f.skip(offer.id)
        result = f.encounter
      }
      const target = result.participants[1]
      assert.ok(target.currentWounds > 0, `${path} must retain the attack damage`)
      if (effect === 'Shield') {
        const bit = (await f.support.getDigimonDerivedStats(f.records[0].id, f.participants[0])).bit
        assert.equal(target.currentTempWounds, bit * 3, path)
      } else assert.equal(target.actionsRemaining.simple, 3, path)
    }
  })
}

test('legacy Lifesteal respects target Immunity while still dealing damage', async () => {
  const f = fixture('damage', [], 'Lifesteal')
  f.records[1].qualities = [{ id: 'immunity' }]
  f.participants[0].currentWounds = 20
  const result = await f.legacy({ lifestealed: true })
  assert.equal(result.participants[0].currentWounds, 20)
  assert.ok(result.participants[1].currentWounds > 0)
})

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

for (const type of ['support', 'damage']) {
  test(`Fear from a ${type} attack stores the actual source and BIT potency across defense routes`, async () => {
    for (const route of ['damage', 'respond', 'legacy']) {
      const f = fixture(type, [], 'Fear')
      const result = await f[route]()
      const effect = route === 'damage' ? result.effectData : result.participants[1].activeEffects.find(effect => effect.name === 'Fear')
      const derived = await f.support.getDigimonDerivedStats(f.records[0].id)
      assert.equal(effect.source, 'taunter-token')
      assert.equal(effect.potency, derived.bit)
    }
  })
}

for (const type of ['support', 'damage']) {
  for (const areaAttack of [false, true]) {
    test(`${type} Cleanse collects one selection after ${areaAttack ? 'area' : 'single-target'} intercede decisions`, async t => {
      t.mock.method(Math, 'random', () => 0)
      const f = fixture(type, areaAttack ? ['Area Attack: Burst'] : [], 'Cleanse')
      f.participants[1].activeEffects = [{ id: 'fear', name: 'Fear', type: 'debuff', duration: 5, potency: 1, source: 'someone' }]
      const offered = await f.offer(areaAttack)
      const offer = offered.pendingRequests.find(request => request.type === 'intercede-offer')
      const pending = offered.pendingRequests.find(request => request.type === 'cleanse-select')
      assert.equal(pending.data.ready, false)
      const result = await f.skip(offer.id)
      const choice = result.pendingRequests.find(request => request.type === 'cleanse-select')
      assert.ok(choice)
      assert.equal(choice.data.ready, true)
      assert.equal(choice.data.outcomes['defender-token'].leftover, 3)
      assert.deepEqual(choice.data.outcomes['defender-token'].effectIds, ['fear'])
      assert.equal(result.participants[1].activeEffects.some(effect => effect.name === 'Cleanse'), false)
    })
  }

  test(`${type} Cleanse waits for a player-controlled defender before offering effect selection`, async t => {
    t.mock.method(Math, 'random', () => 0)
    const f = fixture(type, [], 'Cleanse')
    f.records[1].partnerId = 'owner'
    f.participants[1].activeEffects = [{ id: 'poison', name: 'Poison', type: 'debuff', duration: 5 }]
    const offered = await f.offer()
    const result = await f.skip(offered.pendingRequests.find(request => request.type === 'intercede-offer').id)
    assert.ok(result.pendingRequests.some(request => request.type === 'dodge-roll'))
    assert.equal(result.pendingRequests.find(request => request.type === 'cleanse-select').data.ready, false)
    const defended = await f.respond()
    assert.equal(defended.pendingRequests.find(request => request.type === 'cleanse-select').data.ready, true)
  })
}

for (const type of ['support', 'damage']) {
  for (const effect of ['Taunt', 'Fear', 'Stun', 'Shield', 'Burn', 'Knockback', 'Cleanse']) {
    test(`legacy ${type} ${effect} respects Immunity without changing the ordinary hit`, async () => {
      const f = fixture(type, [], effect)
      f.records[1].qualities = [{ id: 'immunity' }]
      f.participants[1].activeEffects = [{ id: 'existing', name: 'Poison', type: 'debuff', duration: 5, potency: 2, source: 'old-source' }]
      const before = structuredClone(f.participants[1].activeEffects)
      if (effect === 'Knockback') f.encounter.mapId = 'map'
      const result = await f.legacy()
      const defender = result.participants.find(participant => participant.id === 'defender-token')
      assert.deepEqual(defender.activeEffects, before)
      assert.equal(defender.actionsRemaining.simple, 2)
      assert.equal(defender.interceptPenalty ?? 0, 0)
      assert.equal(defender.stunActionReducedThisRound ?? false, false)
      assert.equal(defender.currentWounds, type === 'damage' ? 11 : 0)
      assert.equal(result.pendingRequests.some(request => request.type === 'cleanse-select'), false)
      assert.equal(result.battleLog.some(entry => entry.effects?.includes(`Applied: ${effect}`)), false)
    })
  }
}

test('legacy support Stun cannot impose a deferred action penalty on an immune target', async () => {
  const f = fixture('support', [], 'Stun')
  f.records[1].qualities = [{ id: 'immunity' }]
  f.encounter.turnOrder = ['defender-token', 'taunter-token']
  f.encounter.currentTurnIndex = 1
  const result = await f.legacy()
  const defender = result.participants.find(participant => participant.id === 'defender-token')
  assert.equal(defender.actionsRemaining.simple, 2)
  assert.equal(defender.interceptPenalty ?? 0, 0)
  assert.equal(defender.stunActionReducedThisRound ?? false, false)
})
