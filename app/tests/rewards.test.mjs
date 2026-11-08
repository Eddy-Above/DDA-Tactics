import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const { normalizeRewardRequest } = loadTypeScript('utils/rewards.ts')
const { useRewardGrant } = loadTypeScript('composables/useRewardGrant.ts')
const { serializeIntercedeClaim } = loadTypeScript('server/utils/intercedeClaims.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const request = (overrides = {}) => ({ requestId: 'grant-1', tamerIds: ['tai', 'matt'], digimonIds: ['agu', 'gabu'], tamerXp: 10, tamerInspiration: 2, digimonBonusDP: 3, ...overrides })

function fixture() {
  let state = {
    tamers: [
      { id: 'tai', campaignId: 'campaign', name: 'Tai', xp: 3, totalXp: 10, inspiration: 1, grantedInspiration: 0, xpBonuses: { inspiration: 0 }, spriteUrl: null },
      { id: 'matt', campaignId: 'campaign', name: 'Matt', xp: 5, totalXp: null, inspiration: 1, grantedInspiration: 1, xpBonuses: { inspiration: 0 }, spriteUrl: null },
      { id: 'other', campaignId: 'other-campaign', name: 'Other', xp: 0, totalXp: 0 },
    ],
    digimon: [
      { id: 'agu', campaignId: 'campaign', partnerId: 'tai', name: 'Agumon', stage: 'rookie', bonusDP: 1, isEnemy: false, spriteUrl: null, evolutionPathIds: ['greymon'] },
      { id: 'greymon', campaignId: 'campaign', partnerId: 'tai', name: 'Greymon', stage: 'champion', bonusDP: 1, isEnemy: false, spriteUrl: null, evolvesFromId: 'agu' },
      { id: 'gabu', campaignId: 'campaign', partnerId: 'matt', name: 'Gabumon', stage: 'rookie', bonusDP: 4, isEnemy: false, spriteUrl: null },
      { id: 'enemy', campaignId: 'campaign', partnerId: 'tai', name: 'Enemy', bonusDP: 0, isEnemy: true },
      { id: 'foreign', campaignId: 'other-campaign', partnerId: 'other', name: 'Foreign', bonusDP: 0, isEnemy: false },
    ],
    evolutionLines: [], encounters: [{ id: 'fight', campaignId: 'campaign', phase: 'combat', participants: [
      { id: 'tai-token', type: 'tamer', entityId: 'tai', currentInspiration: 0, actionsRemaining: { simple: 1 } },
      { id: 'matt-token', type: 'tamer', entityId: 'matt', actionsRemaining: { simple: 2 } },
    ] }], rewardGrants: [],
  }
  const tables = Object.fromEntries(Object.keys(state).map(name => [name, Object.fromEntries([
    ['name', name], ...['id', 'campaignId', 'partnerId', 'phase', 'xp', 'totalXp', 'grantedInspiration', 'bonusDP', 'participants'].map(key => [key, { name: key }]),
  ])]))
  const eq = (column, value) => ({ type: 'eq', column: column.name, value })
  const inArray = (column, value) => ({ type: 'in', column: column.name, value })
  const and = (...conditions) => ({ type: 'and', conditions })
  const matches = (row, condition) => !condition || (condition.type === 'and' ? condition.conditions.every(c => matches(row, c))
    : condition.type === 'eq' ? row[condition.column] === condition.value : condition.value.includes(row[condition.column]))
  const taggedSql = (strings, ...values) => ({ expression: strings.join('').includes('CASE') ? 'nullable-add' : 'add', column: values[0].name, amount: values.at(-1) })
  let failTable = null, reads = 0
  const broadcasts = []
  function client(readState) {
    return {
      select(projection) {
        let table, condition
        const query = { from(value) { table = value; return query }, where(value) { condition = value; return query },
          orderBy() { return query }, for() { return query },
          then(resolve, reject) {
            reads++
            try {
              const rows = readState()[table.name].filter(row => matches(row, condition)).map(row => projection
                ? Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, structuredClone(row[column.name])])) : structuredClone(row))
              return Promise.resolve(rows).then(resolve, reject)
            } catch (e) { return Promise.reject(e).then(resolve, reject) }
          } }
        return query
      },
      insert(table) { return { values(row) { return { onConflictDoNothing() { return { returning: async () => {
        if (readState()[table.name].some(prior => prior.id === row.id)) return []
        readState()[table.name].push(structuredClone(row)); return [row]
      } } } } } } },
      update(table) { return { set(patch) { return { where: async condition => {
        if (failTable === table.name) throw new Error('simulated write failure')
        for (const row of readState()[table.name].filter(row => matches(row, condition))) for (const [key, value] of Object.entries(patch)) {
          row[key] = value?.expression ? (value.expression === 'nullable-add' && row[value.column] == null ? null : row[value.column] + value.amount) : structuredClone(value)
        }
      } } } } },
    }
  }
  let priorTransaction = Promise.resolve()
  const db = { ...client(() => state), transaction(work) {
    const operation = priorTransaction.then(async () => {
      const copy = structuredClone(state)
      const result = await work(client(() => copy)); state = copy; return result
    })
    priorTransaction = operation.catch(() => {})
    return operation
  } }
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.campaignId ?? 'campaign'
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const mocks = { '../../../db': { db, ...tables }, 'drizzle-orm': { eq, inArray, and, sql: taggedSql },
    '../../../utils/campaignDm': { requireCampaignDm: async event => { if (event.denied) throw Object.assign(new Error('GM access required'), { statusCode: 403 }); return { userId: 'gm' } } },
    '../../../utils/intercedeClaims': { serializeIntercedeClaim },
    '../../../utils/encounterRoom': { broadcast: (...args) => {
      assert.ok(state.rewardGrants.some(grant => grant.id === args[1].requestId), 'publish only after this grant commits')
      broadcasts.push(args)
    } },
  }
  const post = loadTypeScriptWithMocks('server/api/campaigns/[id]/rewards.post.ts', mocks).default
  const get = loadTypeScriptWithMocks('server/api/campaigns/[id]/rewards.get.ts', mocks).default
  return { post: (body = request(), extra = {}) => post({ body, ...extra }), get: extra => get(extra ?? {}), broadcasts,
    get state() { return state }, get reads() { return reads }, fail: table => { failTable = table } }
}

