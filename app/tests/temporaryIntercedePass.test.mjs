import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['ref', '$fetch', 'defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => structuredClone(value)
const unexpected = () => { throw new Error('unexpected combat side effect') }
const identity = async participants => participants
const eq = (_column, value) => ({ value })
const inArray = (_column, values) => ({ values })

const optOuts = loadTypeScript('utils/intercedeOptOuts.ts')
const { recordTurnStart } = loadTypeScript('utils/intercedeActions.ts')
const queue = loadTypeScript('server/utils/intercedeClaims.ts')
const { getActiveTemporaryPass, getPassingOwnerIds, isOfferPassed, isOfferSuppressed, getTargetOptOuts } = optOuts

// --- fixtures ---------------------------------------------------------------------------------------

function tamer(id, entityId, extra = {}) {
  return {
    id, entityId, type: 'tamer', initiative: 10, initiativeRoll: 10, actionsRemaining: { simple: 2 },
    activeEffects: [], currentWounds: 0, maxWounds: 5, hasActed: false, ...extra,
  }
}
function digimonUnit(id, extra = {}) {
  return {
    id, entityId: id, type: 'digimon', initiative: 10, initiativeRoll: 10, actionsRemaining: { simple: 2 },
    activeEffects: [], currentWounds: 0, maxWounds: 20, hasActed: false, ...extra,
  }
}
const digimonRows = {
  'mon-1': { id: 'mon-1', name: 'Mon 1', partnerId: 'tamer-1', attacks: [], qualities: [] },
  'mon-2': { id: 'mon-2', name: 'Mon 2', partnerId: 'tamer-2', attacks: [], qualities: [] },
  foe: { id: 'foe', name: 'Foe', partnerId: null, attacks: [{ id: 'bite', range: 'melee', tags: [] }], qualities: [] },
  'npc-ally': { id: 'npc-ally', name: 'Ally', partnerId: null, attacks: [], qualities: [] },
}

function roster() {
  return [
    digimonUnit('foe', { isEnemy: true, initiative: 30 }),
    tamer('tamer-p1', 'tamer-1', { initiative: 20 }),
    digimonUnit('mon-1', { initiative: 20 }),
    tamer('tamer-p2', 'tamer-2', { initiative: 10 }),
    digimonUnit('mon-2', { initiative: 10 }),
    digimonUnit('npc-ally', { isEnemy: true, initiative: 5 }),
  ]
}

function encounterRow(overrides = {}) {
  const participants = overrides.participants ?? roster()
  return {
    id: 'encounter', phase: 'combat', round: 1, mapId: null, campaignId: null,
    participants, turnOrder: ['foe', 'tamer-p1', 'tamer-p2', 'npc-ally'], currentTurnIndex: 0,
    battleLog: [], pendingRequests: [], requestResponses: [], intercedeOptOuts: {}, updatedAt: new Date(0),
    ...overrides,
  }
}

/** Puts an active pass on a Tamer the way the server records it. */
function withPass(encounter, ownerId = 'tamer-1') {
  const slot = encounter.participants.find(p => p.type === 'tamer' && p.entityId === ownerId)
  encounter.intercedeOptOuts = {
    ...encounter.intercedeOptOuts,
    temporaryPasses: {
      ...(encounter.intercedeOptOuts?.temporaryPasses ?? {}),
      [ownerId]: { characterId: slot.id, turnsStarted: slot.turnsStarted ?? 0, createdAt: 'then' },
    },
  }
  return encounter
}

const singleOffer = (id, group, owner, targetId, extra = {}) => ({
  id, type: 'intercede-offer', targetTamerId: owner, targetParticipantId: targetId, timestamp: 'then',
  data: {
    intercedeGroupId: group, attackerId: 'foe', attackerName: 'Foe', targetId, targetName: targetId,
    attackName: 'Bite', attackId: 'bite', attackData: { dicePool: 3 }, accuracySuccesses: 2, accuracyDice: [6, 6],
    eligibleTamerIds: ['tamer-1', 'tamer-2'], ...extra,
  },
})
const areaOffer = (id, group, owner, extra = {}) => ({
  id, type: 'intercede-offer', targetTamerId: owner, targetParticipantId: null, timestamp: 'then',
  data: {
    intercedeGroupId: group, isAreaAttack: true, attackerId: 'foe', attackerName: 'Foe', attackName: 'Blast',
    attackId: 'blast', attackData: { dicePool: 3 }, accuracySuccesses: 2, accuracyDice: [6, 6], ...extra,
  },
})
const groupState = group => ({
  id: `state-${group}`, type: 'intercede-group-state', targetTamerId: 'GM', timestamp: 'then',
  data: {
    intercedeGroupId: group, originalTargetIds: ['mon-2', 'npc-ally'], claims: [], npcTargetIds: ['npc-ally'],
    playerTargetInfo: { 'mon-2': { type: 'digimon', entityId: 'mon-2', partnerId: 'tamer-2', name: 'Mon 2' } },
    attackerId: 'foe', attackerName: 'Foe', attackId: 'blast', attackName: 'Blast', attackData: { dicePool: 3 },
    accuracySuccesses: 2, accuracyDice: [6, 6],
  },
})

// --- the server stack on a fake database ---------------------------------------------------------------

function createServer(initial) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.encounterId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  let stored = copy(initial)
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps']
    .map(name => [name, { name, id: name }]))
  const npcResolutions = []
  const tamerRecords = Object.fromEntries(['tamer-1', 'tamer-2'].map(id => [id, {
    id, name: id, attributes: { intelligence: 0 }, xpBonuses: null, usedPerDayOrders: [],
  }]))
  let lockTail = Promise.resolve()
  let roomGate = null
  let npcResolution = null

  function read(table, filter, snapshot) {
    if (table === tables.encounters) return [copy(snapshot ?? stored)]
    if (table === tables.digimon) {
      const ids = filter.values ?? [filter.value]
      return ids.filter(id => digimonRows[id]).map(id => copy(digimonRows[id]))
    }
    if (table === tables.tamers) return (filter.values ?? [filter.value])
      .filter(id => tamerRecords[id]).map(id => copy(tamerRecords[id]))
    throw new Error(`unexpected ${table.name} read`)
  }
  const db = {
    select: () => ({ from: table => ({ where: async filter => read(table, filter) }) }),
    update: table => ({ set: fields => ({ where: async filter => {
      if (table === tables.encounters) stored = { ...stored, ...copy(fields) }
      else if (table === tables.tamers) tamerRecords[filter.value] = { ...tamerRecords[filter.value], ...copy(fields) }
      else assert.fail(`unexpected ${table.name} write`)
    } }) }),
    // A transaction reads FOR UPDATE and holds the row until it commits: the next one waits.
    transaction: async callback => {
      let release
      let staged = null
      const tx = {
        select: () => ({ from: table => ({ where: filter => ({
          for: async mode => {
            assert.equal(mode, 'update')
            const previous = lockTail
            lockTail = new Promise(resolve => { release = resolve })
            await previous
            staged = copy(stored)
            return read(table, filter, staged)
          },
          // Reads of other tables inside the transaction need no lock.
          then: (resolve, reject) => Promise.resolve(read(table, filter, staged ?? undefined)).then(resolve, reject),
        }) }) }),
        update: table => ({ set: fields => ({ where: async () => {
          assert.equal(table, tables.encounters)
          assert.ok(staged, 'a transactional write must follow a FOR UPDATE read')
          staged = { ...staged, ...copy(fields) }
        } }) }),
      }
      try {
        const result = await callback(tx)
        if (staged) stored = staged
        return result
      } finally {
        release?.()
      }
    },
  }
  const dbModule = { db, ...tables }

  const npcResolver = async params => {
    npcResolutions.push({ attacker: params.attackerParticipantId, target: params.targetParticipantId })
    if (npcResolution) return npcResolution(params)
    return {
      participants: params.participants,
      battleLog: [...params.battleLog, { id: `npc-${params.targetParticipantId}`, action: 'NPC resolved' }],
      turnOrder: params.turnOrder,
    }
  }
  const knockouts = {
    knockedOutEnemyIds: () => [],
    resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }),
  }
  const supportStubs = {
    resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected,
    resolveNegativeSupportNpc: unexpected, getPositiveSupportResolutionType: () => null,
  }
  const areaModule = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
    '../db': dbModule,
    'drizzle-orm': { eq },
    './resolveNpcAttack': { resolveNpcAttack: npcResolver },
    './enemyKnockouts': knockouts,
    '~/server/utils/resolveSupportAttack': supportStubs,
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  })
  const decision = loadTypeScriptWithMocks('server/utils/intercedeDecision.ts', {
    'drizzle-orm': { eq },
    '../db': dbModule,
    '~/server/utils/encounterRoom': {
      // A test can park the next decision here, after it has read the encounter and before it writes.
      getRoomPositions: async () => {
        if (roomGate) {
          const gate = roomGate
          roomGate = null
          gate.entered.resolve()
          await gate.release.promise
        }
        return {}
      },
      broadcastPositionPatch: unexpected,
    },
    '~/server/utils/guidingLight': { applyGuidingLightAuras: unexpected },
    '~/server/utils/combatSpatial': { loadEncounterMap: unexpected },
    '~/server/utils/pushPull': { resolveInstantSupportEffect: unexpected },
    '~/server/utils/resolveNpcAttack': { resolveNpcAttack: npcResolver },
    '~/server/utils/resolveAreaIntercedeGroup': areaModule,
    '~/server/utils/resolveSupportAttack': supportStubs,
  })
  const preferences = loadTypeScriptWithMocks('server/utils/intercedeOptOuts.ts', { 'drizzle-orm': { eq }, '../db': dbModule })
  const passes = loadTypeScriptWithMocks('server/utils/intercedePasses.ts', {
    'drizzle-orm': { eq }, '../db': dbModule, './intercedeDecision': decision,
  })
  const decisionMocks = {
    '../../../../db': dbModule, 'drizzle-orm': { eq, inArray },
    '~/server/utils/intercedeDecision': decision, '~/server/utils/intercedeOptOuts': preferences,
    '~/server/utils/intercedeClaims': queue,
  }
  const endpoint = (name, extra = {}) =>
    loadTypeScriptWithMocks(`server/api/encounters/[id]/actions/${name}.post.ts`, { ...decisionMocks, ...extra }).default
  const passEndpoint = endpoint('intercede-pass', { '~/server/utils/intercedePasses': passes })
  const skipEndpoint = endpoint('intercede-skip')
  const optOutEndpoint = endpoint('intercede-optouts')
  const quickReactionEndpoint = endpoint('quick-reaction', {
    '~/server/utils/intercedePasses': passes,
    '~/server/utils/resolveAreaIntercedeGroup': areaModule,
  })

  return {
    preferences, passes, decision, dbModule, tables, npcResolutions, read, db, tamerRecords,
    onNpcResolution: resolve => { npcResolution = resolve },
    holdNextDecision: () => { roomGate = { entered: deferred(), release: deferred() }; return roomGate },
    state: () => copy(stored),
    set: change => { stored = { ...stored, ...copy(change) } },
    pass: (ownerId, action = 'start') => passEndpoint({ encounterId: 'encounter', body: { ownerId, action } }),
    skip: (requestId, body = {}) => skipEndpoint({ encounterId: 'encounter', body: { requestId, ...body } }),
    saveOptOuts: (ownerId, list) => optOutEndpoint({ encounterId: 'encounter', body: { ownerId, intercedeOptOuts: list } }),
    quickReaction: requestId => quickReactionEndpoint({ encounterId: 'encounter', body: { requestId, tamerParticipantId: 'tamer-p1' } }),
  }
}

