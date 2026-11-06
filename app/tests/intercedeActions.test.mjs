import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['ref', '$fetch', 'defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

function unit(id, overrides = {}) {
  return {
    id, entityId: id, type: 'digimon', initiative: 10,
    actionsRemaining: { simple: 2 }, activeEffects: [], currentWounds: 0, maxWounds: 5,
    ...overrides,
  }
}

function encounter(participants, turnOrder = participants.map(p => p.id), currentTurnIndex = 0) {
  return {
    id: 'encounter', phase: 'combat', participants, turnOrder, currentTurnIndex, round: 1,
    battleLog: [], pendingRequests: [],
  }
}

async function client(state) {
  let stored = structuredClone(state)
  globalThis.ref = value => ({ value })
  globalThis.$fetch = async (_url, options) => {
    if (options?.method === 'PUT') stored = { ...stored, ...structuredClone(options.body) }
    return structuredClone(stored)
  }
  const { useEncounters } = loadTypeScriptWithMocks('composables/useEncounters.ts', {})
  const api = useEncounters()
  await api.fetchEncounter('encounter')
  return api
}

const unexpected = () => { throw new Error('unexpected combat side effect') }
const unchanged = async ({ participants }) => ({ participants, logEntries: [] })
const identity = async participants => participants

function knockoutResolver(rows = []) {
  return loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    '../db': { db: { select: unexpected }, digimon: {}, encounters: {}, campaigns: {} },
    './resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    './combatSpatial': { loadParticipantDigimon: async () => new Map(rows.map(row => [row.id, row])) },
    './endOfTurnGravity': { applyEndOfTurnGravity: unexpected, computeGravityDrops: unexpected },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: identity },
    './damageOverTime': { applyRoundEndEffects: unchanged, loadRoundEndContext: async () => ({}) },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  }).resolveEnemyKnockouts
}