test('the real rewards endpoint grants a group once, preserves unknown lifetime XP and syncs combat Inspiration after commit', async () => {
  const f = fixture()
  const result = await f.post(request({ tamerIds: ['tai', 'matt', 'tai'], digimonIds: ['agu', 'gabu', 'agu'] }))
  assert.equal(result.tamerCount, 2)
  assert.equal(result.digimonCount, 2)
  assert.deepEqual(result.untrackedTamerIds, ['matt'])
  assert.equal(f.state.tamers[0].xp, 13)
  assert.equal(f.state.tamers[0].totalXp, 20)
  assert.equal(f.state.tamers[1].xp, 15)
  assert.equal(f.state.tamers[1].totalXp, null)
  assert.equal(f.state.tamers[0].grantedInspiration, 2)
  assert.equal(f.state.encounters[0].participants[0].currentInspiration, 2)
  assert.equal(f.state.encounters[0].participants[1].currentInspiration, 4)
  assert.equal(f.state.encounters[0].participants[0].actionsRemaining.simple, 1)
  assert.equal(f.state.digimon.find(d => d.id === 'agu').bonusDP, 4)
  assert.equal(f.state.digimon.find(d => d.id === 'gabu').bonusDP, 7)
  assert.equal(f.state.digimon.find(d => d.id === 'greymon').bonusDP, 4, 'all stages share the selected partner’s reward')
  assert.deepEqual(result.affectedDigimonIds, ['agu', 'gabu', 'greymon'])
  assert.deepEqual(f.broadcasts[0][1].digimonIds, ['agu', 'gabu', 'greymon'], 'refresh every updated stage')
  assert.equal(f.state.tamers[2].xp, 0)
  assert.equal(f.state.rewardGrants.length, 1)
  assert.deepEqual(f.broadcasts.map(([room]) => room), ['campaign:campaign', 'fight'])
})