/** What a hand-clicked outcome must equal, minus clock/random identity. */
function outcome(state) {
  return {
    participants: state.participants,
    battleLog: state.battleLog,
    pendingRequests: state.pendingRequests.map(({ id: _id, timestamp: _timestamp, ...request }) => request),
  }
}
const offerIds = state => state.pendingRequests.filter(r => r.type === 'intercede-offer').map(r => r.id)

// --- the preference and when it ends -------------------------------------------------------------------

test('a pass is in force until its Tamer starts another turn, whatever the other participants do', () => {
  const encounter = withPass(encounterRow())
  assert.equal(getActiveTemporaryPass(encounter, 'tamer-1')?.characterId, 'tamer-p1')
  assert.deepEqual(getPassingOwnerIds(encounter), ['tamer-1'])

  recordTurnStart(encounter.participants.find(p => p.id === 'tamer-p2'))
  recordTurnStart(encounter.participants.find(p => p.id === 'foe'))
  assert.ok(getActiveTemporaryPass(encounter, 'tamer-1'), 'other characters starting turns changes nothing')

  recordTurnStart(encounter.participants.find(p => p.id === 'tamer-p1'))
  assert.equal(getActiveTemporaryPass(encounter, 'tamer-1'), null, "the Tamer's own next turn ends it")
  recordTurnStart(encounter.participants.find(p => p.id === 'tamer-p1'))
  assert.equal(getActiveTemporaryPass(encounter, 'tamer-1'), null, 'and it does not come back')
})

test('reordering, adding or removing other participants leaves a pass alone; losing its Tamer ends it', () => {
  const encounter = withPass(encounterRow())
  const reordered = { ...encounter, participants: [...encounter.participants].reverse(), turnOrder: [...encounter.turnOrder].reverse() }
  assert.ok(getActiveTemporaryPass(reordered, 'tamer-1'), 'roster reorder')
  const added = { ...encounter, participants: [...encounter.participants, digimonUnit('reinforcement')] }
  assert.ok(getActiveTemporaryPass(added, 'tamer-1'), 'added participant')
  const unrelated = { ...encounter, participants: encounter.participants.filter(p => p.id !== 'npc-ally') }
  assert.ok(getActiveTemporaryPass(unrelated, 'tamer-1'), 'unrelated removal')

  const removed = { ...encounter, participants: encounter.participants.filter(p => p.id !== 'tamer-p1') }
  assert.equal(getActiveTemporaryPass(removed, 'tamer-1'), null, 'its Tamer removed')
  const reserved = { ...encounter, participants: encounter.participants.map(p => (p.id === 'tamer-p1' ? { ...p, inReserve: true } : p)) }
  assert.equal(getActiveTemporaryPass(reserved, 'tamer-1'), null, 'its Tamer staged in reserve')
})

