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
const point = x => ({ x, y: 0, z: 0 })
const unexpected = () => { throw new Error('unexpected combat side effect') }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function unit(id, overrides = {}) {
  return {
    id, entityId: id, type: 'digimon', actionsRemaining: { simple: 2 },
    currentWounds: 0, maxWounds: 20, activeEffects: [], ...overrides,
  }
}

function fixture({ area = false, support = false, map = false, bypassQueue = false, encounterIds = ['encounter'], targets = ['target', 'other-target'] } = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.encounterId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps']
    .map(name => [name, { name, id: { table: name } }]))
  const rows = Object.fromEntries(Object.keys(tables).map(name => [name, new Map()]))
  const rooms = new Map()
  for (const id of ['attacker', 'target', 'other-target', 'guard-a', 'guard-b', 'previous-form']) {
    rows.digimon.set(id, {
      id, name: id, size: 'medium', stage: 'rookie', qualities: [],
      baseStats: { accuracy: 1, damage: 1, dodge: 1, armor: 1, health: 1 },
      attacks: [{ id: 'attack', name: 'Attack', range: 'ranged', tags: [] }],
    })
  }
  for (const encounterId of encounterIds) {
    const participants = ['attacker', 'target', 'other-target', 'guard-a', 'guard-b'].map(id => unit(id))
    const common = {
      intercedeGroupId: 'group', attackerId: 'attacker', attackerName: 'attacker',
      attackId: 'attack', attackName: 'Attack', targetId: 'target', targetName: 'target',
      accuracySuccesses: 2, accuracyDice: [6, 6], isSupportAttack: support,
      isAreaAttack: area, isRangedIntercede: true,
      npcAreaEligibility: { 'guard-a': [...targets], 'guard-b': [...targets] },
      gmAreaTargetIds: [...targets],
    }
    const pendingRequests = ['offer-a', 'offer-b'].map(id => ({
      id, type: 'intercede-offer', targetTamerId: 'GM', data: copy(common),
    }))
    if (area) pendingRequests.push({
      id: 'group-state', type: 'intercede-group-state', data: {
        intercedeGroupId: 'group', attackerId: 'attacker', attackerName: 'attacker',
        attackId: 'attack', attackName: 'Attack', isSupportAttack: support,
        accuracySuccesses: 2, accuracyDice: [6, 6],
        originalTargetIds: [...targets], npcTargetIds: [],
        playerTargetInfo: {}, claims: [],
        areaShapeData: { shape: 'burst', rangeType: 'ranged', bit: 1 },
      },
    })
    rows.encounters.set(encounterId, {
      id: encounterId, participants, pendingRequests, battleLog: [],
      turnOrder: participants.map(p => p.id), currentTurnIndex: 0, phase: 'combat', round: 1,
      mapId: map ? 'map' : null,
    })
    rooms.set(encounterId, {
      participantPositions: Object.fromEntries(participants.map((p, index) => [p.id, point(index)])),
      destructibleStates: [],
    })
  }

  const locks = new Map()
  const owners = new Map()
  const writes = []
  const commits = []
  const rollbacks = []
  const starts = []
  const effects = []
  const positionReads = []
  const areaResolutions = []
  const control = { failEncounterWrites: 0, compute: async () => {}, broadcast: async () => {}, knockout: undefined }
  let nextTransaction = 0

  function select(table, filter, transaction) {
    const values = filter.values ?? [filter.value]
    return values.flatMap(id => {
      const key = `${table.name}:${id}`
      const row = transaction?.staged.get(key)?.row ?? rows[table.name].get(id)
      return row ? [copy(row)] : []
    })
  }
  function database(transaction) {
    return {
      select: () => ({ from: table => ({ where: filter => {
        let executed
        const execute = lock => {
          executed ??= (async () => {
            if (lock) {
              assert.ok(transaction, 'FOR UPDATE requires a transaction')
              assert.equal(table, tables.encounters)
              const key = `${table.name}:${filter.value}`
              const previous = locks.get(key) ?? Promise.resolve()
              const release = deferred()
              const waiting = previous.then(() => release.promise)
              locks.set(key, waiting)
              await previous
              owners.set(filter.value, transaction.id)
              transaction.release.push(() => {
                owners.delete(filter.value)
                release.resolve()
                if (locks.get(key) === waiting) locks.delete(key)
              })
              transaction.locked.add(filter.value)
            }
            return select(table, filter, transaction)
          })()
          return executed
        }
        return {
          for: mode => { assert.equal(mode, 'update'); return execute(true) },
          then: (resolve, reject) => execute(false).then(resolve, reject),
        }
      } }) }),
      update: table => ({ set: fields => ({ where: async filter => {
        assert.ok(transaction, `${table.name} write escaped the transaction`)
        if (table === tables.encounters) {
          assert.ok(transaction.locked.has(filter.value), 'encounter must be locked before writing')
          if (control.failEncounterWrites > 0) {
            control.failEncounterWrites--
            throw new Error('simulated encounter write failure')
          }
        }
        const key = `${table.name}:${filter.value}`
        const original = transaction.staged.get(key)?.row ?? rows[table.name].get(filter.value)
        const row = { ...copy(original), ...copy(fields) }
        transaction.staged.set(key, { table: table.name, id: filter.value, row })
        writes.push({ transaction: transaction.id, table: table.name, id: filter.value })
      } }) }),
    }
  }
  const db = {
    ...database(),
    transaction: async callback => {
      const transaction = { id: ++nextTransaction, staged: new Map(), locked: new Set(), release: [] }
      starts.push(transaction.id)
      try {
        const result = await callback(database(transaction))
        for (const { table, id, row } of transaction.staged.values()) rows[table].set(id, copy(row))
        commits.push({ transaction: transaction.id, writes: transaction.staged.size })
        return result
      } catch (error) {
        rollbacks.push(transaction.id)
        throw error
      } finally {
        transaction.release.forEach(release => release())
      }
    },
  }
  const dbExports = { db, ...tables }
  const knockoutMocks = {
    knockedOutEnemyIds: () => [],
    resolveEnemyKnockouts: async (state, _ids, context) => {
      assert.notEqual(context?.gravity, 'room', 'knockout gravity must not broadcast before commit')
      return control.knockout?.(state, context) ?? { ...state, changed: false, logEntries: [] }
    },
  }
  const guidingLight = {
    refreshGuidingLightForParticipants: async (_id, participants) => participants,
    recomputeGuidingLightForEncounter: async encounterId => {
      assert.equal(owners.has(encounterId), false, 'aura recompute must happen after commit')
      effects.push({ type: 'aura', encounterId })
    },
  }
  const areaModule = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
    '../db': dbExports,
    'drizzle-orm': { eq: (_column, value) => ({ value }) },
    './resolveNpcAttack': { resolveNpcAttack: unexpected },
    './enemyKnockouts': knockoutMocks,
    '~/server/utils/resolveSupportAttack': {
      resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected,
      resolveNegativeSupportNpc: unexpected, getPositiveSupportResolutionType: () => null,
    },
    './guidingLight': guidingLight,
  })
  const queue = bypassQueue
    ? { serializeIntercedeClaim: (_id, callback) => callback() }
    : loadTypeScriptWithMocks('server/utils/intercedeClaims.ts', {})
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/intercede-claim.post.ts', {
    '../../../../db': dbExports,
    'drizzle-orm': {
      eq: (_column, value) => ({ value }), inArray: (_column, values) => ({ values }),
    },
    '~/server/utils/intercedeClaims': queue,
    '../../../../utils/intercedeClaims': queue,
    '~/server/utils/resolveAreaIntercedeGroup': {
      ...areaModule,
      resolveAreaIntercedeGroup: async params => {
        areaResolutions.push(copy(params.groupState.data.claims))
        return areaModule.resolveAreaIntercedeGroup(params)
      },
    },
    '~/server/utils/computeAttackDamage': { computeAttackDamage: async params => {
      await control.compute(params)
      return {
        attackBaseDamage: 2, armorPiercing: 0, targetArmor: 0, outsideClashArmorBonus: 0,
        effectiveArmor: 0, damageDealt: support ? 0 : 2, netSuccesses: 2,
        attackDef: { id: 'attack', effect: support ? 'Weaken' : undefined },
        appliedEffectName: support ? 'Weaken' : null,
        effectData: support ? { name: 'Weaken', type: 'debuff', duration: 2, source: 'attacker', potency: 1 } : null,
        reflectDamageToAttacker: 0, targetHasCombatMonster: false,
      }
    } },
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    '~/server/utils/encounterRoom': {
      getRoomPositions: async encounterId => {
        positionReads.push({ encounterId, positions: copy(rooms.get(encounterId).participantPositions) })
        return copy(rooms.get(encounterId).participantPositions)
      },
      getRoomSnapshot: async encounterId => copy(rooms.get(encounterId)),
      broadcastPositionPatch: async (encounterId, patch) => {
        assert.equal(owners.has(encounterId), false, 'positions must not broadcast before commit')
        await control.broadcast(encounterId, patch)
        Object.assign(rooms.get(encounterId).participantPositions, copy(patch))
        effects.push({ type: 'positions', encounterId, patch: copy(patch) })
      },
    },
    '~/server/utils/guidingLight': guidingLight,
    '~/server/utils/combatSpatial': {
      loadEncounterMap: async () => ({ id: 'map' }),
      getMovementProfile: () => ({ caps: {}, budget: 10, bodyStat: 10 }),
      getFallerProfile: async () => ({}),
    },
    '~/server/utils/mapMovement': {
      getFootprintDimsForParticipant: () => ({ width: 1, height: 1, depth: 1 }),
      getFootprintDimensions: () => ({ width: 1, height: 1, depth: 1 }),
      buildFootprintOccupiedSet: () => new Set(),
      findAreaIntercedePosition: target => ({ ...target, x: target.x + 1 }),
      findThrowLandingCell: (_target, landing) => landing,
      findRangedIntercedPosition: () => point(7),
      isPositionInAir: () => false,
    },
    '~/utils/areaShapes': { computeAreaCellsFromData: () => [point(0), point(1)] },
    '~/utils/movementRules': { resolveFall: () => ({ damage: 0 }) },
    '~/server/utils/damageOverTime': {
      movesFromPositions: () => [],
      applyMovementBurn: participants => ({ participants, logEntries: [] }),
    },
    '~/server/utils/enemyKnockouts': knockoutMocks,
  }).default
  return {
    rows, rooms, writes, commits, rollbacks, starts, effects, positionReads, areaResolutions, control,
    state: (encounterId = 'encounter') => rows.encounters.get(encounterId),
    claim(interceptor = 'guard-a', { encounterId = 'encounter', target = 'target', ...body } = {}) {
      return handler({ encounterId, body: {
        requestId: interceptor === 'guard-a' ? 'offer-a' : 'offer-b',
        interceptorParticipantId: interceptor,
        ...(area ? { chosenTargetId: target, throwAllyLandingPos: point(target === 'target' ? 10 : 20) } : {}),
        ...body,
      } })
    },
  }
}