test('single-player XP-only awards leave other players, DP and Inspiration unchanged', async () => {
  const f = fixture()
  await f.post(request({ tamerIds: ['tai'], digimonIds: [], tamerInspiration: 0, digimonBonusDP: 0 }))
  assert.equal(f.state.tamers[0].xp, 13)
  assert.equal(f.state.tamers[1].xp, 5)
  assert.equal(f.state.encounters[0].participants[0].currentInspiration, 0)
  assert.equal(f.state.digimon[0].bonusDP, 1)
})

test('choosing a second partner updates all its stages without rewarding the Tamer’s other partner', async () => {
  const f = fixture()
  f.state.digimon.push(
    { id: 'pata', campaignId: 'campaign', partnerId: 'tai', name: 'Patamon', stage: 'rookie', bonusDP: 7, evolutionPathIds: ['ange'] },
    { id: 'ange', campaignId: 'campaign', partnerId: 'tai', name: 'Angemon', stage: 'champion', bonusDP: 7, evolvesFromId: 'pata' },
  )
  const roster = await f.get()
  assert.deepEqual(roster.digimon.filter(p => p.partnerId === 'tai').map(p => p.id).sort(), ['agu', 'pata'])
  const result = await f.post(request({ tamerIds: ['tai'], digimonIds: ['pata'], tamerXp: 0, tamerInspiration: 0 }))
  assert.equal(result.digimonCount, 1)
  assert.equal(f.state.digimon.find(d => d.id === 'pata').bonusDP, 10)
  assert.equal(f.state.digimon.find(d => d.id === 'ange').bonusDP, 10)
  assert.equal(f.state.digimon.find(d => d.id === 'agu').bonusDP, 1)
  assert.equal(f.state.digimon.find(d => d.id === 'greymon').bonusDP, 1)
})

test('line-only stages share one pool and duplicate stage selections cannot multiply a partner reward', async () => {
  const f = fixture()
  f.state.digimon[0].evolutionPathIds = []
  f.state.digimon[1].evolvesFromId = null
  f.state.digimon[1].bonusDP = 6
  f.state.evolutionLines.push({ id: 'agu-line', campaignId: 'campaign', partnerId: 'tai', name: 'Agu partner', chain: [
    { digimonId: 'agu', evolvesFromIndex: null }, { digimonId: 'greymon', evolvesFromIndex: 0 },
  ] })
  const roster = await f.get()
  assert.equal(roster.digimon.find(d => d.id === 'agu').name, 'Agu partner')
  assert.equal(roster.digimon.find(d => d.id === 'agu').bonusDP, 6)
  const body = request({ tamerIds: ['tai'], digimonIds: ['agu', 'greymon'], tamerXp: 0, tamerInspiration: 0 })
  const result = await f.post(body)
  assert.equal(result.digimonCount, 1)
  assert.equal(f.state.digimon[0].bonusDP, 9)
  assert.equal(f.state.digimon[1].bonusDP, 9)
  assert.deepEqual(f.state.rewardGrants[0].payload.partnerDigimonIds, ['agu'])
  f.state.digimon = []
  f.state.evolutionLines = []
  const replay = await f.post(body)
  assert.equal(replay.replayed, true)
  assert.equal(replay.digimonCount, 1, 'the receipt preserves the original partner count after records change')
  assert.deepEqual(replay.affectedDigimonIds, ['agu', 'greymon'])
  assert.equal(f.broadcasts.length, 2)
})