test('a pass is void outside combat and never exists for the GM', () => {
  const encounter = withPass(encounterRow())
  for (const phase of ['setup', 'initiative', 'ended']) {
    assert.equal(getActiveTemporaryPass({ ...encounter, phase }, 'tamer-1'), null, phase)
  }
  encounter.intercedeOptOuts.temporaryPasses.GM = { characterId: 'tamer-p1', turnsStarted: 0, createdAt: 'then' }
  assert.equal(getActiveTemporaryPass(encounter, 'GM'), null)
  assert.deepEqual(getPassingOwnerIds(encounter), ['tamer-1'])
})

test('a pass answers ordinary offers only; permanent opt-outs are a separate preference', () => {
  const encounter = withPass(encounterRow({
    intercedeOptOuts: { targets: { 'tamer-2': ['mon-1'] } },
  }))
  const ordinary = singleOffer('a', 'g', 'tamer-1', 'mon-2')
  const quickReaction = singleOffer('b', 'g', 'tamer-1', 'mon-1', { canUseQuickReaction: true, quickReactionDiceCount: 3 })
  assert.equal(isOfferPassed(encounter, ordinary), true)
  assert.equal(isOfferPassed(encounter, quickReaction), false, 'Quick Reaction is a separate decision, so the prompt stands')
  assert.equal(isOfferPassed(encounter, singleOffer('c', 'g', 'tamer-2', 'mon-1')), false, "another player's offer")
  assert.equal(isOfferPassed(encounter, singleOffer('d', 'g', 'GM', 'mon-1')), false, "the GM's offer")

  // The permanent list still works, with or without a pass, and a pass never writes it.
  const optedOut = singleOffer('e', 'g', 'tamer-2', 'mon-1')
  assert.equal(isOfferSuppressed(encounter, optedOut), true)
  assert.deepEqual(getTargetOptOuts(encounter, 'tamer-2'), ['mon-1'])
  assert.deepEqual(getTargetOptOuts(encounter, 'tamer-1'), [])
  const noPass = { ...encounter, intercedeOptOuts: { targets: encounter.intercedeOptOuts.targets } }
  assert.equal(isOfferSuppressed(noPass, ordinary), false)
  assert.equal(isOfferSuppressed(noPass, optedOut), true)
})

// --- turn starts: the three real implementations --------------------------------------------------------

async function client(state) {
  let stored = copy(state)
  globalThis.ref = value => ({ value })
  globalThis.$fetch = async (_url, options) => {
    if (options?.method === 'PUT') stored = { ...stored, ...copy(options.body) }
    return copy(stored)
  }
  const { useEncounters } = loadTypeScriptWithMocks('composables/useEncounters.ts', {})
  const api = useEncounters()
  await api.fetchEncounter('encounter')
  return api
}

function knockoutResolver() {
  const unchanged = async ({ participants }) => ({ participants, logEntries: [] })
  return loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    '../db': { db: { select: unexpected }, digimon: {}, encounters: {}, campaigns: {} },
    './resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    './combatSpatial': { loadParticipantDigimon: async () => new Map(Object.values(digimonRows).map(row => [row.id, row])) },
    './endOfTurnGravity': { applyEndOfTurnGravity: unexpected, computeGravityDrops: unexpected },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: identity },
    './damageOverTime': { applyRoundEndEffects: unchanged, loadRoundEndContext: async () => ({}) },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  }).resolveEnemyKnockouts
}

function legacyNpcAttack(state) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async event => event
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const unchanged = async ({ participants }) => ({ participants, logEntries: [] })
  const tables = Object.fromEntries(['encounters', 'campaigns', 'digimon', 'tamers', 'evolutionLines'].map(name => [name, { name, id: name }]))
  let stored = copy(state)
  const db = {
    select: () => ({ from: table => ({ where: async ({ value }) => {
      if (table === tables.encounters) return [copy(stored)]
      if (table === tables.digimon) return digimonRows[value] ? [{ ...digimonRows[value], baseStats: { damage: 5, armor: 0 } }] : []
      throw new Error(`Unexpected read from ${table.name}`)
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      assert.equal(table, tables.encounters)
      stored = { ...stored, ...copy(fields) }
    } }) }),
  }
  return loadTypeScriptWithMocks('server/api/encounters/[id]/actions/npc-attack.post.ts', {
    '../../../../db': { db, ...tables },
    'drizzle-orm': { eq },
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: unexpected, calculateEffectPotency: unexpected },
    '../../../../utils/pushPull': { applyPushPullDisplacement: unexpected },
    '../../../../utils/endOfTurnGravity': { applyEndOfTurnGravity: async (_id, _map, participants) => ({ participants, logEntries: [] }) },
    '../../../../utils/roundStartQualityTriggers': { applyRoundStartQualityTriggers: identity },
    '../../../../utils/damageOverTime': { applyRoundEndEffects: unchanged, loadStationaryBurnPositions: async () => ({}), damageOverTimeRules: () => ({}) },
    '../../../../utils/enemyKnockouts': {
      knockedOutEnemyIds: participants => participants.filter(p => p.isEnemy && p.currentWounds >= p.maxWounds).map(p => p.id),
      resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }),
    },
    '../../../../utils/guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  }).default
}

const turnState = (participants, turnOrder, currentTurnIndex = 0, round = 1) =>
  withPass(encounterRow({ participants, turnOrder, currentTurnIndex, round }))

