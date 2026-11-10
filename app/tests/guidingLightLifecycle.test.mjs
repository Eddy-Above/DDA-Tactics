import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

function unit(id, overrides = {}) {
  return {
    id, type: 'digimon', entityId: id, actionsRemaining: { simple: 2 },
    activeEffects: [], currentWounds: 0, maxWounds: 5,
    ...overrides,
  }
}

function fixture({ participants = [unit('source'), unit('ally')], phase = 'combat', ...overrides } = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.id
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'campaigns', 'digimon', 'evolutionLines', 'tamers', 'maps']
    .map(name => [name, { name, id: { table: name } }]))
  const rows = {
    encounters: { encounter: {
      id: 'encounter', campaignId: 'campaign', phase, participants,
      turnOrder: participants.map(p => p.id), currentTurnIndex: 0, round: 1,
      battleLog: [], pendingRequests: [], requestResponses: [], mapId: 'map',
    } },
    campaigns: { campaign: { level: 'enhanced', rulesSettings: { houseRules: { stunMaxDuration1: true } } } },
    digimon: {}, evolutionLines: {}, tamers: {}, maps: {},
  }
  const writes = []
  const reads = []
  const auraCalls = []
  const knockoutCalls = []
  const room = { participantPositions: { source: { x: 2, y: 0, z: 0 } }, destructibleStates: [] }
  const db = {
    select: () => ({ from: table => ({ where: async filter => {
      reads.push({ table: table.name, id: filter.value })
      if (Array.isArray(filter.value)) return filter.value.flatMap(id => rows[table.name][id] ? [structuredClone(rows[table.name][id])] : [])
      const row = rows[table.name][filter.value]
      return row ? [structuredClone(row)] : []
    } }) }),
    update: table => ({ set: data => ({ where: async filter => {
      writes.push({ table: table.name, data: structuredClone(data) })
      rows[table.name][filter.value] = { ...rows[table.name][filter.value], ...structuredClone(data) }
    } }) }),
  }
  const applyGuidingLightAuras = async (finalParticipants, positions, campaignLevel, houseRules) => {
    // The actual aura math is exercised separately; this verifies that its returned roster
    // is folded into the existing write, with the final form/roster and live map state.
    auraCalls.push(structuredClone({ participants: finalParticipants, positions, campaignLevel, houseRules }))
    return {
      changed: true,
      participants: finalParticipants.map(p => ({ ...p, activeEffects: [{ name: 'Guiding Light', source: 'recomputed' }] })),
    }
  }
  const dbModule = { db, ...tables }
  const sql = { eq: (column, value) => ({ column, value }), inArray: (column, value) => ({ column, value }) }
  const combatContext = loadTrustedGameplayModule('server/utils/combatContext.ts', {
    'drizzle-orm': sql, '../db': dbModule,
  })
  const spatial = loadTrustedGameplayModule('server/utils/combatSpatial.ts', {
    'drizzle-orm': sql, '../db': dbModule,
  })
  const partnerDevolution = loadTrustedGameplayModule('server/utils/partnerDevolution.ts', {
    'drizzle-orm': sql, '../db': dbModule,
  })
  const mocks = {
    'drizzle-orm': sql,
    '../../db': dbModule,
    '../../utils/combatContext': combatContext,
    '../../utils/combatSpatial': spatial,
    '../../utils/partnerDevolution': partnerDevolution,
    '../../utils/encounterRoom': { getRoomSnapshot: async () => structuredClone(room) },
    '../../utils/endOfTurnGravity': {
      applyEndOfTurnGravity: async (_id, _map, current) => ({ participants: current, logEntries: [] }),
      ...overrides.gravity,
    },
    '../../utils/roundStartQualityTriggers': { applyRoundStartQualityTriggers: async current => current },
    '../../utils/encounterStartTriggers': {
      applyEncounterStartTriggers: async current => current,
      ...overrides.start,
    },
    '../../utils/guidingLight': { applyGuidingLightAuras },
    '../../utils/damageOverTime': {
      damageOverTimeRules: () => ({}),
      applyTurnEndEffects: async ({ participants: current }) => ({ participants: current, logEntries: [] }),
      applyRoundEndEffects: async ({ participants: current }) => ({ participants: current, logEntries: [] }),
      loadStationaryBurnPositions: async () => room.participantPositions,
    },
    '../../utils/enemyKnockouts': {
      knockedOutEnemyIds: current => current.filter(p => p.isEnemy && p.currentWounds >= p.maxWounds).map(p => p.id),
      resolveEnemyKnockouts: async (state, ids) => {
        knockoutCalls.push([...ids])
        return { ...state, changed: false, logEntries: [] }
      },
      ...overrides.knockouts,
    },
    '../../../../db': dbModule,
    '../../../../utils/combatContext': combatContext,
    '../../../../utils/partnerDevolution': partnerDevolution,
    '../../../../utils/digizoidArmor': { getDigizoidArmorBonus: () => ({ health: 0, armor: 0, dodge: 0 }) },
    '../../../../utils/encounterRoom': { getRoomPositions: async () => structuredClone(room.participantPositions) },
    '../../../../utils/guidingLight': { applyGuidingLightAuras },
  }
  const refreshGuidingLightForParticipants = async (id, current) => {
    assert.equal(id, 'encounter')
    return (await applyGuidingLightAuras(current, room.participantPositions, 'enhanced', { stunMaxDuration1: true })).participants
  }
  Object.assign(mocks, {
    '../../../db': dbModule,
    '../../../utils/partnerDevolution': partnerDevolution,
    '../../../utils/guidingLight': { refreshGuidingLightForParticipants },
    '../../../utils/pushPull': { applyPushPullDisplacement: async ({ participants: current }) => ({ participants: current }) },
    '../../../utils/resolveSupportAttack': { getDigimonDerivedStats: async () => ({ bit: 1, cpu: 1 }), calculateEffectPotency: () => ({ potency: 1 }) },
    '../../../utils/triggerCounterattack': { triggerCounterattack: () => { throw new Error('Unexpected counterattack') } },
    '../../../utils/resolveNpcAttack': { resolveNpcAttack: () => { throw new Error('Unexpected NPC auto-resolve') } },
    '../../../utils/damageOverTime': { isImmuneToEffect: () => false },
    '../../../utils/enemyKnockouts': mocks['../../utils/enemyKnockouts'],
    '../../../utils/clashArmor': { getOutsideClashArmorBonus: async () => 0 },
    '../../../../utils/pushPull': mocks['../../../utils/pushPull'],
    '../../../../utils/resolveSupportAttack': mocks['../../../utils/resolveSupportAttack'],
    '../../../../utils/endOfTurnGravity': mocks['../../utils/endOfTurnGravity'],
    '../../../../utils/roundStartQualityTriggers': mocks['../../utils/roundStartQualityTriggers'],
    '../../../../utils/damageOverTime': { ...mocks['../../utils/damageOverTime'], applyWoundDamage: loadTypeScript('server/utils/damageOverTime.ts').applyWoundDamage, isImmuneToEffect: () => false },
    '../../../../utils/enemyKnockouts': mocks['../../utils/enemyKnockouts'],
  })
  mocks['../../../../utils/guidingLight'].refreshGuidingLightForParticipants = refreshGuidingLightForParticipants
  return {
    rows, room, writes, reads, auraCalls, knockoutCalls,
    put: body => loadTrustedGameplayModule('server/api/encounters/[id].put.ts', mocks).default({ id: 'encounter', body }),
    digivolve: body => loadTrustedGameplayModule('server/api/encounters/[id]/actions/digivolve.post.ts', mocks)
      .default({ id: 'encounter', body }),
    respond: body => loadTrustedGameplayModule('server/api/encounters/[id]/responses.post.ts', mocks)
      .default({ id: 'encounter', body }),
    npcAttack: body => loadTrustedGameplayModule('server/api/encounters/[id]/actions/npc-attack.post.ts', mocks)
      .default({ id: 'encounter', body }),
  }
}