function participant(fixture, id) {
  return fixture.state().participants.find(p => p.id === id)
}

for (const area of [false, true]) {
  for (const support of [false, true]) {
    test(`simultaneous ${area ? 'area' : 'single-target'} ${support ? 'support' : 'damage'} claims accept one interceptor and reject retries without charging them`, async () => {
      const subject = fixture({ area, support })
      const results = await Promise.allSettled([subject.claim('guard-a'), subject.claim('guard-b')])
      assert.equal(results[0].status, 'fulfilled')
      assert.equal(results[1].status, 'rejected')
      assert.equal(results[1].reason.statusCode, 409)
      assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
      assert.equal(participant(subject, 'guard-b').actionsRemaining.simple, 2)
      assert.equal(subject.commits.filter(commit => commit.writes > 0).length, 1)
      if (area) {
        const group = subject.state().pendingRequests.find(request => request.type === 'intercede-group-state')
        assert.deepEqual(group.data.claims.map(claim => [claim.interceptorParticipantId, claim.targetId]), [['guard-a', 'target']])
      } else {
        assert.equal(subject.state().battleLog.filter(log => log.effects?.includes('Intercede')).length, 1)
        assert.equal(participant(subject, 'guard-a').currentWounds, support ? 0 : 2)
      }
      await assert.rejects(subject.claim('guard-a'), error => error.statusCode === 409)
      assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
      assert.equal(subject.commits.filter(commit => commit.writes > 0).length, 1)
    })
  }
}