for (const wrap of [false, true]) {
  test(`client turn advance ends the pass at its Tamer's turn${wrap ? ' after a round wrap' : ''}, and only then`, async () => {
    const participants = wrap
      ? [tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1'), digimonUnit('foe', { isEnemy: true }), tamer('tamer-p2', 'tamer-2')]
      : [digimonUnit('foe', { isEnemy: true, isActive: true }), tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1'), tamer('tamer-p2', 'tamer-2')]
    const turnOrder = wrap ? ['tamer-p1', 'foe', 'tamer-p2'] : ['foe', 'tamer-p1', 'tamer-p2']
    const state = turnState(participants, turnOrder, wrap ? 2 : 0)
    withPass(state, 'tamer-2')
    const api = await client(state)

    const result = await api.nextTurn('encounter', new Map([['mon-1', digimonRows['mon-1']]]))
    assert.equal(result.turnOrder[result.currentTurnIndex], wrap ? 'tamer-p1' : 'tamer-p1')
    assert.equal(result.round, wrap ? 2 : 1)
    assert.equal(getActiveTemporaryPass(result, 'tamer-1'), null, 'its next turn started')
    assert.ok(getActiveTemporaryPass(result, 'tamer-2'), "another player's pass is untouched")
    assert.equal(result.participants.find(p => p.id === 'tamer-p1').turnsStarted, 1)
  })
}

test('removing the active participant starts the next Tamer and ends only that pass', async () => {
  const participants = [
    digimonUnit('foe', { isEnemy: true, isActive: true, initiative: 30 }),
    tamer('tamer-p1', 'tamer-1', { initiative: 20 }), tamer('tamer-p2', 'tamer-2', { initiative: 10 }),
  ]
  const state = withPass(turnState(participants, ['foe', 'tamer-p1', 'tamer-p2']), 'tamer-2')
  const result = await (await client(state)).removeParticipant('encounter', 'foe')
  assert.equal(result.turnOrder[result.currentTurnIndex], 'tamer-p1')
  assert.equal(getActiveTemporaryPass(result, 'tamer-1'), null)
  assert.ok(getActiveTemporaryPass(result, 'tamer-2'))
})

test('client roster edits do not end a pass: adding, removing an unrelated unit, removing the Tamer', async () => {
  const participants = [
    tamer('tamer-p1', 'tamer-1', { isActive: true, initiative: 30 }), digimonUnit('mon-1', { initiative: 30 }),
    digimonUnit('extra', { initiative: 5 }), digimonUnit('foe', { isEnemy: true, initiative: 20 }),
  ]
  const api = await client(turnState(participants, ['tamer-p1', 'foe', 'extra']))
  const afterAdd = await api.addParticipant('encounter', digimonUnit('late', { initiative: 40 }))
  assert.ok(getActiveTemporaryPass(afterAdd, 'tamer-1'), 'adding a higher-initiative participant re-sorts the order')
  const afterRemove = await api.removeParticipant('encounter', 'extra')
  assert.ok(getActiveTemporaryPass(afterRemove, 'tamer-1'))
  const afterTamerGone = await api.removeParticipant('encounter', 'tamer-p1')
  assert.equal(getActiveTemporaryPass(afterTamerGone, 'tamer-1'), null, 'a removed Tamer has no turn left to wait for')
})

test('a server knockout that starts the Tamer ends its pass; one that starts someone else does not', async () => {
  const dead = digimonUnit('foe', { isEnemy: true, currentWounds: 20, isActive: true })
  const forTamer = turnState([dead, tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1'), tamer('tamer-p2', 'tamer-2')], ['foe', 'tamer-p1', 'tamer-p2'])
  withPass(forTamer, 'tamer-2')
  const first = await knockoutResolver()(forTamer, ['foe'])
  assert.equal(first.turnOrder[first.currentTurnIndex], 'tamer-p1')
  assert.equal(getActiveTemporaryPass({ ...forTamer, participants: first.participants }, 'tamer-1'), null)
  assert.ok(getActiveTemporaryPass({ ...forTamer, participants: first.participants }, 'tamer-2'))

  const wrapState = turnState([tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1'), dead, tamer('tamer-p2', 'tamer-2')], ['tamer-p1', 'tamer-p2', 'foe'], 2)
  const wrapped = await knockoutResolver()(wrapState, ['foe'])
  assert.equal(wrapped.round, 2)
  assert.equal(getActiveTemporaryPass({ ...wrapState, participants: wrapped.participants }, 'tamer-1'), null, 'round wrap')

  const elsewhere = turnState([dead, tamer('tamer-p2', 'tamer-2'), tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1')], ['foe', 'tamer-p2', 'tamer-p1'])
  const other = await knockoutResolver()(elsewhere, ['foe'])
  assert.equal(other.turnOrder[other.currentTurnIndex], 'tamer-p2')
  assert.ok(getActiveTemporaryPass({ ...elsewhere, participants: other.participants }, 'tamer-1'))
})

test('the legacy NPC attack endpoint starts the next Tamer too', async () => {
  const state = turnState([
    // Five wounds against the endpoint's five damage: attacking itself knocks the active NPC out
    digimonUnit('foe', { isEnemy: true, isActive: true, maxWounds: 5 }), tamer('tamer-p1', 'tamer-1'), digimonUnit('mon-1'),
  ], ['foe', 'tamer-p1'])
  const attack = legacyNpcAttack(state)
  const result = await attack({
    participantId: 'foe', targetId: 'foe', attackId: 'bite',
    accuracyDicePool: 1, accuracySuccesses: 1, accuracyDiceResults: [6],
    dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [],
  })
  assert.equal(result.turnOrder[result.currentTurnIndex], 'tamer-p1')
  assert.equal(getActiveTemporaryPass({ ...state, participants: result.participants }, 'tamer-1'), null)
})

test('every place a turn starts counts it (static guard against a fourth, uncounted path)', () => {
  const sources = ['composables/useEncounters.ts', 'server/utils/enemyKnockouts.ts', 'server/api/encounters/[id]/actions/npc-attack.post.ts']
  for (const file of sources) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    const starts = (source.match(/applyDeferredIntercedeCost\((participant|nextParticipant)\)/g) || []).length
    const counted = (source.match(/recordTurnStart\((participant|nextParticipant)\)/g) || []).length
    assert.ok(starts > 0, file)
    assert.equal(counted, starts, `${file}: each turn start must call recordTurnStart`)
  }
})

// --- starting, answering and resuming ------------------------------------------------------------------

test('Pass answers existing single-target offers exactly as a hand-clicked Skip does', async () => {
  const initial = encounterRow({ pendingRequests: [singleOffer('offer-1', 'group-1', 'tamer-1', 'mon-2')] })
  const manual = createServer(initial)
  await manual.skip('offer-1')

  const passed = createServer(initial)
  const result = await passed.pass('tamer-1')
  assert.deepEqual(outcome(passed.state()), outcome(manual.state()))
  assert.deepEqual(offerIds(passed.state()), [])
  const dodge = passed.state().pendingRequests.find(r => r.type === 'dodge-roll')
  assert.equal(dodge?.targetTamerId, 'tamer-2', "the target's player gets the dodge, as after a Skip")
  assert.equal(dodge?.targetParticipantId, 'mon-2')
  assert.equal(result.pendingRequests.length, passed.state().pendingRequests.length, 'the response is the updated encounter')
  assert.equal(getActiveTemporaryPass(passed.state(), 'tamer-1')?.characterId, 'tamer-p1')
})

test('Pass leaves other players and the GM prompting, and a group with one open decision stays open', async () => {
  const f = createServer(encounterRow({
    pendingRequests: [
      singleOffer('mine', 'group-1', 'tamer-1', 'mon-2'),
      singleOffer('theirs', 'group-1', 'tamer-2', 'mon-2'),
      singleOffer('gm', 'group-1', 'GM', 'mon-2'),
    ],
  }))
  await f.pass('tamer-1')
  assert.deepEqual(offerIds(f.state()), ['theirs', 'gm'])
  assert.equal(f.state().pendingRequests.some(r => r.type === 'dodge-roll'), false, 'the attack waits for the others')
})

test('Pass answers an NPC target through the same auto-resolution as Skip', async () => {
  const initial = encounterRow({ pendingRequests: [singleOffer('offer-npc', 'group-npc', 'tamer-1', 'npc-ally', { attackerId: 'mon-2' })] })
  const manual = createServer(initial)
  await manual.skip('offer-npc')
  const passed = createServer(initial)
  await passed.pass('tamer-1')
  assert.deepEqual(passed.npcResolutions, [{ attacker: 'mon-2', target: 'npc-ally' }])
  assert.deepEqual(passed.npcResolutions, manual.npcResolutions)
  assert.deepEqual(outcome(passed.state()), outcome(manual.state()))
  assert.ok(passed.state().battleLog.some(entry => entry.id === 'npc-npc-ally'))
})

test('Pass skips a whole area offer (an opt-out would keep it open) and the cast resolves like Skip All', async () => {
  const requests = [
    groupState('area-1'),
    areaOffer('area-mine', 'area-1', 'tamer-1', { tamerAreaTargetIds: [], digimonAreaTargetIds: ['mon-2'] }),
    areaOffer('area-gm', 'area-1', 'GM', { npcAreaEligibility: { 'npc-ally': ['mon-2', 'npc-ally'] }, gmAreaTargetIds: ['mon-2', 'npc-ally'] }),
  ]
  const initial = encounterRow({ pendingRequests: requests })

  const passed = createServer(initial)
  await passed.pass('tamer-1')
  assert.deepEqual(offerIds(passed.state()), ['area-gm'], "the owner's whole offer is gone, the GM's remains")
  assert.ok(passed.state().pendingRequests.some(r => r.type === 'intercede-group-state'), 'the cast is still waiting for the GM')

  await passed.skip('area-gm')
  const manual = createServer(initial)
  await manual.skip('area-mine')
  await manual.skip('area-gm')
  assert.deepEqual(outcome(passed.state()), outcome(manual.state()))
  const final = passed.state()
  assert.equal(final.pendingRequests.some(r => r.type === 'intercede-group-state'), false)
  assert.deepEqual(final.pendingRequests.filter(r => r.type === 'dodge-roll').map(r => r.targetTamerId), ['tamer-2'])
  assert.deepEqual(passed.npcResolutions, [{ attacker: 'foe', target: 'npc-ally' }])
})

test('Pass skips an owner whose offer is the last open decision for an area cast', async () => {
  const f = createServer(encounterRow({ pendingRequests: [
    groupState('area-1'),
    areaOffer('area-mine', 'area-1', 'tamer-1', { tamerAreaTargetIds: [], digimonAreaTargetIds: ['mon-2'] }),
  ] }))
  await f.pass('tamer-1')
  assert.deepEqual(f.state().pendingRequests.map(r => r.type), ['dodge-roll'])
  assert.equal(f.npcResolutions.length, 1)
})

test('Pass leaves an offer that carries a Quick Reaction standing', async () => {
  const f = createServer(encounterRow({ pendingRequests: [
    singleOffer('qr', 'group-qr', 'tamer-1', 'mon-1', { canUseQuickReaction: true, quickReactionDiceCount: 3 }),
    singleOffer('plain', 'group-plain', 'tamer-1', 'mon-2'),
  ] }))
  await f.pass('tamer-1')
  assert.deepEqual(offerIds(f.state()), ['qr'])
})

test('Pass stops declining later attacks as soon as an earlier resolution starts its owner turn', async () => {
  const f = createServer(withPass(encounterRow({ pendingRequests: [
    singleOffer('first', 'group-first', 'tamer-1', 'npc-ally'),
    singleOffer('later', 'group-later', 'tamer-1', 'mon-2'),
  ] })))
  // Reflected damage can defeat the active NPC, starting the passing Tamer's next turn.
  f.onNpcResolution(params => ({
    participants: params.participants.map(p => p.id === 'tamer-p1' ? { ...p, turnsStarted: 1 } : p),
    battleLog: params.battleLog, turnOrder: params.turnOrder, nextTurnIndex: 1,
  }))
  await f.pass('tamer-1')
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null)
  assert.deepEqual(offerIds(f.state()), ['later'], 'the next attack needs a fresh intercede decision')
  assert.equal(f.state().pendingRequests.some(r => r.type === 'dodge-roll'), false)
  assert.equal(f.npcResolutions.length, 1)
})

for (const passing of [false, true]) {
  test(`spending Quick Reaction clears its stale flag on other attacks${passing ? ' and resumes automatic passing' : ''}`, async () => {
    let row = encounterRow({ pendingRequests: [
      singleOffer('qr-first', 'group-first', 'tamer-1', 'mon-1', { canUseQuickReaction: true, quickReactionDiceCount: 3 }),
      singleOffer('qr-later', 'group-later', 'tamer-1', 'mon-1', { canUseQuickReaction: true, quickReactionDiceCount: 3 }),
      singleOffer('other-owner', 'group-other', 'tamer-2', 'mon-2', { canUseQuickReaction: true, quickReactionDiceCount: 3 }),
    ] })
    if (passing) row = withPass(row)
    const f = createServer(row)
    f.tamerRecords['tamer-1'].attributes.intelligence = 5
    await f.quickReaction('qr-first')
    const state = f.state()
    assert.deepEqual(f.tamerRecords['tamer-1'].usedPerDayOrders, ['Quick Reaction'])
    assert.equal(state.participants.find(p => p.id === 'tamer-p1').interceptPenalty, 1)
    const later = state.pendingRequests.find(r => r.id === 'qr-later')
    if (passing) {
      assert.equal(later, undefined, 'an unusable daily order must not leave a passing player blocked')
      assert.equal(state.pendingRequests.filter(r => r.type === 'dodge-roll').length, 2)
    } else {
      assert.equal(later.data.canUseQuickReaction, false)
      assert.equal(later.data.quickReactionDiceCount, 0)
    }
    assert.equal(state.pendingRequests.find(r => r.id === 'other-owner').data.canUseQuickReaction, true)
  })
}

test('Pass validation: players in combat only, and a Tamer that is in the fight', async () => {
  const setup = createServer(encounterRow({ phase: 'setup' }))
  await assert.rejects(() => setup.pass('tamer-1'), error => error.statusCode === 409)
  assert.equal(setup.state().intercedeOptOuts.temporaryPasses, undefined)

  const f = createServer(encounterRow())
  await assert.rejects(() => f.pass('GM'), error => error.statusCode === 400)
  await assert.rejects(() => f.pass('nobody'), error => error.statusCode === 404)
  await assert.rejects(() => f.pass('tamer-1', 'later'), error => error.statusCode === 400)
  await assert.rejects(() => createServer(encounterRow({
    participants: roster().map(p => (p.id === 'tamer-p1' ? { ...p, inReserve: true } : p)),
  })).pass('tamer-1'), error => error.statusCode === 404)
  assert.deepEqual(getPassingOwnerIds(f.state()), [])
})

test('Resume prompting ends the pass at once and touches nothing else', async () => {
  const f = createServer(encounterRow({
    intercedeOptOuts: { targets: { 'tamer-1': ['mon-2'] }, gmCharacters: { 'mon-2': ['foe'] } },
    pendingRequests: [singleOffer('later', 'group-later', 'tamer-1', 'mon-1')],
  }))
  await f.pass('tamer-1')
  assert.ok(getActiveTemporaryPass(f.state(), 'tamer-1'))
  await f.pass('tamer-1', 'resume')
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null)
  assert.deepEqual(f.state().intercedeOptOuts, { targets: { 'tamer-1': ['mon-2'] }, gmCharacters: { 'mon-2': ['foe'] }, temporaryPasses: {} })
  // Prompting is back: a later offer is no longer suppressed.
  assert.equal(isOfferSuppressed(f.state(), singleOffer('x', 'g', 'tamer-1', 'mon-1')), false)
  await f.pass('tamer-1', 'resume') // idempotent
})

test('permanent opt-outs survive setting, expiry and resuming a pass, and a pass survives saving them', async () => {
  const f = createServer(encounterRow({ intercedeOptOuts: { targets: { 'tamer-1': ['mon-2'] } } }))
  await f.pass('tamer-1')
  assert.deepEqual(f.state().intercedeOptOuts.targets, { 'tamer-1': ['mon-2'] })

  await f.saveOptOuts('tamer-1', ['mon-2', 'foe'])
  assert.deepEqual(f.state().intercedeOptOuts.targets['tamer-1'], ['mon-2', 'foe'])
  assert.ok(getActiveTemporaryPass(f.state(), 'tamer-1'), 'saving opt-outs does not end a pass')

  const participants = f.state().participants
  recordTurnStart(participants.find(p => p.id === 'tamer-p1'))
  f.set({ participants })
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null, 'expired')
  assert.deepEqual(f.state().intercedeOptOuts.targets['tamer-1'], ['mon-2', 'foe'], 'expiry leaves the list alone')
  assert.equal(isOfferSuppressed(f.state(), singleOffer('x', 'g', 'tamer-1', 'foe')), true, 'the permanent opt-out still applies')
  assert.equal(isOfferSuppressed(f.state(), singleOffer('y', 'g', 'tamer-1', 'mon-1')), false, 'and normal prompting is back')

  await f.pass('tamer-1', 'resume')
  assert.deepEqual(f.state().intercedeOptOuts.targets['tamer-1'], ['mon-2', 'foe'])
})

test('starting a new pass drops expired ones and keeps other players', async () => {
  const f = createServer(withPass(withPass(encounterRow(), 'tamer-1'), 'tamer-2'))
  const participants = f.state().participants
  recordTurnStart(participants.find(p => p.id === 'tamer-p1'))
  f.set({ participants })
  await f.pass('tamer-2')
  assert.deepEqual(Object.keys(f.state().intercedeOptOuts.temporaryPasses), ['tamer-2'], "tamer-1's expired pass is pruned")
  await f.pass('tamer-1')
  assert.deepEqual(Object.keys(f.state().intercedeOptOuts.temporaryPasses).sort(), ['tamer-1', 'tamer-2'])
  assert.equal(f.state().intercedeOptOuts.temporaryPasses['tamer-1'].turnsStarted, 1)
})

test('a concurrent opt-out save and pass both persist (the preference writes lock the row)', async () => {
  const f = createServer(encounterRow())
  await Promise.all([f.saveOptOuts('tamer-1', ['mon-2']), f.pass('tamer-1'), f.pass('tamer-2')])
  const saved = f.state().intercedeOptOuts
  assert.deepEqual(saved.targets, { 'tamer-1': ['mon-2'] })
  assert.deepEqual(Object.keys(saved.temporaryPasses).sort(), ['tamer-1', 'tamer-2'])
})

test('a pass applied while a Skip is being decided waits for it, so neither decision overwrites the other', async () => {
  const f = createServer(encounterRow({ pendingRequests: [
    singleOffer('x', 'group-x', 'tamer-2', 'mon-1'),
    singleOffer('y', 'group-y', 'tamer-1', 'mon-2'),
  ] }))
  const gate = f.holdNextDecision()
  const skip = f.skip('x') // reads the encounter, then parks before writing
  await gate.entered.promise
  const pass = f.pass('tamer-1')
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(offerIds(f.state()), ['x', 'y'], 'nothing is decided while the Skip owns the encounter')
  gate.release.resolve()
  await Promise.all([skip, pass])

  const state = f.state()
  assert.deepEqual(offerIds(state), [], 'both offers were answered: neither decision restored the offer the other one removed')
  assert.deepEqual(state.pendingRequests.filter(r => r.type === 'dodge-roll').map(r => r.targetTamerId).sort(), ['tamer-1', 'tamer-2'])
})

// --- offers created while passing ----------------------------------------------------------------------

function loadOfferHandler(server, extra = {}) {
  return loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-offer.post.ts', {
    'drizzle-orm': { eq, inArray },
    '../../../../db': server.dbModule,
    '~/server/utils/resolveNpcAttack': { resolveNpcAttack: unexpected },
    '~/server/utils/resolveSupportAttack': {
      resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected, resolveNegativeSupportNpc: unexpected,
      getPositiveSupportResolutionType: () => null,
    },
    '~/server/utils/triggerCounterattack': { triggerCounterattack: unexpected },
    '~/server/utils/encounterRoom': { getRoomPositions: async () => ({}), broadcastPositionPatch: unexpected },
    '~/server/utils/guidingLight': { applyGuidingLightAuras: unexpected },
    '~/server/utils/combatSpatial': { loadEncounterMap: unexpected, getMovementProfile: unexpected },
    '~/server/utils/pushPull': { resolveInstantSupportEffect: unexpected },
    '~/server/utils/intercedePasses': server.passes,
    '~/server/utils/intercedeClaims': queue,
    ...extra,
  }).default
}
const offerBody = { attackerId: 'foe', targetId: 'mon-2', accuracySuccesses: 2, accuracyDice: [6, 6], attackId: 'bite', attackName: 'Bite', attackData: { dicePool: 3 }, skipActionDeduction: true }

test('without a pass, the same attack does prompt the other Tamer (so the checks below are not vacuous)', async () => {
  const f = createServer(encounterRow())
  const result = await loadOfferHandler(f)({ encounterId: 'encounter', body: offerBody })
  assert.ok(result.pendingRequests.some(r => r.type === 'intercede-offer' && r.targetTamerId === 'tamer-1'))
})

test('an attack made while a player is passing never prompts them, and the cast still resolves', async () => {
  const f = createServer(withPass(withPass(encounterRow()), 'tamer-2'))
  const result = await loadOfferHandler(f)({ encounterId: 'encounter', body: offerBody })
  // The GM (an NPC can intercede) is still asked: a pass is a player's preference only.
  assert.deepEqual(result.pendingRequests.filter(r => r.type === 'intercede-offer').map(r => r.targetTamerId), ['GM'])
  assert.equal(result.pendingRequests.some(r => r.type === 'dodge-roll'), false, 'the attack waits for the GM')
  assert.deepEqual(outcome(f.state()), outcome(result), 'the response is the persisted encounter')

  // Once the GM answers, the attack goes on to the dodge exactly as after two hand-clicked Skips.
  await f.skip(offerIds(result)[0])
  const dodge = f.state().pendingRequests.find(r => r.type === 'dodge-roll')
  assert.equal(dodge?.targetTamerId, 'tamer-2')
  assert.deepEqual(offerIds(f.state()), [])
})

test('a pass for one player removes only that player from a fresh offer', async () => {
  const f = createServer(withPass(encounterRow()))
  const result = await loadOfferHandler(f)({ encounterId: 'encounter', body: offerBody })
  assert.equal(result.pendingRequests.some(r => r.type === 'intercede-offer' && r.targetTamerId === 'tamer-1'), false)
  assert.ok(getActiveTemporaryPass(result, 'tamer-1'))
})

test('an expired pass prompts again: after the Tamer\'s next turn the same attack asks them', async () => {
  const f = createServer(withPass(encounterRow()))
  const participants = f.state().participants
  recordTurnStart(participants.find(p => p.id === 'tamer-p1'))
  f.set({ participants })
  const result = await loadOfferHandler(f)({ encounterId: 'encounter', body: offerBody })
  assert.ok(result.pendingRequests.some(r => r.type === 'intercede-offer' && r.targetTamerId === 'tamer-1'))
})

test('new offer creation waits for an automatic pass and preserves the defense it creates', async () => {
  const f = createServer(encounterRow({ pendingRequests: [
    singleOffer('old-offer', 'old-group', 'tamer-1', 'mon-2'),
  ] }))
  const gate = f.holdNextDecision()
  const passing = f.pass('tamer-1')
  await gate.entered.promise
  const attack = loadOfferHandler(f)({ encounterId: 'encounter', body: offerBody })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(offerIds(f.state()), ['old-offer'], 'creation cannot write while the pass owns the decision queue')
  } finally {
    gate.release.resolve()
  }
  await Promise.all([passing, attack])
  const state = f.state()
  assert.equal(state.pendingRequests.filter(r => r.type === 'dodge-roll' && r.targetParticipantId === 'mon-2').length, 1)
  assert.equal(state.pendingRequests.some(r => r.id === 'old-offer'), false)
  assert.ok(state.pendingRequests.some(r => r.type === 'intercede-offer' && r.targetTamerId === 'GM'))
})

// --- combat end and copies -----------------------------------------------------------------------------

function loadPut(server) {
  const unchanged = async ({ participants }) => ({ participants, logEntries: [] })
  return loadTypeScriptWithMocks('server/api/encounters/[id].put.ts', {
    'drizzle-orm': { eq },
    '../../db': server.dbModule,
    '../../utils/encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }) },
    '../../utils/endOfTurnGravity': { applyEndOfTurnGravity: async (_id, _map, participants) => ({ participants, logEntries: [] }) },
    '../../utils/roundStartQualityTriggers': { applyRoundStartQualityTriggers: identity },
    '../../utils/encounterStartTriggers': { applyEncounterStartTriggers: identity },
    '../../utils/guidingLight': { applyGuidingLightAuras: async participants => ({ changed: false, participants }) },
    '../../utils/damageOverTime': {
      applyTurnEndEffects: unchanged, applyRoundEndEffects: unchanged,
      loadStationaryBurnPositions: async () => ({}), damageOverTimeRules: () => ({}),
    },
    '../../utils/enemyKnockouts': {
      knockedOutEnemyIds: () => [],
      resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }),
    },
    '../../utils/combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', houseRules: undefined, rulesSettings: null }) },
    '../../utils/intercedeOptOuts': server.preferences,
  }).default
}

