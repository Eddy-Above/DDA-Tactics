import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError', '$fetch']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => structuredClone(value)
const unexpected = () => { throw new Error('unexpected combat side effect') }
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function gate() {
  const entered = deferred()
  const release = deferred()
  return { entered: entered.promise, release: release.resolve, wait: async () => {
    entered.resolve()
    await release.promise
  } }
}

function fixture({ area = false, unlockStrikeLast = true, counterattack = false } = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = (event, key) => key === 'id' ? 'encounter' : event.requestId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'maps']
    .map(name => [name, { name, id: name }]))
  const unit = (id, type = 'digimon', extra = {}) => ({
    id, entityId: id, type, actionsRemaining: { simple: 2 }, activeEffects: [],
    currentWounds: 0, maxWounds: 10, ...extra,
  })
  let stored = {
    id: 'encounter', campaignId: 'campaign', phase: 'combat', round: 2,
    participants: [unit('attacker', 'digimon', { isEnemy: true }), unit('target'),
      unit('owner', 'tamer', { actionsRemaining: { simple: 0 } })],
    turnOrder: ['attacker', 'owner'], currentTurnIndex: 0,
    battleLog: [], pendingRequests: [{ id: 'existing', type: 'dodge-roll', targetTamerId: 'owner', answeredAt: 'then', data: {} }],
    requestResponses: [{ id: 'response-existing', requestId: 'existing' }],
    intercedeOptOuts: { targets: { GM: ['target'] } },
  }
  const attributes = Object.fromEntries(['agility', 'body', 'charisma', 'intelligence', 'willpower']
    .map(name => [name, unlockStrikeLast ? 5 : 0]))
  const rows = {
    campaigns: { campaign: { id: 'campaign', level: 'standard', rulesSettings: {} } },
    digimon: {
      attacker: { id: 'attacker', name: 'Attacker', isEnemy: true, qualities: [],
        attacks: [{ id: 'attack', name: 'Attack', type: 'damage', range: 'ranged', tags: [] }] },
      target: { id: 'target', name: 'Target', partnerId: 'owner',
        qualities: counterattack ? [{ id: 'counterattack' }] : [] },
    },
    tamers: { owner: { id: 'owner', name: 'Owner', attributes, xpBonuses: null, usedPerDayOrders: [] } },
  }
  const control = { campaignGate: null, writeGate: null, counterattackGate: null }
  const encounterReads = []
  const writes = []
  const db = {
    select: () => ({ from: table => ({ where: async filter => {
      if (table === tables.encounters) {
        encounterReads.push(copy(stored.pendingRequests))
        return [copy(stored)]
      }
      if (table === tables.campaigns && control.campaignGate) {
        const paused = control.campaignGate
        control.campaignGate = null
        await paused.wait()
      }
      return (filter.values ?? [filter.value]).flatMap(id => rows[table.name]?.[id] ? [copy(rows[table.name][id])] : [])
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      assert.equal(table, tables.encounters)
      if (control.writeGate) {
        const paused = control.writeGate
        control.writeGate = null
        await paused.wait()
      }
      writes.push(copy(fields))
      stored = { ...stored, ...copy(fields) }
    } }) }),
  }
  const database = { db, ...tables }
  const orm = { eq: (_column, value) => ({ value }), inArray: (_column, values) => ({ values }) }
  const queue = loadTrustedGameplayModule('server/utils/intercedeClaims.ts', {})
  const counterattacks = []
  const attack = loadTrustedGameplayModule('server/api/encounters/[id]/actions/attack.post.ts', {
    '../../../../db': database,
    'drizzle-orm': orm,
    '../../../../utils/intercedeClaims': queue,
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    '../../../../utils/encounterRoom': { getRoomPositions: unexpected },
    '../../../../utils/triggerCounterattack': { triggerCounterattack: async params => {
      counterattacks.push(copy(params))
      if (control.counterattackGate) await control.counterattackGate.wait()
      return { ...params, pendingRequests: [...params.pendingRequests, { id: 'counter', type: 'counterattack-prompt' }] }
    } },
  }).default
  const createRequest = loadTrustedGameplayModule('server/api/encounters/[id]/requests.post.ts', {
    '../../../db': database,
    'drizzle-orm': orm,
    '../../../utils/intercedeClaims': queue,
  }).default
  const deleteRequest = loadTrustedGameplayModule('server/api/encounters/[id]/requests/[requestId].delete.ts', {
    '../../../../db': database,
    'drizzle-orm': orm,
    '../../../../utils/intercedeClaims': queue,
  }).default
  const intercede = loadTrustedGameplayModule('server/api/encounters/[id]/actions/intercede-offer.post.ts', {
    '../../../../db': database,
    'drizzle-orm': orm,
    '~/server/utils/intercedeClaims': queue,
    '~/server/utils/resolveNpcAttack': { resolveNpcAttack: unexpected },
    '~/server/utils/resolveSupportAttack': {
      resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected, resolveNegativeSupportNpc: unexpected,
      getPositiveSupportResolutionType: () => null,
    },
    '~/server/utils/triggerCounterattack': { triggerCounterattack: unexpected },
    '~/server/utils/encounterRoom': { getRoomPositions: async () => ({}), broadcastPositionPatch: unexpected },
    '~/server/utils/guidingLight': { applyGuidingLightAuras: participants => participants },
    '~/server/utils/combatSpatial': { loadEncounterMap: unexpected, getMovementProfile: unexpected },
    '~/server/utils/pushPull': { resolveInstantSupportEffect: unexpected },
    '~/server/utils/intercedePasses': { passableOfferOwners: () => [], applyActivePasses: unexpected },
  }).default
  const delegations = []
  globalThis.$fetch = async (url, options) => {
    assert.equal(url, '/api/encounters/encounter/actions/intercede-offer')
    assert.equal(options.method, 'POST')
    delegations.push(copy(options.body))
    return intercede({ body: options.body })
  }
  const body = {
    participantId: 'attacker', attackId: 'attack', tamerId: 'owner', attackName: 'Attack',
    accuracyDicePool: 2, accuracySuccesses: 0, accuracyDiceResults: [1, 2],
    ...(area ? { targetIds: ['target'] } : { targetId: 'target' }),
  }
  return {
    control, encounterReads, writes, counterattacks, delegations,
    get stored() { return copy(stored) },
    attack: extra => attack({ body: { ...body, ...extra } }),
    create: () => createRequest({ body: { type: 'dodge-roll', targetTamerId: 'owner', targetParticipantId: 'target', data: { later: true } } }),
    remove: () => deleteRequest({ requestId: 'existing' }),
  }
}