test('turn processing and the final aura pass share one campaign read per encounter update', async () => {
  const f = fixture()
  await f.put({ participants: [unit('source'), unit('ally')], currentTurnIndex: 1, round: 2 })
  assert.equal(f.auraCalls.length, 1)
  assert.deepEqual(f.reads.filter(read => read.table === 'campaigns'), [{ table: 'campaigns', id: 'campaign' }])
})

function assertOneAuraWrite(f) {
  assert.equal(f.auraCalls.length, 1)
  const writes = f.writes.filter(write => write.table === 'encounters')
  assert.equal(writes.length, 1, 'the aura must share the endpoint\'s existing encounter write')
  for (const p of writes[0].data.participants) {
    assert.equal(p.activeEffects[0].source, 'recomputed')
  }
}

test('PUT recomputes after manually removing the source or an ally without a movement event', async () => {
  for (const remainingId of ['source', 'ally']) {
    const f = fixture()
    const result = await f.put({ participants: [unit(remainingId)] })
    assertOneAuraWrite(f)
    assert.deepEqual(f.auraCalls[0].participants.map(p => p.id), [remainingId])
    assert.equal(result.participants[0].activeEffects[0].source, 'recomputed')
    assert.deepEqual(f.auraCalls[0].positions, f.room.participantPositions)
    assert.equal(f.auraCalls[0].campaignLevel, 'enhanced')
    assert.deepEqual(f.auraCalls[0].houseRules, { stunMaxDuration1: true })
  }
})