test('ending combat clears every pass and keeps the permanent opt-outs', async () => {
  const f = createServer(withPass(withPass(encounterRow({ intercedeOptOuts: { targets: { 'tamer-1': ['mon-2'] } } })), 'tamer-2'))
  const put = loadPut(f)
  await put({ encounterId: 'encounter', body: { round: 1, battleLog: [] } })
  assert.deepEqual(getPassingOwnerIds(f.state()), ['tamer-1', 'tamer-2'], 'an ordinary update leaves passes alone')

  await put({ encounterId: 'encounter', body: { phase: 'ended' } })
  assert.equal(f.state().phase, 'ended')
  assert.deepEqual(f.state().intercedeOptOuts, { targets: { 'tamer-1': ['mon-2'] } })

  // A later combat in the same encounter starts with everyone prompted again.
  f.set({ phase: 'combat' })
  assert.deepEqual(getPassingOwnerIds(f.state()), [])
})

test('a stale client copy cannot roll the turn counter back and revive an expired pass', async () => {
  const f = createServer(withPass(encounterRow()))
  const expired = f.state().participants.map(p => (p.id === 'tamer-p1' ? { ...p, turnsStarted: 1 } : p))
  f.set({ participants: expired })
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null)

  const stale = copy(roster()) // never saw the turn start: no counter
  await loadPut(f)({ encounterId: 'encounter', body: { participants: stale, round: 1 } })
  assert.equal(f.state().participants.find(p => p.id === 'tamer-p1').turnsStarted, 1)
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null)

  // A newer counter from the client is accepted.
  const newer = stale.map(p => (p.id === 'tamer-p1' ? { ...p, turnsStarted: 2 } : p))
  await loadPut(f)({ encounterId: 'encounter', body: { participants: newer, round: 1 } })
  assert.equal(f.state().participants.find(p => p.id === 'tamer-p1').turnsStarted, 2)
})