for (const area of [false, true]) {
  for (const operation of ['create', 'remove']) {
    for (const earlier of ['attack', 'request']) {
      test(`${area ? 'area' : 'single-target'} miss preserves a concurrent ${operation}, ${earlier} queued first`, async () => {
        const f = fixture({ area })
        const paused = gate()
        if (earlier === 'attack') f.control.campaignGate = paused
        else f.control.writeGate = paused
        const first = earlier === 'attack' ? f.attack() : f[operation]()
        await paused.entered
        const readsBefore = f.encounterReads.length
        const second = earlier === 'attack' ? f[operation]() : f.attack()
        await nextTurn()
        const readsWhilePaused = f.encounterReads.length
        paused.release()
        await Promise.all([first, second])

        assert.equal(readsWhilePaused, readsBefore, 'the later handler must wait before reading its encounter snapshot')
        const pending = f.stored.pendingRequests
        assert.equal(pending.some(r => r.id === 'existing'), operation === 'create')
        assert.equal(pending.filter(r => r.data?.later).length, operation === 'create' ? 1 : 0)
        assert.equal(pending.filter(r => r.type === 'strike-last-offer').length, 1)
        assert.equal(f.stored.participants[0].actionsRemaining.simple, 1, 'the attack is paid once')
        assert.deepEqual(f.stored.requestResponses, [{ id: 'response-existing', requestId: 'existing' }])
        assert.deepEqual(f.stored.battleLog.map(entry => entry.action), ['Attack', 'Attack Result'])
      })
    }
  }
}

test('single-target automatic-miss counterattack writes stay in the decision queue', async () => {
  const f = fixture({ counterattack: true })
  const paused = gate()
  f.control.counterattackGate = paused
  const attack = f.attack()
  await paused.entered
  const added = f.create()
  await nextTurn()
  paused.release()
  await Promise.all([attack, added])
  assert.equal(f.counterattacks.length, 1)
  assert.equal(f.stored.pendingRequests.filter(r => r.id === 'counter').length, 1)
  assert.equal(f.stored.pendingRequests.filter(r => r.data?.later).length, 1)
  assert.equal(f.stored.pendingRequests.filter(r => r.type === 'strike-last-offer').length, 1)
})

for (const area of [false, true]) {
  test(`${area ? 'area' : 'single-target'} hit delegates to the real queued intercede handler without deadlock`, { timeout: 3000 }, async () => {
    const f = fixture({ area, unlockStrikeLast: false })
    const result = await f.attack({ accuracySuccesses: 1, accuracyDiceResults: [6, 2] })
    assert.equal(f.delegations.length, 1)
    assert.equal(f.delegations[0].skipActionDeduction, true)
    assert.equal(result.participants[0].actionsRemaining.simple, 1, 'delegation does not deduct the action again')
    assert.deepEqual(result.participants[0].usedAttackIds, ['attack'])
    assert.equal(result.battleLog.filter(entry => entry.action === 'Attack').length, 1)
    assert.equal(result.pendingRequests.filter(r => r.id === 'existing').length, 1)
    assert.equal(result.pendingRequests.filter(r => r.type === 'dodge-roll').length, 2)
  })
}