test('PUT also recomputes for an emptied combat roster', async () => {
  const f = fixture()
  await f.put({ participants: [] })
  assertOneAuraWrite(f)
  assert.deepEqual(f.auraCalls[0].participants, [])
})

test('PUT passes changed reserve status and allegiance to the aura in the same request', async () => {
  for (const change of [{ inReserve: true }, { isEnemy: true }]) {
    const f = fixture()
    await f.put({ participants: [unit('source'), unit('ally', change)] })
    assertOneAuraWrite(f)
    assert.deepEqual(f.auraCalls[0].participants.find(p => p.id === 'ally'), unit('ally', change))
  }
})

test('PUT recomputes after its in-place knockout devolution has restored the prior form', async () => {
  const source = unit('source', {
    entityId: 'evolved', evolutionLineId: 'line', currentWounds: 5,
    woundsHistory: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 4, wounds: 1 }],
  })
  const f = fixture({ participants: [source, unit('ally')] })
  f.rows.digimon.rookie = { id: 'rookie', qualities: [] }
  await f.put({ participants: [source, unit('ally')] })
  assertOneAuraWrite(f)
  const restored = f.auraCalls[0].participants.find(p => p.id === 'source')
  assert.equal(restored.entityId, 'rookie')
  assert.equal(restored.currentWounds, 1)
  assert.equal(restored.maxWounds, 4)
})

test('PUT recomputes from the final roster and positions after gravity and enemy knockout removal', async () => {
  const f = fixture({
    participants: [unit('source'), unit('enemy', { isEnemy: true, currentWounds: 4 })],
    gravity: { applyEndOfTurnGravity: async (_id, _map, current) => {
      f.room.participantPositions.source = { x: 2, y: -2, z: 0 }
      current.find(p => p.id === 'enemy').currentWounds = 5
      return { participants: current, logEntries: [] }
    } },
    knockouts: { resolveEnemyKnockouts: async state => ({
      ...state, participants: state.participants.filter(p => p.id !== 'enemy'),
      turnOrder: ['source'], currentTurnIndex: 0, changed: true, logEntries: [],
    }) },
  })
  await f.put({ participants: structuredClone(f.rows.encounters.encounter.participants), currentTurnIndex: 1 })
  assertOneAuraWrite(f)
  assert.deepEqual(f.auraCalls[0].participants.map(p => p.id), ['source'])
  assert.deepEqual(f.auraCalls[0].positions.source, { x: 2, y: -2, z: 0 })
})

test('combat start without a roster in the body still recomputes after encounter-start effects', async () => {
  const f = fixture({
    phase: 'setup', participants: [unit('source', { lastMovedRound: 9 })],
    start: { applyEncounterStartTriggers: async current => current.map(p => ({ ...p, currentTempWounds: 3 })) },
  })
  await f.put({ phase: 'combat' })
  assertOneAuraWrite(f)
  assert.equal(f.auraCalls[0].participants[0].lastMovedRound, undefined)
  assert.equal(f.auraCalls[0].participants[0].currentTempWounds, 3)
})