test('a fresh copy starts with no passes; a snapshot keeps them (and the counters they are measured against)', async () => {
  const source = withPass(encounterRow({ intercedeOptOuts: { targets: { 'tamer-1': ['mon-2'] } } }))
  source.participants = source.participants.map(p => (p.id === 'tamer-p2' ? { ...p, turnsStarted: 3 } : p))
  const f = createServer(source)
  const inserted = []
  const duplicate = loadTypeScriptWithMocks('server/api/encounters/[id]/duplicate.post.ts', {
    'drizzle-orm': { eq },
    '../../../db': { db: { ...f.db, insert: () => ({ values: async row => { inserted.push(copy(row)) } }) }, ...f.tables },
    '../../../utils/id': { generateId: () => `copy-${inserted.length}` },
    '../../../utils/encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }) },
  }).default
  const run = async mode => {
    inserted.length = 0
    try {
      await duplicate({ encounterId: 'encounter', body: { mode } })
    } catch {
      // The handler re-reads the inserted copy, which this fake does not keep; the insert is what matters.
    }
    return inserted[0]
  }
  const fresh = await run('fresh')
  assert.deepEqual(fresh.intercedeOptOuts, { targets: { 'tamer-1': ['mon-2'] } }, 'permanent opt-outs carry over, passes do not')
  assert.equal(fresh.participants.every(p => p.turnsStarted === undefined), true)
  const snapshot = await run('snapshot')
  assert.deepEqual(Object.keys(snapshot.intercedeOptOuts.temporaryPasses), ['tamer-1'])
  assert.equal(getActiveTemporaryPass(snapshot, 'tamer-1')?.characterId, 'tamer-p1', 'still in force in the copy')
  assert.equal(snapshot.participants.find(p => p.id === 'tamer-p2').turnsStarted, 3)
})