test('a failed first claimant rolls back and allows the queued claimant to win', async () => {
  const subject = fixture()
  subject.control.failEncounterWrites = 1
  const results = await Promise.allSettled([subject.claim('guard-a'), subject.claim('guard-b')])
  assert.equal(results[0].status, 'rejected')
  assert.match(results[0].reason.message, /simulated encounter write failure/)
  assert.equal(results[1].status, 'fulfilled')
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 2)
  assert.equal(participant(subject, 'guard-a').currentWounds, 0)
  assert.equal(participant(subject, 'guard-b').actionsRemaining.simple, 1)
  assert.equal(participant(subject, 'guard-b').currentWounds, 2)
  assert.equal(subject.rollbacks.length, 1)
  assert.equal(subject.state().battleLog.length, 1)
})

test('database row locks enforce first-claim exclusivity even when separate workers bypass the process queue', async () => {
  const subject = fixture({ bypassQueue: true })
  const computing = deferred()
  const release = deferred()
  subject.control.compute = async params => {
    if (params.targetParticipant.id === 'guard-a') {
      computing.resolve()
      await release.promise
    }
  }
  const first = subject.claim('guard-a')
  await computing.promise
  const second = subject.claim('guard-b')
  await Promise.resolve()
  assert.equal(subject.starts.length, 2, 'both workers must have entered their transaction')
  release.resolve()
  const results = await Promise.allSettled([first, second])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.statusCode, 409)
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
  assert.equal(participant(subject, 'guard-b').actionsRemaining.simple, 2)
  assert.equal(subject.commits.filter(commit => commit.writes > 0).length, 1)
})