test('reinforcements receive encounter-start changes before the shared aura pass', async () => {
  const f = fixture({
    participants: [unit('source')],
    start: { applyEncounterStartTriggers: async current => current.map(p => ({ ...p, currentTempWounds: 3 })) },
  })
  await f.put({ participants: [unit('source'), unit('reinforcement')] })
  assertOneAuraWrite(f)
  assert.equal(f.auraCalls[0].participants.find(p => p.id === 'reinforcement').currentTempWounds, 3)
})

test('noncombat roster edits and combat metadata-only edits do not recalculate the aura', async () => {
  const setup = fixture({ phase: 'setup' })
  await setup.put({ participants: [unit('source')] })
  assert.equal(setup.auraCalls.length, 0)
  const metadata = fixture()
  await metadata.put({ name: 'Renamed encounter' })
  assert.equal(metadata.auraCalls.length, 0)
  const ended = fixture()
  await ended.put({ phase: 'ended', participants: [unit('source')] })
  assert.equal(ended.auraCalls.length, 0)
})

function evolutionFixture(currentStageIndex, phase = 'combat') {
  const source = unit('source', {
    entityId: currentStageIndex ? 'champion' : 'rookie', evolutionLineId: 'line',
    woundsHistory: currentStageIndex ? [{ entityId: 'rookie', stageIndex: 0, maxWounds: 5, wounds: 2 }] : [],
  })
  const f = fixture({ participants: [source, unit('ally'), unit('tamer', { type: 'tamer', entityId: 'owner' })], phase })
  f.rows.digimon.rookie = { id: 'rookie', campaignId: 'campaign', partnerId: 'owner', stage: 'rookie', baseStats: { health: 3 }, qualities: [] }
  f.rows.digimon.champion = { id: 'champion', campaignId: 'campaign', partnerId: 'owner', stage: 'champion', baseStats: { health: 5 }, qualities: [] }
  f.rows.evolutionLines.line = {
    id: 'line', campaignId: 'campaign', currentStageIndex,
    chain: [
      { digimonId: 'rookie', species: 'Agumon', evolvesFromIndex: null, isUnlocked: true },
      { digimonId: 'champion', species: 'Greymon', evolvesFromIndex: 0, isUnlocked: true },
    ],
  }
  return f
}

test('digivolve recomputes with the new form and current room positions before its existing final write', async () => {
  const f = evolutionFixture(0)
  const result = await f.digivolve({ participantId: 'source', targetChainIndex: 1, force: true })
  assertOneAuraWrite(f)
  assert.equal(f.auraCalls[0].participants.find(p => p.id === 'source').entityId, 'champion')
  assert.equal(result.participants.find(p => p.id === 'source').entityId, 'champion')
  assert.deepEqual(f.auraCalls[0].positions, f.room.participantPositions)
  assert.equal(f.auraCalls[0].campaignLevel, 'enhanced')
  assert.deepEqual(f.auraCalls[0].houseRules, { stunMaxDuration1: true })
})

test('devolve recomputes with the restored form and wounds without needing a movement event', async () => {
  const f = evolutionFixture(1)
  await f.digivolve({ participantId: 'source', targetChainIndex: 0, force: true })
  assertOneAuraWrite(f)
  const source = f.auraCalls[0].participants.find(p => p.id === 'source')
  assert.equal(source.entityId, 'rookie')
  assert.equal(source.currentWounds, 2)
})

test('forced evolution outside combat does not apply the combat aura', async () => {
  const f = evolutionFixture(0, 'setup')
  await f.digivolve({ participantId: 'source', targetChainIndex: 1, force: true })
  assert.equal(f.auraCalls.length, 0)
  assert.equal(f.writes.filter(write => write.table === 'encounters').length, 1)
})

