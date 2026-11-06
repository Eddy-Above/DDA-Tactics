import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => structuredClone(value)
const unexpected = () => { throw new Error('unexpected combat side effect') }
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.encounterId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps']
    .map(name => [name, { name, id: name }]))
  const participants = ['attacker', 'target', 'guard'].map(id => ({
    id, entityId: id, type: 'digimon', actionsRemaining: { simple: 2 },
    currentWounds: 0, maxWounds: 20, activeEffects: [],
  }))
  participants.push({
    id: 'tamer', entityId: 'tamer-entity', type: 'tamer', actionsRemaining: { simple: 2 },
    currentWounds: 0, maxWounds: 20, activeEffects: [],
  })
  const offer = (id, group, targetId) => ({
    id, type: 'intercede-offer', targetTamerId: 'GM',
    data: {
      intercedeGroupId: group, attackerId: 'attacker', attackerName: 'attacker',
      attackId: 'attack', attackName: 'Attack', targetId, targetName: targetId,
      accuracySuccesses: 2, accuracyDice: [6, 6], isAreaAttack: false,
    },
  })
  let stored = {
    id: 'encounter', phase: 'combat', round: 1, mapId: null,
    participants, turnOrder: participants.map(p => p.id), currentTurnIndex: 0, battleLog: [],
    pendingRequests: [offer('claim-a', 'claimed-group', 'target'), offer('claim-b', 'claimed-group', 'target'), offer('decision-offer', 'other-group', 'other-target')],
  }
  const enteredClaim = deferred()
  const releaseClaim = deferred()
  const committed = deferred()
  const decisionReads = []
  const preferenceWrites = []
  const decisionWrites = []
  const resourceWrites = []
  let claimedWrites = 0
  let locked = false

  function read(table, filter, snapshot) {
    if (table === tables.encounters) return [copy(snapshot ?? stored)]
    if (table === tables.digimon) {
      return (filter.values ?? [filter.value]).map(id => ({
        id, name: id, partnerId: null, attacks: [{ id: 'attack', range: 'ranged', tags: [] }], qualities: [],
      }))
    }
    if (table === tables.tamers) return []
    throw new Error(`unexpected ${table.name} read`)
  }
  const db = {
    select: () => ({ from: table => ({ where: async filter => read(table, filter) }) }),
    transaction: async callback => {
      let staged = copy(stored)
      const tx = {
        select: () => ({ from: table => ({ where: filter => ({
          for: async mode => {
            assert.equal(table, tables.encounters)
            assert.equal(mode, 'update')
            locked = true
            return read(table, filter, staged)
          },
          then: (resolve, reject) => Promise.resolve(read(table, filter, staged)).then(resolve, reject),
        }) }) }),
        update: table => ({ set: fields => ({ where: async () => {
          assert.equal(table, tables.encounters)
          assert.equal(locked, true)
          staged = { ...staged, ...copy(fields) }
          claimedWrites++
        } }) }),
      }
      try {
        const result = await callback(tx)
        stored = staged
        committed.resolve()
        return result
      } finally {
        locked = false
      }
    },
  }
  const dbExports = { db, ...tables }
  const queue = loadTypeScriptWithMocks('server/utils/intercedeClaims.ts', {})
  const claim = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-claim.post.ts', {
    '../../../../db': dbExports,
    'drizzle-orm': { eq: (_column, value) => ({ value }), inArray: (_column, values) => ({ values }) },
    '~/server/utils/intercedeClaims': queue,
    '~/server/utils/resolveAreaIntercedeGroup': {
      resolveAreaIntercedeGroup: unexpected, allAreaTargetsDecided: unexpected, isAreaTargetCovered: unexpected,
    },
    '~/server/utils/computeAttackDamage': { computeAttackDamage: async () => {
      enteredClaim.resolve()
      await releaseClaim.promise
      return {
        attackDef: { id: 'attack' }, attackBaseDamage: 2, armorPiercing: 0,
        targetArmor: 0, effectiveArmor: 0, outsideClashArmorBonus: 0, damageDealt: 2,
        netSuccesses: 2, appliedEffectName: null, effectData: null, reflectDamageToAttacker: 0,
      }
    } },
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    '~/server/utils/encounterRoom': {
      getRoomPositions: async () => ({}),
      getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }),
      broadcastPositionPatch: unexpected,
    },
    '~/server/utils/guidingLight': {
      refreshGuidingLightForParticipants: unexpected, recomputeGuidingLightForEncounter: unexpected,
    },
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

  const decisionDatabase = {
    select: () => ({ from: table => ({ where: async filter => {
      assert.equal(table, tables.encounters)
      decisionReads.push(copy(stored.pendingRequests))
      return read(table, filter)
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      resourceWrites.push({ table: table.name, fields: copy(fields) })
      throw new Error('a consumed offer must not spend Quick Reaction resources')
    } }) }),
  }
  const decisions = {
    loadIntercedeDecisionContext: async encounter => {
      // Without route serialization, a decision can read the old offers, then write them
      // back only after the winning claim commits. Model that ordering deterministically.
      await committed.promise
      return { encounterId: encounter.id }
    },
    initialDecisionState: encounter => ({
      participants: encounter.participants, pendingRequests: encounter.pendingRequests,
      battleLog: encounter.battleLog, round: encounter.round, currentTurnIndex: encounter.currentTurnIndex,
    }),
    persistDecisionState: async (_encounter, state) => {
      decisionWrites.push(copy(state.pendingRequests))
      stored = { ...stored, pendingRequests: copy(state.pendingRequests) }
    },
    resolveIntercedeGroupIfDecided: async (_ctx, state) => state,
    pruneOptedOutOffers: async (_ctx, state, ownerId, targetIds) => {
      const pendingRequests = state.pendingRequests.filter(request =>
        request.targetTamerId !== ownerId || !targetIds.includes(request.data.targetId),
      )
      return pendingRequests.length === state.pendingRequests.length ? state : { ...state, pendingRequests }
    },
  }
  const preferences = {
    updateTargetOptOuts: async (encounterId, ownerId, update) => {
      const value = update([])
      preferenceWrites.push({ encounterId, ownerId, value })
      return value
    },
    updateGmCharacterOptOuts: unexpected,
  }
  const decisionMocks = {
    '../../../../db': { db: decisionDatabase, ...tables },
    'drizzle-orm': { eq: (_column, value) => ({ value }) },
    '~/server/utils/intercedeDecision': decisions,
    '~/server/utils/intercedeOptOuts': preferences,
    '~/server/utils/intercedeClaims': queue,
  }
  const skip = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-skip.post.ts', decisionMocks).default
  const optOuts = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-optouts.post.ts', decisionMocks).default
  const quickReaction = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/quick-reaction.post.ts', {
    ...decisionMocks,
    '~/utils/specialOrders': { getUnlockedSpecialOrders: unexpected },
    '~/server/utils/resolveAreaIntercedeGroup': { isAreaTargetCovered: unexpected },
  }).default
  return {
    enteredClaim, releaseClaim, decisionReads, preferenceWrites, decisionWrites, resourceWrites,
    claim: () => claim({ encounterId: 'encounter', body: { requestId: 'claim-a', interceptorParticipantId: 'guard' } }),
    skip: body => skip({ encounterId: 'encounter', body: { requestId: 'decision-offer', ...body } }),
    optOuts: () => optOuts({ encounterId: 'encounter', body: { ownerId: 'GM', intercedeOptOuts: ['other-target'] } }),
    quickReaction: () => quickReaction({ encounterId: 'encounter', body: { requestId: 'claim-b', tamerParticipantId: 'tamer' } }),
    state: () => copy(stored),
    claimedWrites: () => claimedWrites,
  }
}