function legacyNpcAttack(state, rows = []) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async event => event
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'campaigns', 'digimon', 'tamers', 'evolutionLines']
    .map(name => [name, { name, id: name }]))
  let stored = structuredClone(state)
  const records = new Map(rows.map(row => [row.id, row]))
  const db = {
    select: () => ({ from: table => ({ where: async ({ value }) => {
      if (table === tables.encounters) return [structuredClone(stored)]
      if (table === tables.digimon) return records.has(value) ? [records.get(value)] : []
      throw new Error(`Unexpected read from ${table.name}`)
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      assert.equal(table, tables.encounters)
      stored = { ...stored, ...structuredClone(fields) }
    } }) }),
  }
  return loadTypeScriptWithMocks('server/api/encounters/[id]/actions/npc-attack.post.ts', {
    '../../../../db': { db, ...tables },
    'drizzle-orm': { eq: (_column, value) => ({ value }) },
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

for (const type of ['tamer', 'digimon']) {
  for (const wrap of [false, true]) {
    test(`client turn start repays ${type} debt once${wrap ? ' after a round reset' : ''}`, async () => {
      const next = unit('next', { type, interceptPenalty: 1, actionsRemaining: { simple: wrap ? 0 : 2 } })
      const other = unit('other', { interceptPenalty: 2 })
      const participants = wrap ? [next, other] : [other, next]
      const api = await client(encounter(participants, participants.map(p => p.id), wrap ? 1 : 0))

      const result = await api.nextTurn('encounter')
      const paid = result.participants.find(p => p.id === 'next')
      assert.equal(paid.actionsRemaining.simple, 1)
      assert.equal(paid.interceptPenalty, 0)
      assert.equal(result.participants.find(p => p.id === 'other').interceptPenalty, 2)
      assert.equal(result.round, wrap ? 2 : 1)

      await api.nextTurn('encounter')
      const followingCycle = await api.nextTurn('encounter')
      const refreshed = followingCycle.participants.find(p => p.id === 'next')
      assert.equal(refreshed.actionsRemaining.simple, 2, 'old debt must not be charged again')
      assert.equal(refreshed.interceptPenalty, 0)
    })

    test(`server knockout turn start repays ${type} debt${wrap ? ' after a round reset' : ''}`, async () => {
      const next = unit('next', { type, interceptPenalty: 1, actionsRemaining: { simple: wrap ? 0 : 2 } })
      const dead = unit('dead', { isEnemy: true, currentWounds: 5 })
      const other = unit('other', { interceptPenalty: 2 })
      const participants = wrap ? [next, other, dead] : [dead, next, other]
      const result = await knockoutResolver()(encounter(participants, participants.map(p => p.id), wrap ? 2 : 0), ['dead'])
      const paid = result.participants.find(p => p.id === 'next')

      assert.equal(paid.actionsRemaining.simple, 1)
      assert.equal(paid.interceptPenalty, 0)
      assert.equal(result.participants.find(p => p.id === 'other').interceptPenalty, 2)
      assert.equal(result.turnOrder[result.currentTurnIndex], 'next')
      assert.equal(result.round, wrap ? 2 : 1)
    })

    test(`legacy NPC knockout turn start repays ${type} debt${wrap ? ' after a round reset' : ''}`, async () => {
      const next = unit('next', { type, interceptPenalty: 1, actionsRemaining: { simple: wrap ? 0 : 2 } })
      const dead = unit('dead', { isEnemy: true })
      const participants = wrap ? [next, dead] : [dead, next]
      const attack = legacyNpcAttack(encounter(participants, participants.map(p => p.id), wrap ? 1 : 0), [{
        id: 'dead', name: 'Enemy', baseStats: { damage: 5, armor: 0 }, qualities: [],
        attacks: [{ id: 'attack', type: 'damage', tags: [] }],
      }])
      // Self-targeting exercises the legacy endpoint's own active-NPC removal branch.
      const result = await attack({
        participantId: 'dead', targetId: 'dead', attackId: 'attack',
        accuracyDicePool: 1, accuracySuccesses: 1, accuracyDiceResults: [6],
        dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [],
      })

      assert.deepEqual(result.participants.map(p => p.id), ['next'])
      assert.equal(result.participants[0].actionsRemaining.simple, 1)
      assert.equal(result.participants[0].interceptPenalty, 0)
      assert.equal(result.turnOrder[result.currentTurnIndex], 'next')
      assert.equal(result.round, wrap ? 2 : 1)
    })
  }

  test(`removing the active participant repays the next ${type}'s debt`, async () => {
    const api = await client(encounter([
      unit('active', { isActive: true, initiative: 20 }),
      unit('next', { type, interceptPenalty: 2 }),
    ]))
    const result = await api.removeParticipant('encounter', 'active')
    assert.equal(result.participants[0].actionsRemaining.simple, 0)
    assert.equal(result.participants[0].interceptPenalty, 0)
    assert.equal(result.turnOrder[result.currentTurnIndex], 'next')
  })
}

for (const path of ['client', 'knockout']) {
  test(`${path} repays both Tamer and grouped partner without spending other participants' debt`, async () => {
    const participants = [
      unit('active', { isEnemy: true, currentWounds: 5 }),
      unit('tamer', { type: 'tamer', interceptPenalty: 1, pendingSimpleActionPenalty: 1 }),
      unit('partner', { interceptPenalty: 1, hasActed: true, dodgePenalty: 2 }),
      unit('other', { interceptPenalty: 2 }),
    ]
    const state = encounter(participants, ['active', 'tamer', 'other'])
    const records = [{ id: 'partner', partnerId: 'tamer' }]
    const result = path === 'client'
      ? await (await client(state)).nextTurn('encounter', new Map(records.map(row => [row.id, row])))
      : await knockoutResolver(records)(state, ['active'])
    const tamer = result.participants.find(p => p.id === 'tamer')
    const partner = result.participants.find(p => p.id === 'partner')

    assert.equal(tamer.actionsRemaining.simple, 0)
    assert.equal(tamer.interceptPenalty, 0)
    assert.equal(tamer.pendingSimpleActionPenalty, 0)
    assert.equal(partner.actionsRemaining.simple, 1)
    assert.equal(partner.interceptPenalty, 0)
    assert.equal(partner.hasActed, false)
    assert.equal(partner.dodgePenalty, 0)
    assert.equal(result.participants.find(p => p.id === 'other').interceptPenalty, 2)
  })

  for (const effect of ['Stun', 'Haste']) {
    test(`${path} repays debt after a round reset with ${effect}`, async () => {
      const next = unit('next', {
        type: 'tamer', interceptPenalty: 1, actionsRemaining: { simple: 1 },
        activeEffects: [{ name: effect, duration: 2, potency: 1 }],
      })
      const dead = unit('active', { isEnemy: true, currentWounds: 5 })
      const state = encounter([next, dead], ['next', 'active'], 1)
      const result = path === 'client'
        ? await (await client(state)).nextTurn('encounter')
        : await knockoutResolver()(state, ['active'])
      const paid = result.participants.find(p => p.id === 'next')
      assert.equal(paid.actionsRemaining.simple, effect === 'Stun' ? 0 : 2)
      assert.equal(paid.interceptPenalty, 0)
    })
  }
}

test('debt exceeding available actions clears even when combined with another action penalty', async () => {
  const api = await client(encounter([
    unit('active'), unit('next', { interceptPenalty: 2, actionsRemaining: { simple: 1 }, pendingSimpleActionPenalty: 1 }),
  ]))
  const result = await api.nextTurn('encounter')
  assert.equal(result.participants[1].actionsRemaining.simple, 0)
  assert.equal(result.participants[1].interceptPenalty, 0)
  assert.equal(result.participants[1].pendingSimpleActionPenalty, 0)
})

test('missing action state defaults to two actions before repaying debt', async () => {
  const api = await client(encounter([unit('active'), unit('next', { interceptPenalty: 1, actionsRemaining: undefined })]))
  const result = await api.nextTurn('encounter')
  assert.equal(result.participants[1].actionsRemaining.simple, 1)
  assert.equal(result.participants[1].interceptPenalty, 0)
})

test('removing an unrelated participant does not repay debt or change the active turn', async () => {
  const api = await client(encounter([
    unit('active', { isActive: true, initiative: 30 }),
    unit('next', { interceptPenalty: 1, initiative: 20 }), unit('removed'),
  ]))
  const result = await api.removeParticipant('encounter', 'removed')
  const next = result.participants.find(p => p.id === 'next')
  assert.equal(next.actionsRemaining.simple, 2)
  assert.equal(next.interceptPenalty, 1)
  assert.equal(result.turnOrder[result.currentTurnIndex], 'active')
})