// --- claims and passes are decided one at a time --------------------------------------------------------

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function claimFixture(initial) {
  const server = createServer(initial)
  const entered = deferred()
  const release = deferred()
  const claim = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-claim.post.ts', {
    '../../../../db': server.dbModule,
    'drizzle-orm': { eq, inArray },
    '~/server/utils/intercedeClaims': queue,
    '~/server/utils/resolveAreaIntercedeGroup': {
      resolveAreaIntercedeGroup: unexpected, allAreaTargetsDecided: unexpected, isAreaTargetCovered: unexpected,
    },
    '~/server/utils/computeAttackDamage': { computeAttackDamage: async () => {
      entered.resolve()
      await release.promise
      return {
        attackDef: { id: 'bite' }, attackBaseDamage: 2, armorPiercing: 0, targetArmor: 0, effectiveArmor: 0,
        outsideClashArmorBonus: 0, damageDealt: 2, netSuccesses: 2, appliedEffectName: null, effectData: null,
        reflectDamageToAttacker: 0,
      }
    } },
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    '~/server/utils/encounterRoom': {
      getRoomPositions: async () => ({}),
      getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }),
      broadcastPositionPatch: unexpected,
    },
    '~/server/utils/guidingLight': { refreshGuidingLightForParticipants: unexpected, recomputeGuidingLightForEncounter: unexpected },
    '~/server/utils/combatSpatial': { loadEncounterMap: unexpected, getMovementProfile: unexpected, getFallerProfile: unexpected },
    '~/server/utils/mapMovement': {},
    '~/utils/areaShapes': {},
    '~/utils/movementRules': {},
    '~/server/utils/damageOverTime': { applyMovementBurn: unexpected, movesFromPositions: unexpected },
    '~/server/utils/enemyKnockouts': {
      knockedOutEnemyIds: () => [],
      resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }),
    },
  }).default
  return {
    ...server, entered, release,
    claim: () => claim({ encounterId: 'encounter', body: { requestId: 'mine', interceptorParticipantId: 'mon-1' } }),
  }
}
const claimState = () => encounterRow({
  pendingRequests: [singleOffer('mine', 'group-1', 'tamer-1', 'mon-2'), singleOffer('other', 'group-1', 'tamer-2', 'mon-2')],
})