function damagingAttackFixture({ evolved = false, enemy = false } = {}) {
  const target = unit('source', {
    entityId: evolved ? 'champion' : 'rookie', currentWounds: 4,
    ...(enemy ? { isEnemy: true } : {}),
    ...(evolved ? { evolutionLineId: 'line', woundsHistory: [
      { entityId: 'rookie', stageIndex: 0, maxWounds: 4, wounds: 1 },
    ] } : {}),
  })
  const f = fixture({ participants: [unit('attacker'), target, unit('ally')] })
  f.rows.encounters.encounter.mapId = null
  f.rows.digimon.attacker = {
    id: 'attacker', name: 'Enemy', qualities: [], baseStats: { damage: 5, armor: 0 },
    attacks: [{ id: 'basic-melee', name: 'Basic Melee', type: 'damage', range: 'melee', tags: [] }],
  }
  f.rows.digimon.champion = { id: 'champion', name: 'Greymon', qualities: [], baseStats: { armor: 0 } }
  f.rows.digimon.rookie = { id: 'rookie', name: 'Agumon', qualities: [], baseStats: { armor: 0 } }
  f.rows.encounters.encounter.pendingRequests = [{
    id: 'dodge', type: 'dodge-roll', targetTamerId: 'owner', targetParticipantId: 'source',
    data: { attackId: 'basic-melee', attackerParticipantId: 'attacker', attackerEntityId: 'attacker',
      targetEntityId: target.entityId, accuracySuccesses: 1, attackerName: 'Enemy', targetName: 'Partner' },
  }]
  return f
}

const dodgeResponse = { requestId: 'dodge', tamerId: 'owner', response: {
  type: 'dodge-rolled', dodgeDicePool: 1, dodgeSuccesses: 0, dodgeDiceResults: [1],
} }
const npcAttackBody = {
  participantId: 'attacker', targetId: 'source', attackId: 'basic-melee',
  accuracyDicePool: 1, accuracySuccesses: 1, accuracyDiceResults: [6],
  dodgeDicePool: 1, dodgeSuccesses: 0, dodgeDiceResults: [1],
}

function partnerFallbackAttackFixture(history) {
  const f = damagingAttackFixture({ evolved: true })
  const target = f.rows.encounters.encounter.participants.find(p => p.id === 'source')
  target.woundsHistory = history ?? []
  target.combatMonsterBonus = 14
  f.rows.digimon.champion = {
    ...f.rows.digimon.champion, partnerId: 'owner', isEnemy: false, stage: 'champion',
  }
  f.rows.digimon.rookie = {
    ...f.rows.digimon.rookie, partnerId: 'owner', isEnemy: false, stage: 'rookie',
    baseStats: { health: 5, armor: 0 }, bonusStats: { health: 2 }, currentWounds: 3,
    qualities: [{ id: 'digizoid-armor', choiceId: 'red' }, { id: 'combat-monster' }],
  }
  f.rows.evolutionLines.line = {
    id: 'line', currentStageIndex: 1,
    chain: [
      { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
      { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
    ],
  }
  return f
}

for (const mode of ['dodge response', 'legacy NPC attack']) {
  test(`${mode} auto-devolves a history-free partner to its saved parent sheet before the aura and encounter write`, async () => {
    const f = partnerFallbackAttackFixture()
    f.rows.encounters.encounter.participants.find(p => p.id === 'source').npcStageIndex = 8
    if (mode === 'dodge response') await f.respond(dodgeResponse)
    else await f.npcAttack(npcAttackBody)

    const stored = f.rows.encounters.encounter
    const target = stored.participants.find(p => p.id === 'source')
    assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], ['rookie', 3, 11, 9])
    assert.deepEqual(target.woundsHistory, [])
    assert.equal(target.combatMonsterBonus, 9)
    assert.equal(target.npcStageIndex, undefined, 'partner devolution clears stale local NPC state')
    assert.equal(f.rows.evolutionLines.line.currentStageIndex, 0)
    assert.equal(f.rows.digimon.rookie.currentWounds, 3, 'combat damage must not change the saved parent sheet')
    assertOneAuraWrite(f)
    const refreshed = f.auraCalls[0].participants.find(p => p.id === 'source')
    assert.deepEqual([refreshed.entityId, refreshed.currentWounds, refreshed.totalHealth], ['rookie', 3, 9])
    const lineWrite = f.writes.findIndex(write => write.table === 'evolutionLines')
    const encounterWrite = f.writes.findIndex(write => write.table === 'encounters')
    assert.ok(lineWrite >= 0 && lineWrite < encounterWrite)
    assert.ok(stored.battleLog.some(entry => entry.effects.includes('Auto-Devolve')))
    assert.ok(f.writes.every(write => write.table !== 'digimon'))
  })

  test(`${mode} keeps saved combat history ahead of a different parent sheet wound count`, async () => {
    const f = partnerFallbackAttackFixture([{ entityId: 'rookie', stageIndex: 0, maxWounds: 7, totalHealth: 5, wounds: 1 }])
    if (mode === 'dodge response') await f.respond(dodgeResponse)
    else await f.npcAttack(npcAttackBody)

    const target = f.rows.encounters.encounter.participants.find(p => p.id === 'source')
    assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], ['rookie', 1, 7, 5])
    assert.deepEqual(target.woundsHistory, [])
    assert.equal(target.combatMonsterBonus, 5)
    assert.equal(f.rows.evolutionLines.line.currentStageIndex, 0)
    assertOneAuraWrite(f)
  })

  test(`${mode} keeps NPC stage changes local instead of changing the shared evolution line`, async () => {
    const f = damagingAttackFixture({ evolved: true })
    f.rows.evolutionLines.line = { id: 'line', currentStageIndex: 3 }
    if (mode === 'dodge response') await f.respond(dodgeResponse)
    else await f.npcAttack(npcAttackBody)
    const target = f.rows.encounters.encounter.participants.find(p => p.id === 'source')
    assert.equal(target.entityId, 'rookie')
    assert.equal(target.npcStageIndex, 0)
    assert.equal(f.rows.evolutionLines.line.currentStageIndex, 3)
    assert.equal(f.writes.filter(write => write.table === 'evolutionLines').length, 0)
    assert.equal(f.rows.encounters.encounter.battleLog.filter(entry => entry.effects.includes('Auto-Devolve')).length, 1)
  })
}