test('Quick Reaction waits for a competing claim, then rejects the consumed offer without spending resources', async () => {
  const f = fixture()
  const claim = f.claim()
  await f.enteredClaim.promise
  const quickReaction = f.quickReaction().then(value => ({ value }), error => ({ error }))
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.decisionReads.length, 0, 'Quick Reaction must enter the queue before looking up the offer')
    assert.equal(f.resourceWrites.length, 0)
  } finally {
    f.releaseClaim.resolve()
  }
  await claim
  const result = await quickReaction
  assert.equal(result.error?.statusCode, 404)
  assert.equal(result.error?.message, 'Intercede offer not found')
  assert.deepEqual(f.resourceWrites, [])
  assert.deepEqual(f.preferenceWrites, [])
  assert.deepEqual(f.decisionWrites, [])
  assert.deepEqual(f.state().pendingRequests.map(request => request.id), ['decision-offer'])
  assert.deepEqual(f.decisionReads[0].map(request => request.id), ['decision-offer'])
  const tamer = f.state().participants.find(participant => participant.id === 'tamer')
  assert.equal(tamer.actionsRemaining.simple, 2)
  assert.equal(tamer.interceptPenalty, undefined)
  assert.equal(f.state().battleLog.filter(entry => entry.action.includes('Quick Reaction')).length, 0)
})

for (const mode of ['plain Skip', 'Skip with optOut', 'intercede-optouts']) {
  test(`a simultaneous ${mode} waits for the claim and cannot restore consumed offers`, async () => {
    const f = fixture()
    const claim = f.claim()
    await f.enteredClaim.promise
    const decision = mode === 'intercede-optouts' ? f.optOuts() : f.skip(mode === 'Skip with optOut' ? { optOut: true } : {})
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(f.decisionReads.length, 0, 'the decision must join the queue before its first encounter read')
      assert.equal(f.preferenceWrites.length, 0, 'preferences must not mutate while the claim owns the encounter queue')
      assert.equal(f.decisionWrites.length, 0)
    } finally {
      f.releaseClaim.resolve()
    }
    await Promise.all([claim, decision])

    assert.equal(f.claimedWrites(), 1)
    assert.equal(f.decisionWrites.length, 1, 'the valid unrelated offer still receives its requested decision')
    assert.deepEqual(f.state().pendingRequests, [], 'neither consumed claim offer may reappear')
    assert.deepEqual(f.decisionReads[0].map(request => request.id), ['decision-offer'])
    assert.deepEqual(f.decisionWrites[0], [])
    const guard = f.state().participants.find(participant => participant.id === 'guard')
    assert.equal(guard.actionsRemaining.simple, 1, 'the winner spends exactly one action')
    assert.equal(guard.currentWounds, 2, 'the winning interception takes its damage once')
    assert.equal(f.state().battleLog.filter(entry => entry.action === 'Interceded for target!').length, 1)
    if (mode === 'plain Skip') assert.deepEqual(f.preferenceWrites, [])
    else assert.deepEqual(f.preferenceWrites, [{ encounterId: 'encounter', ownerId: 'GM', value: ['other-target'] }])
  })
}