test('an interceptor cannot claim two different targets from the same area attack', async () => {
  const subject = fixture({ area: true })
  const results = await Promise.allSettled([
    subject.claim('guard-a', { target: 'target' }),
    subject.claim('guard-a', { target: 'other-target' }),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.statusCode, 409)
  assert.equal(results[1].reason.message, 'This character has already interceded for this area attack. Choose a different character.')
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
  const group = subject.state().pendingRequests.find(request => request.type === 'intercede-group-state')
  assert.deepEqual(group.data.claims.map(claim => claim.targetId), ['target'])
  assert.equal(subject.areaResolutions.length, 0)
})

test('different area targets preserve both claims and see position changes only after the preceding commit', async () => {
  const subject = fixture({ area: true, map: true })
  const broadcasting = deferred()
  const releaseBroadcast = deferred()
  let firstBroadcast = true
  subject.control.broadcast = async () => {
    if (firstBroadcast) {
      firstBroadcast = false
      broadcasting.resolve()
      await releaseBroadcast.promise
    }
  }
  const first = subject.claim('guard-a', { target: 'target' })
  const second = subject.claim('guard-b', { target: 'other-target' })
  await broadcasting.promise
  assert.equal(subject.starts.length, 1, 'the encounter queue must include post-commit side effects')
  releaseBroadcast.resolve()
  await Promise.all([first, second])
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
  assert.equal(participant(subject, 'guard-b').actionsRemaining.simple, 1)
  assert.equal(subject.areaResolutions.length, 1)
  assert.deepEqual(subject.areaResolutions[0].map(claim => [claim.interceptorParticipantId, claim.targetId]), [
    ['guard-a', 'target'], ['guard-b', 'other-target'],
  ])
  assert.equal(subject.state().pendingRequests.length, 0)
  assert.deepEqual(subject.rooms.get('encounter').participantPositions.target, point(10))
  assert.deepEqual(subject.rooms.get('encounter').participantPositions['other-target'], point(20))
  assert.deepEqual(subject.positionReads[1].positions.target, point(10))
  assert.equal(subject.effects.filter(effect => effect.type === 'positions').length, 2)
})

test('claims in different encounters proceed independently', async () => {
  const subject = fixture({ encounterIds: ['first', 'second'] })
  const entered = deferred()
  const release = deferred()
  subject.control.compute = async params => {
    if (params.targetParticipant.id === 'guard-a') {
      entered.resolve()
      await release.promise
    }
  }
  const first = subject.claim('guard-a', { encounterId: 'first' })
  await entered.promise
  await subject.claim('guard-b', { encounterId: 'second' })
  assert.equal(subject.state('second').participants.find(p => p.id === 'guard-b').actionsRemaining.simple, 1)
  assert.equal(subject.state('first').participants.find(p => p.id === 'guard-a').actionsRemaining.simple, 2)
  release.resolve()
  await first
})

test('a rolled-back area auto-devolution preserves the evolution stage, offer, actions and room positions', async () => {
  const subject = fixture({ area: true, map: true, targets: ['target'] })
  const guard = participant(subject, 'guard-a')
  guard.maxWounds = 1
  guard.evolutionLineId = 'evolution'
  guard.woundsHistory = [{ entityId: 'previous-form', maxWounds: 10, wounds: 0, stageIndex: 1 }]
  subject.rows.evolutionLines.set('evolution', { id: 'evolution', currentStageIndex: 3 })
  const originalState = copy(subject.state())
  const originalRoom = copy(subject.rooms.get('encounter'))
  subject.control.failEncounterWrites = 1
  await assert.rejects(subject.claim('guard-a'), /simulated encounter write failure/)
  assert.ok(subject.writes.some(write => write.table === 'evolutionLines'), 'exercise the nested stage write before rollback')
  assert.deepEqual(subject.state(), originalState)
  assert.deepEqual(subject.rooms.get('encounter'), originalRoom)
  assert.equal(subject.rows.evolutionLines.get('evolution').currentStageIndex, 3)
  assert.equal(subject.effects.length, 0)

  await subject.claim('guard-a')
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
  assert.equal(participant(subject, 'guard-a').entityId, 'previous-form')
  assert.equal(subject.rows.evolutionLines.get('evolution').currentStageIndex, 1)
  await assert.rejects(subject.claim('guard-a'), error => error.statusCode === 409)
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
})

test('knockout gravity patches survive a successful retry and never reach the room when persistence rolls back', async () => {
  const subject = fixture({ area: true, map: true })
  const fallPosition = { x: 4, y: -1, z: 0 }
  subject.control.knockout = (state, context) => {
    assert.equal(context.gravity.map.id, 'map')
    assert.deepEqual(context.gravity.positions.target, point(10), 'gravity uses the current claim positions')
    return { ...state, changed: true, logEntries: [], positionPatch: { 'guard-b': fallPosition } }
  }
  const originalRoom = copy(subject.rooms.get('encounter'))
  const originalState = copy(subject.state())
  subject.control.failEncounterWrites = 1
  await assert.rejects(subject.claim('guard-a'), /simulated encounter write failure/)
  assert.deepEqual(subject.rooms.get('encounter'), originalRoom)
  assert.deepEqual(subject.state(), originalState)
  assert.equal(subject.effects.length, 0)

  const result = await subject.claim('guard-a')
  const broadcasts = subject.effects.filter(effect => effect.type === 'positions')
  assert.equal(broadcasts.length, 1)
  assert.deepEqual(broadcasts[0].patch['guard-b'], fallPosition)
  assert.deepEqual(broadcasts[0].patch.target, point(10), 'the gravity patch merges with the claim throw')
  assert.deepEqual(result.participantPositions['guard-b'], fallPosition)
  assert.deepEqual(subject.rooms.get('encounter').participantPositions['guard-b'], fallPosition)
  assert.equal(participant(subject, 'guard-a').actionsRemaining.simple, 1)
})