test('a dodge response recomputes after damage auto-devolves its target, before the same save', async () => {
  const f = damagingAttackFixture({ evolved: true })
  await f.respond(dodgeResponse)
  assertOneAuraWrite(f)
  const source = f.auraCalls[0].participants.find(p => p.id === 'source')
  assert.equal(source.entityId, 'rookie')
  assert.equal(source.currentWounds, 1)
})

test('a normal damage response does not perform an extra aura refresh', async () => {
  const f = damagingAttackFixture()
  f.rows.encounters.encounter.participants.find(p => p.id === 'source').maxWounds = 50
  await f.respond(dodgeResponse)
  assert.equal(f.auraCalls.length, 0)
  assert.equal(f.writes.filter(write => write.table === 'encounters').length, 1)
})

test('legacy NPC attacks refresh after an in-place auto-devolution', async () => {
  const f = damagingAttackFixture({ evolved: true })
  await f.npcAttack(npcAttackBody)
  assertOneAuraWrite(f)
  assert.equal(f.auraCalls[0].participants.find(p => p.id === 'source').entityId, 'rookie')
})

test('a legacy NPC hit does not send an already-restored enemy back through knockout handling', async () => {
  const f = damagingAttackFixture({ evolved: true })
  const target = f.rows.encounters.encounter.participants.find(p => p.id === 'source')
  target.isEnemy = true
  target.woundsHistory = [{ entityId: 'rookie', stageIndex: 0, maxWounds: 5, wounds: 5 }]
  f.rows.digimon.champion.isEnemy = true
  await f.npcAttack(npcAttackBody)
  const restored = f.rows.encounters.encounter.participants.find(p => p.id === 'source')
  assert.equal(restored.entityId, 'rookie')
  assert.equal(restored.npcStageIndex, 0)
  assert.equal(restored.currentWounds, 5)
  assert.ok(f.knockoutCalls.every(ids => !ids.includes('source')))
  assert.equal(f.rows.encounters.encounter.battleLog.filter(entry => entry.effects.includes('Auto-Devolve')).length, 1)
})

test('legacy NPC primary-target removal refreshes the remaining roster before the same save', async () => {
  const f = damagingAttackFixture({ enemy: true })
  await f.npcAttack(npcAttackBody)
  assertOneAuraWrite(f)
  assert.deepEqual(f.auraCalls[0].participants.map(p => p.id), ['attacker', 'ally'])
})

test('a normal legacy NPC hit does not perform an extra aura refresh', async () => {
  const f = damagingAttackFixture()
  f.rows.encounters.encounter.participants.find(p => p.id === 'source').maxWounds = 50
  await f.npcAttack(npcAttackBody)
  assert.equal(f.auraCalls.length, 0)
  assert.equal(f.writes.filter(write => write.table === 'encounters').length, 1)
})