test('retries, duplicate IDs and concurrent identical requests cannot award twice; changed reuse is rejected', async () => {
  const f = fixture()
  const results = await Promise.all([f.post(), f.post()])
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true])
  assert.equal(f.state.tamers[0].xp, 13)
  assert.equal(f.broadcasts.length, 2)
  assert.equal((await f.post(request({ tamerIds: ['matt', 'tai'] }))).replayed, true)
  await assert.rejects(f.post(request({ tamerXp: 11 })), error => error.statusCode === 409)
  assert.equal(f.state.tamers[0].xp, 13)
})

for (const invalid of [request({ tamerXp: -1 }), request({ tamerInspiration: 1.5 }), request({ digimonBonusDP: NaN }),
  request({ tamerXp: 0, tamerInspiration: 0, digimonBonusDP: 0 }), request({ tamerIds: [] }), request({ digimonIds: [] }),
  request({ tamerIds: ['other'] }), request({ digimonIds: ['foreign'] }), request({ digimonIds: ['enemy'] }),
  request({ tamerIds: ['tai'], digimonIds: ['gabu'] })]) {
  test(`invalid reward recipients/amounts roll back completely: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture(), before = structuredClone(f.state)
    await assert.rejects(f.post(invalid), error => error.statusCode === 400)
    assert.deepEqual(f.state, before)
    assert.deepEqual(f.broadcasts, [])
  })
}

test('a failure midway through group updates rolls back players, forms, encounters and the retry receipt', async () => {
  const f = fixture(), before = structuredClone(f.state)
  f.fail('digimon')
  await assert.rejects(f.post(), /simulated write failure/)
  assert.deepEqual(f.state, before)
  assert.deepEqual(f.broadcasts, [])
  f.fail(null)
  await f.post()
  assert.equal(f.state.tamers[0].xp, 13)
})

test('rewards wait for an in-flight combat decision and preserve its current balance', async () => {
  const f = fixture()
  let release, started
  const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { started = resolve })
  const defense = serializeIntercedeClaim('fight', async () => { started(); await gate; f.state.encounters[0].participants[0].currentInspiration = 1 })
  await ready
  const grant = f.post()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(f.state.rewardGrants.length, 0)
  release()
  await Promise.all([defense, grant])
  assert.equal(f.state.encounters[0].participants[0].currentInspiration, 3)
})

test('a combat that ends while rewards wait is not rewritten, while the character still receives the reward', async () => {
  const f = fixture()
  let release, started
  const gate = new Promise(resolve => { release = resolve }), ready = new Promise(resolve => { started = resolve })
  const ending = serializeIntercedeClaim('fight', async () => { started(); await gate; f.state.encounters[0].phase = 'ended' })
  await ready
  const granting = f.post()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  release()
  await Promise.all([ending, granting])
  assert.equal(f.state.encounters[0].participants[0].currentInspiration, 0)
  assert.equal(f.state.tamers[0].grantedInspiration, 2)
})

test('the roster includes one recipient per campaign partner, and unauthorised callers cannot read or write it', async () => {
  const f = fixture()
  await assert.rejects(f.get({ denied: true }), error => error.statusCode === 403)
  await assert.rejects(f.post(request(), { denied: true }), error => error.statusCode === 403)
  assert.equal(f.reads, 0)
  const roster = await f.get()
  assert.deepEqual(roster.tamers.map(t => t.id).sort(), ['matt', 'tai'])
  assert.deepEqual(roster.digimon.map(d => d.id).sort(), ['agu', 'gabu'])
  assert.equal(roster.tamers.find(t => t.id === 'tai').inspiration, 1)
})

test('the real reward form selects individuals or the group and lets the GM choose between a Tamer’s partners', async () => {
  const f = fixture(), payloads = []
  f.state.digimon.push(
    { id: 'pata', campaignId: 'campaign', partnerId: 'tai', name: 'Patamon', stage: 'rookie', bonusDP: 2, evolutionPathIds: ['ange'] },
    { id: 'ange', campaignId: 'campaign', partnerId: 'tai', name: 'Angemon', stage: 'champion', bonusDP: 2, evolvesFromId: 'pata' },
  )
  const form = useRewardGrant({ load: () => f.get(), send: async body => { payloads.push(body); return f.post(body) }, newId: () => 'form-grant' })
  await form.load()
  form.toggleTamer('tai')
  assert.deepEqual(form.selectedDigimonIds.value.sort(), ['agu', 'pata'])
  form.toggleDigimon('pata')
  assert.deepEqual(form.selectedDigimonIds.value, ['agu'])
  form.toggleTamer('matt')
  assert.deepEqual(form.selectedDigimonIds.value.sort(), ['agu', 'gabu'])
  form.toggleTamer('tai')
  assert.deepEqual(form.selectedDigimonIds.value, ['gabu'])
  form.selectAll()
  assert.equal(form.selectedTamerIds.value.length, 2)
  assert.equal(form.selectedDigimonIds.value.length, 3)
  Object.assign(form.amounts, { tamerXp: 10, tamerInspiration: 2, digimonBonusDP: 3 })
  assert.equal(form.validationMessage.value, null)
  assert.equal(await form.grant(), true)
  assert.equal(payloads.length, 1)
  assert.equal(form.success.value.digimonCount, 3)
  assert.equal(form.amounts.tamerXp, 0)
})

test('the reward form blocks double submission and reuses its request ID after a lost response', async () => {
  let release, attempts = 0, ids = 0
  const bodies = [], gate = new Promise(resolve => { release = resolve })
  const form = useRewardGrant({ load: async () => ({ tamers: [{ id: 'tai' }], digimon: [] }), newId: () => `id-${++ids}`,
    send: async body => { bodies.push(body); attempts++; await gate; if (attempts === 1) throw new Error('response lost'); return { ...body, replayed: true, tamerCount: 1, digimonCount: 0, untrackedTamerIds: [] } } })
  await form.load(); form.toggleTamer('tai'); form.amounts.tamerXp = 10
  const first = form.grant()
  assert.equal(await form.grant(), false)
  release(); assert.equal(await first, false)
  assert.equal(await form.grant(), true)
  assert.equal(ids, 1)
  assert.equal(bodies[0].requestId, bodies[1].requestId)
})

test('reward normalisation rejects non-array and malformed recipient inputs', () => {
  for (const invalid of [request({ tamerIds: 'tai' }), request({ digimonIds: [null] }), request({ requestId: '' })]) assert.throws(() => normalizeRewardRequest(invalid))
})

test('live reward notifications refresh the affected player and GM records, while other campaigns/players are ignored', () => {
  const loaded = [], refreshed = [], synced = []
  const player = loadPageFunctions('pages/campaigns/[campaignId]/player/[tamerId].vue', ['handleCampaignRewardMessage'], {
    campaignId: { value: 'campaign' }, tamer: { value: { id: 'tai' } }, loadData: () => loaded.push('loaded'),
  })
  const gm = loadPageFunctions('pages/campaigns/[campaignId]/encounters/[id].vue', ['handleEncounterSocketMessage'], {
    campaignId: { value: 'campaign' }, refreshAffectedRecords: plan => refreshed.push(plan), resyncEncounter: () => synced.push('synced'),
  })
  const message = { type: 'rewards-granted', campaignId: 'campaign', tamerIds: ['tai'], digimonIds: ['agu'] }
  player.handleCampaignRewardMessage({ ...message, campaignId: 'other' })
  player.handleCampaignRewardMessage({ ...message, tamerIds: ['matt'] })
  gm.handleEncounterSocketMessage({ ...message, campaignId: 'other' })
  assert.equal(loaded.length + refreshed.length + synced.length, 0)
  player.handleCampaignRewardMessage(message)
  gm.handleEncounterSocketMessage(message)
  assert.equal(loaded.length, 1)
  assert.equal(synced.length, 1)
  assert.deepEqual(refreshed, [{ tamerIds: ['tai'], digimonIds: ['agu'], evolutionLines: false, partnerDigimon: false }])
})