test('a pass set while a claim is in flight waits for it: the claim wins once and the pass then finds nothing', async () => {
  const f = claimFixture(claimState())
  const claim = f.claim()
  await f.entered.promise
  const pass = f.pass('tamer-1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(getActiveTemporaryPass(f.state(), 'tamer-1'), null, 'the pass has not been applied in the middle of the claim')
  f.release.resolve()
  await Promise.all([claim, pass])

  const state = f.state()
  assert.equal(state.participants.find(p => p.id === 'mon-1').currentWounds, 2, 'the interceptor takes the hit exactly once')
  assert.equal(state.battleLog.filter(entry => entry.action === 'Interceded for mon-2!').length, 1)
  assert.deepEqual(offerIds(state), [], 'the claim consumed the whole group')
  assert.equal(state.pendingRequests.some(r => r.type === 'dodge-roll'), false)
  assert.ok(getActiveTemporaryPass(state, 'tamer-1'), 'and the pass is on for what comes next')
})

test('a claim made after the pass answered the offer is refused and changes nothing', async () => {
  const f = claimFixture(claimState())
  await f.pass('tamer-1')
  f.release.resolve()
  const afterPass = f.state()
  await assert.rejects(() => f.claim(), error => error.statusCode === 409)
  assert.deepEqual(outcome(f.state()), outcome(afterPass))
  assert.equal(f.state().participants.find(p => p.id === 'mon-1').currentWounds, 0)
})

// --- the page ---------------------------------------------------------------------------------------------

test('the composable derives its state from the encounter and guards double requests', async () => {
  const { ref: vueRef } = await import('vue')
  globalThis.ref = vueRef
  const { useIntercedePass } = loadTypeScript('composables/useIntercedePass.ts')
  const encounter = vueRef(encounterRow())
  const sent = []
  const applied = []
  const gate = deferred()
  const errors = []
  const pass = useIntercedePass({
    encounter: () => encounter.value,
    ownerId: () => 'tamer-1',
    send: async (id, body) => { sent.push({ id, body }); await gate.promise; return { id } },
    apply: async result => { applied.push(result) },
    onError: message => errors.push(message),
  })
  assert.equal(pass.isPassing.value, false)

  const first = pass.start()
  const second = pass.start() // a double click
  assert.equal(await second, false)
  assert.equal(pass.busy.value, true)
  gate.resolve()
  assert.equal(await first, true)
  assert.deepEqual(sent, [{ id: 'encounter', body: { ownerId: 'tamer-1', action: 'start' } }])
  assert.deepEqual(applied, [{ id: 'encounter' }])

  encounter.value = withPass(encounterRow())
  assert.equal(pass.isPassing.value, true, 'derived from the synced encounter')
  const participants = encounter.value.participants
  recordTurnStart(participants.find(p => p.id === 'tamer-p1'))
  encounter.value = { ...encounter.value, participants: [...participants] }
  assert.equal(pass.isPassing.value, false, 'expires with the turn, with no local timer or flag')

  const failing = useIntercedePass({
    encounter: () => encounter.value, ownerId: () => 'tamer-1',
    send: async () => { throw Object.assign(new Error('x'), { data: { message: 'Passing is only available while combat is running' } }) },
    apply: unexpected, onError: message => errors.push(message),
  })
  assert.equal(await failing.resume(), false)
  assert.deepEqual(errors, ['Passing is only available while combat is running'])
  assert.equal(failing.busy.value, false)
})

test('the player page offers the pass wherever Skip is, shows the active preference, and skips quietly', () => {
  const page = readFileSync(new URL('../pages/campaigns/[campaignId]/player/[tamerId].vue', import.meta.url), 'utf8')
  assert.equal((page.match(/@click="startIntercedePass"/g) || []).length, 3, 'main prompt, area prompt and map-mode area picker')
  assert.equal((page.match(/<IntercedePassNotice /g) || []).length, 3, 'card view, map mode and the options dialog')
  assert.match(page, /Resume prompting|@resume="resumeIntercedePass"/)
  assert.match(page, /isOfferSuppressed\(activeEncounter\.value as any, req\)/)
  assert.doesNotMatch(page, /isOfferFullyOptedOut/, 'the watcher uses the combined opt-out/pass rule')
  assert.match(page, /watch\(isPassingOnIntercede/)

  const gm = readFileSync(new URL('../pages/campaigns/[campaignId]/encounters/[id].vue', import.meta.url), 'utf8')
  assert.doesNotMatch(gm, /intercede-pass|useIntercedePass/, 'players only')
})
