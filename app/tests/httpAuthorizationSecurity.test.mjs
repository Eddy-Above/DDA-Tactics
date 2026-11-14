import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

// These tests load the real HTTP handlers, session lookup, signed credentials,
// campaign/entity policy and encounter command boundary. Only persistence and
// unrelated gameplay effects are replaced; no trusted-business auth bypass.
const schema = loadTypeScript('server/db/schema.ts')
const scopes = loadTypeScript('server/utils/databaseScope.ts')
const globals = ['createError', 'defineEventHandler', 'getRouterParam', 'readBody', 'getCookie', 'setCookie', 'getQuery', 'getRequestHeader']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const copy = value => structuredClone(value)
const columns = new Map()
for (const value of Object.values(schema)) {
  try { for (const [key, column] of Object.entries(getTableColumns(value))) columns.set(column, { table: getTableName(value), key }) } catch { /* relations and types are not tables */ }
}
const predicates = {
  eq: (a, b) => ({ op: 'eq', a, b }), and: (...items) => ({ op: 'and', items }),
  inArray: (a, b) => ({ op: 'in', a, b }), isNull: a => ({ op: 'null', a }),
}

function fixture({ beforeEvolutionLock } = {}) {
  const h3 = {
    createError: options => Object.assign(new Error(options.message), options),
    defineEventHandler: handler => handler,
    getRouterParam: (event, name) => event.params[name],
    getMethod: event => event.node.req.method,
    getRequestURL: event => new URL(event.url),
    readBody: async event => event.body,
    getCookie: (event, name) => event.cookies[name],
    setCookie: (event, name, value) => { event.cookies[name] = value },
    getQuery: event => event.query,
    getRequestHeader: (event, name) => event.node.req.headers[name],
    setResponseHeader: (event, name, value) => { event.responseHeaders[name] = value },
  }
  for (const name of globals) globalThis[name] = h3[name]
  const rows = new Map()
  const control = { evolutionLocks: 0 }
  let writes = 0
  const valueAt = (value, context) => columns.has(value) ? context[columns.get(value).table]?.[columns.get(value).key] : value
  const matches = (expression, context) => !expression || expression.op === 'and' ? !expression || expression.items.every(item => matches(item, context))
    : expression.op === 'eq' ? valueAt(expression.a, context) === valueAt(expression.b, context)
      : expression.op === 'in' ? expression.b.includes(valueAt(expression.a, context))
        : expression.op === 'null' ? valueAt(expression.a, context) == null : false
  const project = (selection, context, primary) => selection
    ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, copy(valueAt(column, context))]))
    : copy(context[primary])
  function database(state) {
    const list = table => state.get(getTableName(table)) ?? []
    return {
      select: selection => ({ from: table => {
        const name = getTableName(table)
        let contexts = list(table).map(row => ({ [name]: row })), expression, limit
        const query = {
          innerJoin(other, condition) {
            const otherName = getTableName(other)
            contexts = contexts.flatMap(context => list(other).map(row => ({ ...context, [otherName]: row })).filter(context => matches(condition, context)))
            return query
          },
          where(filter) { expression = filter; return query },
          limit(count) { limit = count; return query },
          for: async mode => {
            assert.equal(mode, 'update')
            if (table === schema.evolutionLines) {
              control.evolutionLocks++
              if (beforeEvolutionLock) {
                beforeEvolutionLock(list(table).find(row => matches(expression, { [name]: row })))
                beforeEvolutionLock = undefined
              }
            }
            return query
          },
          then(resolve, reject) { return Promise.resolve(contexts.filter(context => matches(expression, context)).slice(0, limit).map(context => project(selection, context, name))).then(resolve, reject) },
        }
        return query
      } }),
      update: table => ({ set: fields => ({ where: expression => {
        const name = getTableName(table)
        let applied
        const apply = () => applied ??= list(table).filter(row => matches(expression, { [name]: row })).map(row => { writes++; Object.assign(row, copy(fields)); return row })
        return {
          returning: async selection => apply().map(row => project(selection, { [name]: row }, name)),
          then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject),
        }
      } }) }),
      delete: table => ({ where: async expression => {
        const name = getTableName(table), before = list(table)
        state.set(name, before.filter(row => !matches(expression, { [name]: row })))
        writes += before.length - state.get(name).length
      } }),
      insert: table => ({ values: async row => {
        const name = getTableName(table)
        state.set(name, [...list(table), copy(row)])
        writes++
      } }),
      transaction: async work => {
        const staged = copy(state), result = await work(database(staged))
        state.clear(); for (const [key, value] of staged) state.set(key, value)
        return result
      },
    }
  }
  const live = database(rows)
  const db = new Proxy({}, { get: (_target, name) => (scopes.scopedDatabase() ?? live)[name] })
  const persistence = { ...schema, db }
  const common = { '../db': persistence, 'drizzle-orm': { getTableColumns, ...predicates }, h3 }
  const session = loadTypeScriptWithMocks('server/utils/session.ts', common)
  const ownership = loadTypeScriptWithMocks('server/utils/ownership.ts', { './session': session })
  const transport = loadTypeScriptWithMocks('server/utils/securityTransport.ts', { h3 })
  const account = loadTypeScriptWithMocks('server/utils/campaignAuth.ts', { ...common, './session': session, './securityTransport': transport })
  const graph = loadTypeScriptWithMocks('server/utils/entityScopeGraph.ts', common)
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', { ...common, './campaignAuth': account, './securityTransport': transport, './entityScopeGraph': graph })
  const characters = loadTypeScriptWithMocks('server/utils/encounterCharacterScope.ts', { ...common, './entityScopeGraph': graph })
  const contexts = loadTypeScriptWithMocks('server/utils/encounterContextScope.ts', { ...common, './encounterCharacterScope': characters })
  const stateScope = loadTypeScriptWithMocks('server/utils/encounterStateScope.ts', { ...common, './encounterCharacterScope': characters, './encounterContextScope': contexts })
  const entities = loadTypeScriptWithMocks('server/utils/entitySecurity.ts', { ...common, './session': session, './campaignSecurity': security, './databaseScope': scopes, './entityScopeGraph': graph })
  const gmFields = loadTypeScriptWithMocks('server/utils/libraryGmFields.ts', { './campaignSecurity': security })
  const authorization = loadTypeScriptWithMocks('server/utils/encounterAuthorization.ts', { './campaignSecurity': security, './entitySecurity': entities })
  const queue = loadTypeScript('server/utils/intercedeClaims.ts')
  const command = loadTypeScriptWithMocks('server/utils/attackCommand.ts', {
    ...common, './databaseScope': scopes, './encounterAuthorization': authorization,
    './intercedeClaims': queue, './encounterRoom': { prepareRoomCommit: async () => {} },
    './encounterStateScope': stateScope,
    './encounterContextScope': contexts,
  })
  const boundary = loadTypeScriptWithMocks('server/utils/encounterCommand.ts', { h3, './attackCommand': command })
  const routeMocks = {
    '../../db': persistence, 'drizzle-orm': { getTableColumns, ...predicates },
    '../../utils/campaignSecurity': security, '../../utils/campaignAuth': account,
    '../../utils/campaignDm': security, '../../utils/entitySecurity': entities,
    '../../utils/libraryGmFields': gmFields, '../../utils/session': session, '../../utils/ownership': ownership,
    '../../utils/databaseScope': scopes, '../../utils/encounterCommand': boundary,
    '../../utils/intercedeClaims': queue,
    '../../utils/websocketSecurity': { invalidateCampaignPeers: () => {} },
    '../../utils/encounterRoom': { broadcast: () => {} },
    '../../utils/guidingLight': { recomputeGuidingLightForEncounter: async () => {} },
    '../../utils/encounterAuthorization': authorization,
    '../../utils/encounterUpdate': { updateEncounterState: async (id, body) => {
      await db.update(schema.encounters).set(body).where(predicates.eq(schema.encounters.id, id))
      return (await db.select().from(schema.encounters).where(predicates.eq(schema.encounters.id, id)))[0]
    } },
  }
  const cache = new Map()
  const route = path => {
    if (!cache.has(path)) {
      const mocks = { ...routeMocks, ...Object.fromEntries(Object.entries(routeMocks).filter(([name]) => name.startsWith('../../')).map(([name, value]) => ['../' + name, value])) }
      cache.set(path, loadTypeScriptWithMocks(`server/api/${path}`, mocks).default)
    }
    return cache.get(path)
  }
  const add = (table, row) => { const name = getTableName(table); rows.set(name, [...(rows.get(name) ?? []), copy(row)]); return row }
  const campaign = (id = 'campaign', overrides = {}) => add(schema.campaigns, { id, name: 'Campaign', ownerId: 'owner', passwordHash: 'player-hash', dmPasswordHash: 'gm-hash', ...overrides })
  const map = (id = 'map', campaignId = 'campaign') => add(schema.maps, { id, campaignId, name: 'Map', doors: [], walls: [], voxels: [] })
  const encounter = (id = 'encounter', campaignId = 'campaign') => add(schema.encounters, { id, campaignId, mapId: null, name: 'Encounter', participants: [], visibleToPlayers: true, revision: 0 })
  const event = (method, resource, id, cookies = {}, body = { name: 'Changed' }) => ({
    params: { id, mapId: id }, cookies: { ...cookies }, body, query: {}, context: {}, responseHeaders: {},
    url: `http://localhost/api/${resource}/${id}`,
    node: { req: { method, headers: { origin: 'http://localhost' }, socket: { remoteAddress: '127.0.0.1' } } },
  })
  const credentials = (kind, record) => { const issued = event('GET', 'campaigns', record.id); security[kind === 'dm' ? 'issueCampaignDmCookie' : 'issueCampaignMemberCookie'](issued, record); return issued.cookies }
  const login = (id = 'owner', role) => {
    add(schema.users, { id, username: id })
    const token = `session-${id}`
    add(schema.sessions, { id: token, userId: id, expiresAt: new Date(Date.now() + 60_000) })
    if (role) add(schema.campaignAccessGrants, { id: `grant-${id}`, campaignId: 'campaign', userId: id, dmRole: role })
    return { session: token }
  }
  return { route, event, campaign, map, encounter, credentials, login, add, writes: () => writes, rows, security, control }
}

const rejectedWithoutWrites = async (f, path, event) => {
  const before = f.writes()
  await assert.rejects(f.route(path)(event), error => [401, 403].includes(error.statusCode), path)
  assert.equal(f.writes(), before, `${path} must not write when unauthorized`)
}

test('Workshop Tamer deletion can unlink its own records even when an evolution line has conflicting legacy campaign links', async () => {
  const f = fixture(), cookies = f.login()
  f.add(schema.tamers, { id: 'workshop-tamer', campaignId: null, ownerId: 'owner' })
  f.add(schema.digimon, { id: 'workshop-partner', campaignId: null, ownerId: 'owner', partnerId: 'workshop-tamer' })
  f.add(schema.digimon, { id: 'campaign-form', campaignId: 'foreign', ownerId: 'someone-else', partnerId: null })
  f.add(schema.evolutionLines, { id: 'legacy-line', campaignId: null, partnerId: 'workshop-tamer',
    chain: [{ digimonId: 'workshop-partner' }, { digimonId: 'campaign-form' }] })
  // This is the reported INVALID_CHARACTER_SCOPE failure in ordinary graph access.
  await assert.rejects(f.route('digimon/[id].get.ts')(f.event('GET', 'digimon', 'workshop-partner', cookies)),
    error => error.data?.code === 'INVALID_CHARACTER_SCOPE')
  const foreignBefore = copy(f.rows.get(getTableName(schema.digimon))[1])
  const result = await f.route('tamers/[id].delete.ts')(f.event('DELETE', 'tamers', 'workshop-tamer', cookies))
  assert.equal(result.success, true)
  assert.equal(f.rows.get(getTableName(schema.tamers)).length, 0)
  assert.equal(f.rows.get(getTableName(schema.digimon))[0].partnerId, null)
  assert.deepEqual(f.rows.get(getTableName(schema.digimon))[1], foreignBefore, 'do not modify referenced campaign records')
  const line = f.rows.get(getTableName(schema.evolutionLines))[0]
  assert.equal(line.partnerId, null)
  assert.deepEqual(line.chain, [{ digimonId: 'workshop-partner' }, { digimonId: 'campaign-form' }])
})

test('Workshop Tamer deletion preserves ownership checks and performs no writes for another owner', async () => {
  for (const foreignChild of [false, true]) {
    const f = fixture(), cookies = f.login()
    f.add(schema.tamers, { id: 'workshop-tamer', campaignId: null, ownerId: foreignChild ? 'owner' : 'someone-else' })
    f.add(schema.digimon, { id: 'partner', campaignId: null, ownerId: 'someone-else', partnerId: 'workshop-tamer' })
    await rejectedWithoutWrites(f, 'tamers/[id].delete.ts', f.event('DELETE', 'tamers', 'workshop-tamer', cookies))
  }
})

test('Workshop Tamer deletion refuses directly linked campaign records before unlinking anything', async () => {
  for (const table of [schema.digimon, schema.evolutionLines]) {
    const f = fixture(), cookies = f.login()
    f.add(schema.tamers, { id: 'workshop-tamer', campaignId: null, ownerId: 'owner' })
    f.add(table, { id: 'foreign-child', campaignId: 'foreign', partnerId: 'workshop-tamer', chain: [] })
    await assert.rejects(f.route('tamers/[id].delete.ts')(f.event('DELETE', 'tamers', 'workshop-tamer', cookies)), { statusCode: 400 })
    assert.equal(f.writes(), 0)
  }
})

test('real campaign PUT/DELETE reject outsiders for owned and protected ownerless campaigns', async () => {
  for (const ownerId of ['owner', null]) for (const method of ['PUT', 'DELETE']) {
    const f = fixture(); f.campaign('campaign', { ownerId })
    await rejectedWithoutWrites(f, `campaigns/[id].${method.toLowerCase()}.ts`, f.event(method, 'campaigns', 'campaign'))
  }
})

test('real map PUT/DELETE and generic encounter PUT/DELETE reject outsiders and player-only guests', async () => {
  for (const resource of ['maps', 'encounters']) for (const method of ['PUT', 'DELETE']) for (const ownerId of ['owner', null]) for (const player of [false, true]) {
    const f = fixture(), campaign = f.campaign('campaign', { ownerId }); f.map(); f.encounter()
    const cookies = player ? f.credentials('member', campaign) : {}
    const id = resource === 'maps' ? 'map' : 'encounter'
    await rejectedWithoutWrites(f, `${resource}/${resource === 'maps' ? '[mapId]' : '[id]'}.${method.toLowerCase()}.ts`, f.event(method, resource, id, cookies))
  }
})

test('signed GM guests can edit/delete ownerless campaigns and maps and encounters', async () => {
  for (const resource of ['campaigns', 'maps', 'encounters']) for (const method of ['PUT', 'DELETE']) {
    const f = fixture(), campaign = f.campaign('campaign', { ownerId: null }); f.map(); f.encounter()
    const id = resource === 'campaigns' ? 'campaign' : resource === 'maps' ? 'map' : 'encounter'
    const result = await f.route(`${resource}/${resource === 'maps' ? '[mapId]' : '[id]'}.${method.toLowerCase()}.ts`)(f.event(method, resource, id, f.credentials('dm', campaign)))
    assert.ok(result)
    assert.ok(f.writes() > 0)
  }
})

test('account owner/co-owner grants allow settings while co-DM grants allow geometry and encounter edits only', async () => {
  for (const role of ['owner', 'co-owner', 'co-dm']) {
    const f = fixture(); f.campaign(); f.map(); f.encounter()
    const cookies = role === 'owner' ? f.login() : f.login('delegate', role)
    if (role === 'co-dm') await rejectedWithoutWrites(f, 'campaigns/[id].put.ts', f.event('PUT', 'campaigns', 'campaign', cookies))
    else assert.equal((await f.route('campaigns/[id].put.ts')(f.event('PUT', 'campaigns', 'campaign', cookies))).name, 'Changed')
    assert.equal((await f.route('maps/[mapId].put.ts')(f.event('PUT', 'maps', 'map', cookies))).name, 'Changed')
    assert.equal((await f.route('encounters/[id].put.ts')(f.event('PUT', 'encounters', 'encounter', cookies))).name, 'Changed')
  }
})

test('GM cookies do not grant campaign-owner settings or deletion on account-owned campaigns', async () => {
  const f = fixture(), campaign = f.campaign(), cookies = f.credentials('dm', campaign)
  for (const method of ['PUT', 'DELETE']) await rejectedWithoutWrites(f, `campaigns/[id].${method.toLowerCase()}.ts`, f.event(method, 'campaigns', 'campaign', cookies))
})

test('anonymous GM fallback exists only when owner, player password and GM password are all absent', async () => {
  for (const ownerId of [null, 'owner']) for (const passwordHash of [null, 'player']) for (const dmPasswordHash of [null, 'gm']) {
    const f = fixture(); f.campaign('campaign', { ownerId, passwordHash, dmPasswordHash }); f.map()
    const event = f.event('PUT', 'maps', 'map')
    if (!ownerId && !passwordHash && !dmPasswordHash) assert.equal((await f.route('maps/[mapId].put.ts')(event)).name, 'Changed')
    else await rejectedWithoutWrites(f, 'maps/[mapId].put.ts', event)
  }
})

test('Workshop guests can edit unowned characters while account-owned records require their owner session', async () => {
  for (const kind of ['tamers', 'digimon']) {
    const f = fixture(), table = schema[kind]
    f.add(table, { id: 'unowned', name: 'Original', campaignId: null, ownerId: null, xp: 0, totalXp: 0 })
    f.add(table, { id: 'owned', name: 'Original', campaignId: null, ownerId: 'owner', xp: 0, totalXp: 0 })
    assert.equal((await f.route(`${kind}/[id].put.ts`)(f.event('PUT', kind, 'unowned'))).name, 'Changed')
    await rejectedWithoutWrites(f, `${kind}/[id].put.ts`, f.event('PUT', kind, 'owned'))
    const stranger = f.login('stranger')
    await rejectedWithoutWrites(f, `${kind}/[id].put.ts`, f.event('PUT', kind, 'owned', stranger))
    assert.equal((await f.route(`${kind}/[id].put.ts`)(f.event('PUT', kind, 'owned', f.login()))).name, 'Changed')
  }
})

test('real route validation rejects authority fields and cross-campaign map assignments after valid authentication', async () => {
  const f = fixture(), campaign = f.campaign(); f.map('foreign-map', 'elsewhere'); f.encounter()
  const cookies = f.credentials('dm', campaign)
  for (const body of [{ ownerId: 'attacker' }, { campaignId: 'elsewhere' }, { surprise: true }]) {
    await assert.rejects(f.route('encounters/[id].put.ts')(f.event('PUT', 'encounters', 'encounter', cookies, body)), { statusCode: 400 })
  }
  await assert.rejects(f.route('encounters/[id].put.ts')(f.event('PUT', 'encounters', 'encounter', cookies, { mapId: 'foreign-map' })), { statusCode: 400 })
  assert.equal(f.writes(), 0)
})

test('legacy unpartnered campaign forms cannot be read, edited or deleted through Workshop routes', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const f = fixture()
    f.campaign('protected')
    f.add(schema.digimon, { id: 'legacy-form', campaignId: null, partnerId: null, ownerId: null, name: 'Private form' })
    f.add(schema.evolutionLines, { id: 'private-line', campaignId: 'protected', partnerId: null, chain: [{ digimonId: 'legacy-form' }] })
    await rejectedWithoutWrites(f, `digimon/[id].${method.toLowerCase()}.ts`, f.event(method, 'digimon', 'legacy-form'))
  }
})

test('GM actor admission supports a legacy unpartnered form scoped by its owned evolution line', async () => {
  const f = fixture(), campaign = f.campaign(), encounter = f.encounter()
  encounter.participants = [{ id: 'legacy-actor', entityId: 'legacy-form', type: 'digimon' }]
  f.add(schema.digimon, { id: 'legacy-form', campaignId: null, partnerId: null })
  f.add(schema.evolutionLines, { id: 'line', campaignId: 'campaign', chain: [{ digimonId: 'legacy-form' }] })
  const event = f.event('POST', 'encounters', 'encounter', f.credentials('dm', campaign))
  const actor = await f.security.requireEncounterActor(event, encounter, 'legacy-actor')
  assert.equal(actor.entityId, 'legacy-form')
})

const torment = (id = 'torment', extra = {}) => ({ id, name: id, description: '', severity: 'minor', totalBoxes: 8, markedBoxes: 3, cpMarkedBoxes: 0, gmMarkedBoxes: 3, ...extra })
const person = (extra = {}) => ({ id: 'tamer', campaignId: 'campaign', ownerId: null, name: 'Player', age: 16,
  attributes: { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 }, skills: {},
  xp: 10, totalXp: 10, torments: [torment()], grantedInspiration: 2, digivolutionsUsedToday: 3, ...extra })
const chain = () => [
  { digimonId: 'root', stage: 'rookie', species: 'Root', isUnlocked: true, evolvesFromIndex: null },
  { digimonId: 'child', stage: 'champion', species: 'Child', isUnlocked: true, evolvesFromIndex: 0 },
  { digimonId: 'locked', stage: 'ultimate', species: 'Locked', isUnlocked: false, evolvesFromIndex: 0 },
]
function addPlayerLine(f, extra = {}) {
  f.add(schema.tamers, person({ xp: 0, totalXp: 0, ...extra.tamer }))
  for (const id of ['root', 'child', 'locked']) f.add(schema.digimon, { id, name: id, campaignId: 'campaign', partnerId: 'tamer', isEnemy: false, ...extra.form })
  return f.add(schema.evolutionLines, { id: 'line', name: 'Line', campaignId: 'campaign', partnerId: 'tamer', currentStageIndex: 0, chain: chain(), ...extra.line })
}

test('campaign players cannot change GM Inspiration, daily evolution limits or GM Torment marks through generic Tamer PUT', async () => {
  for (const body of [
    { grantedInspiration: 3 }, { digivolutionsUsedToday: 0 },
    { torments: [torment('torment', { gmMarkedBoxes: 4, markedBoxes: 4 })] },
    { torments: [] },
    { torments: [torment('torment', { gmMarkedBoxes: undefined })] },
    { torments: [torment('torment', { gmMarkedBoxes: null })] },
    { torments: [torment('replacement', { gmMarkedBoxes: 0, markedBoxes: 0 })] },
  ]) {
    const f = fixture(), campaign = f.campaign()
    f.add(schema.tamers, person())
    await rejectedWithoutWrites(f, 'tamers/[id].put.ts', f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), body))
  }
})

test('anonymous members of a public campaign with a GM password cannot grant Inspiration', async () => {
  const f = fixture()
  f.campaign('campaign', { ownerId: null, passwordHash: null })
  f.add(schema.tamers, person())
  await rejectedWithoutWrites(f, 'tamers/[id].put.ts', f.event('PUT', 'tamers', 'tamer', {}, { grantedInspiration: 3 }))
})

test('normal player full-form Tamer saves preserve unchanged GM fields across Torment reorder and ordinary XP purchases', async () => {
  const f = fixture(), campaign = f.campaign()
  const stored = person({ torments: [torment(), torment('other', { markedBoxes: 0, gmMarkedBoxes: 0 })] })
  f.add(schema.tamers, stored)
  const body = { ...copy(stored), name: 'Edited by player', torments: [...copy(stored.torments)].reverse() }
  const edited = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), body))
  assert.equal(edited.name, 'Edited by player')
  assert.equal(edited.grantedInspiration, 2)
  assert.equal(edited.digivolutionsUsedToday, 3)
  assert.equal(edited.torments.find(t => t.id === 'torment').gmMarkedBoxes, 3)
  const purchased = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), {
    xp: 6, torments: [torment('other', { markedBoxes: 0, gmMarkedBoxes: 0 }), torment('torment', { markedBoxes: 4 })],
  }))
  assert.equal(purchased.xp, 6)
  assert.equal(purchased.torments.find(t => t.id === 'torment').markedBoxes, 4)
})

test('legacy null GM markers can be echoed as zero by player forms', async () => {
  const f = fixture(), campaign = f.campaign()
  f.add(schema.tamers, person({ grantedInspiration: null, digivolutionsUsedToday: null, torments: [torment('legacy', { markedBoxes: 0, gmMarkedBoxes: null })] }))
  const saved = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), {
    grantedInspiration: 0, digivolutionsUsedToday: 0, torments: [torment('legacy', { markedBoxes: 0, gmMarkedBoxes: 0 })],
  }))
  assert.equal(saved.grantedInspiration, 0)
  assert.equal(saved.torments[0].gmMarkedBoxes, 0)
})

test('players cannot reduce marked boxes below a stored GM floor while echoing the GM marker', async () => {
  for (const markedBoxes of [0, 2, undefined]) {
    const f = fixture(), campaign = f.campaign(); f.add(schema.tamers, person())
    await rejectedWithoutWrites(f, 'tamers/[id].put.ts', f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), { torments: [torment('torment', { markedBoxes })] }))
  }
})

test('normal XP refunds can reach the GM floor while unchanged legacy below-floor records remain editable', async () => {
  const f = fixture(), campaign = f.campaign()
  f.add(schema.tamers, person({ xp: 1, torments: [torment('torment', { markedBoxes: 5 })] }))
  const refunded = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', f.credentials('member', campaign), { xp: 10, torments: [torment()] }))
  assert.equal(refunded.xp, 10)
  assert.equal(refunded.torments[0].markedBoxes, 3)
  const legacy = fixture(), legacyCampaign = legacy.campaign()
  legacy.add(schema.tamers, person({ torments: [torment('torment', { markedBoxes: 1 })] }))
  const unchanged = await legacy.route('tamers/[id].put.ts')(legacy.event('PUT', 'tamers', 'tamer', legacy.credentials('member', legacyCampaign), { name: 'Legacy edit', torments: [torment('torment', { markedBoxes: 1 })] }))
  assert.equal(unchanged.name, 'Legacy edit')
  await rejectedWithoutWrites(legacy, 'tamers/[id].put.ts', legacy.event('PUT', 'tamers', 'tamer', legacy.credentials('member', legacyCampaign), { torments: [torment('torment', { markedBoxes: 0 })] }))
})

test('verified GMs and Workshop editors can still change the marked-box floor', async () => {
  for (const workshop of [false, true]) {
    const f = fixture(), campaign = workshop ? null : f.campaign()
    f.add(schema.tamers, person({ campaignId: workshop ? null : 'campaign' }))
    const saved = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', campaign ? f.credentials('dm', campaign) : {}, { torments: [torment('torment', { markedBoxes: 0 })] }))
    assert.equal(saved.torments[0].markedBoxes, 0)
  }
})

test('account-admitted players retain ordinary sheet access without gaining GM grants', async () => {
  const f = fixture(); f.campaign(); f.add(schema.tamers, person())
  const cookies = f.login('player')
  f.add(schema.tamerAccessGrants, { id: 'player-grant', userId: 'player', tamerId: 'tamer' })
  assert.equal((await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', cookies, { name: 'Account player' }))).name, 'Account player')
  await rejectedWithoutWrites(f, 'tamers/[id].put.ts', f.event('PUT', 'tamers', 'tamer', cookies, { grantedInspiration: 3 }))
})

test('verified GM cookies and GM-tier account roles can update the protected Tamer fields', async () => {
  for (const role of ['cookie', 'owner', 'co-owner', 'co-dm']) {
    const f = fixture(), campaign = f.campaign(); f.add(schema.tamers, person())
    const cookies = role === 'cookie' ? f.credentials('dm', campaign) : role === 'owner' ? f.login() : f.login('delegate', role)
    const saved = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', cookies, {
      grantedInspiration: 4, digivolutionsUsedToday: 0, torments: [torment('torment', { gmMarkedBoxes: 4, markedBoxes: 4 })],
    }))
    assert.equal(saved.grantedInspiration, 4)
    assert.equal(saved.digivolutionsUsedToday, 0)
    assert.equal(saved.torments[0].gmMarkedBoxes, 4)
  }
})

test('Tamer creation rejects player-supplied GM grants while zero defaults and verified GM creation work', async () => {
  for (const protectedFields of [{ grantedInspiration: 1 }, { torments: [torment()] }, { digivolutionsUsedToday: 1 }]) {
    const f = fixture(), campaign = f.campaign()
    const { id: _id, ownerId: _owner, ...body } = person({ xp: 0, totalXp: 0, torments: [], grantedInspiration: 0, digivolutionsUsedToday: 0, ...protectedFields })
    await rejectedWithoutWrites(f, 'tamers/index.post.ts', f.event('POST', 'tamers', '', f.credentials('member', campaign), body))
  }
  for (const gm of [false, true]) {
    const f = fixture(), campaign = f.campaign()
    const body = { name: 'New player', age: 16, campaignId: 'campaign', attributes: person().attributes, skills: {}, grantedInspiration: gm ? 2 : 0, torments: gm ? [torment()] : [] }
    const saved = await f.route('tamers/index.post.ts')(f.event('POST', 'tamers', '', f.credentials(gm ? 'dm' : 'member', campaign), body))
    assert.equal(saved.grantedInspiration, gm ? 2 : 0)
  }
})

test('evolution players can echo unlocks, reorder nodes by identity and select an unlocked current form', async () => {
  const f = fixture(), campaign = f.campaign(), stored = addPlayerLine(f)
  const rearranged = [copy(stored.chain[0]), copy(stored.chain[2]), copy(stored.chain[1])]
  rearranged[2].species = 'Edited child name'
  const saved = await f.route('evolution-lines/[id].put.ts')(f.event('PUT', 'evolution-lines', 'line', f.credentials('member', campaign), { chain: rearranged, currentStageIndex: 2 }))
  assert.equal(saved.currentStageIndex, 2)
  assert.equal(saved.chain[2].isUnlocked, true)
  assert.equal(saved.chain[1].isUnlocked, false)
})

test('evolution player edits cannot unlock, relock, duplicate unlocked nodes or promote a locked node to root', async () => {
  for (const change of [
    entries => { entries[2].isUnlocked = true; return entries },
    entries => { entries[1].isUnlocked = false; return entries },
    entries => [...entries, copy(entries[1])],
    entries => [{ ...entries[2], isUnlocked: true, evolvesFromIndex: null }, { ...entries[0], evolvesFromIndex: 0 }, { ...entries[1], evolvesFromIndex: 1 }],
  ]) {
    const f = fixture(), campaign = f.campaign(); addPlayerLine(f)
    await rejectedWithoutWrites(f, 'evolution-lines/[id].put.ts', f.event('PUT', 'evolution-lines', 'line', f.credentials('member', campaign), { chain: change(chain()) }))
  }
})

test('verified GM can change evolution locks, including legacy lines with derived campaign scope', async () => {
  const f = fixture(), campaign = f.campaign(); addPlayerLine(f, { line: { campaignId: null } })
  const entries = chain(); entries[2].isUnlocked = true
  const saved = await f.route('evolution-lines/[id].put.ts')(f.event('PUT', 'evolution-lines', 'line', f.credentials('dm', campaign), { chain: entries }))
  assert.equal(saved.chain[2].isUnlocked, true)
})

test('new campaign evolution lines allow the default unlocked root but require GM for later unlocks', async () => {
  for (const laterUnlocked of [false, true]) {
    const f = fixture(), campaign = f.campaign(); addPlayerLine(f)
    const entries = chain().slice(0, 2); delete entries[0].isUnlocked; entries[1].isUnlocked = laterUnlocked
    const body = { name: 'New line', campaignId: 'campaign', partnerId: 'tamer', chain: entries }
    const event = f.event('POST', 'evolution-lines', '', f.credentials('member', campaign), body)
    if (laterUnlocked) {
      await rejectedWithoutWrites(f, 'evolution-lines/index.post.ts', event)
      const saved = await f.route('evolution-lines/index.post.ts')(f.event('POST', 'evolution-lines', '', f.credentials('dm', campaign), body))
      assert.equal(saved.chain[1].isUnlocked, true)
    }
    else {
      const saved = await f.route('evolution-lines/index.post.ts')(event)
      assert.equal(saved.chain[0].isUnlocked, true)
      assert.equal(saved.chain[1].isUnlocked, false)
    }
  }
})

test('Workshop grant editing remains public for unowned characters and owner-only for account-owned characters', async () => {
  for (const owned of [false, true]) {
    const f = fixture()
    f.add(schema.tamers, person({ campaignId: null, ownerId: owned ? 'owner' : null }))
    if (owned) await rejectedWithoutWrites(f, 'tamers/[id].put.ts', f.event('PUT', 'tamers', 'tamer', {}, { grantedInspiration: 3 }))
    const saved = await f.route('tamers/[id].put.ts')(f.event('PUT', 'tamers', 'tamer', owned ? f.login() : {}, { grantedInspiration: 3, digivolutionsUsedToday: 0 }))
    assert.equal(saved.grantedInspiration, 3)
  }
  const f = fixture()
  addPlayerLine(f, { tamer: { campaignId: null }, form: { campaignId: null, partnerId: null }, line: { campaignId: null, partnerId: null } })
  const entries = chain(); entries[2].isUnlocked = true
  const saved = await f.route('evolution-lines/[id].put.ts')(f.event('PUT', 'evolution-lines', 'line', {}, { chain: entries }))
  assert.equal(saved.chain[2].isUnlocked, true)
  const owned = fixture()
  addPlayerLine(owned, { tamer: { campaignId: null, ownerId: 'owner' }, form: { campaignId: null, ownerId: 'owner' }, line: { campaignId: null } })
  await rejectedWithoutWrites(owned, 'evolution-lines/[id].put.ts', owned.event('PUT', 'evolution-lines', 'line', {}, { chain: entries }))
  const ownedSaved = await owned.route('evolution-lines/[id].put.ts')(owned.event('PUT', 'evolution-lines', 'line', owned.login(), { chain: entries }))
  assert.equal(ownedSaved.chain[2].isUnlocked, true)
})

function linkRefreshForms(f, reparent = false) {
  const records = new Map(f.rows.get(getTableName(schema.digimon)).map(row => [row.id, row]))
  records.get('root').evolutionPathIds = reparent ? ['locked'] : ['child', 'locked']
  records.get('locked').evolvesFromId = 'root'
  records.get('locked').evolutionPathIds = reparent ? ['child'] : []
  records.get('child').evolvesFromId = reparent ? 'locked' : 'root'
}

test('refresh locks the row and preserves a GM relock committed before the waiting refresh acquires it', async () => {
  const f = fixture({ beforeEvolutionLock: row => {
    // Model the other transaction's final commit immediately before this SELECT
    // obtains its update lock: a pre-lock snapshot must never restore this grant.
    row.chain[1].isUnlocked = false
  } }), campaign = f.campaign()
  addPlayerLine(f); linkRefreshForms(f)
  const saved = await f.route('evolution-lines/[id]/refresh.post.ts')(f.event('POST', 'evolution-lines', 'line', f.credentials('member', campaign), {}))
  assert.equal(f.control.evolutionLocks, 1)
  assert.equal(saved.chain.find(entry => entry.digimonId === 'child').isUnlocked, false)
  assert.equal(f.rows.get(getTableName(schema.evolutionLines))[0].chain.find(entry => entry.digimonId === 'child').isUnlocked, false)
  assert.equal(f.writes(), 1)
})

test('normal player refresh retains existing grants and discovers new forms as locked', async () => {
  const f = fixture(), campaign = f.campaign(); addPlayerLine(f); linkRefreshForms(f)
  f.rows.get(getTableName(schema.digimon)).find(row => row.id === 'root').evolutionPathIds.push('new-form')
  f.add(schema.digimon, { id: 'new-form', name: 'New form', stage: 'mega', campaignId: 'campaign', partnerId: 'tamer', isEnemy: false })
  const saved = await f.route('evolution-lines/[id]/refresh.post.ts')(f.event('POST', 'evolution-lines', 'line', f.credentials('member', campaign), {}))
  assert.equal(saved.chain.find(entry => entry.digimonId === 'child').isUnlocked, true)
  assert.equal(saved.chain.find(entry => entry.digimonId === 'locked').isUnlocked, false)
  assert.equal(saved.chain.find(entry => entry.digimonId === 'new-form').isUnlocked, false)
})

test('refresh cannot bypass GM unlock semantics by reparenting a granted form; GM and Workshop refresh remain available', async () => {
  const f = fixture(), campaign = f.campaign(); addPlayerLine(f); linkRefreshForms(f, true)
  await rejectedWithoutWrites(f, 'evolution-lines/[id]/refresh.post.ts', f.event('POST', 'evolution-lines', 'line', f.credentials('member', campaign), {}))
  const saved = await f.route('evolution-lines/[id]/refresh.post.ts')(f.event('POST', 'evolution-lines', 'line', f.credentials('dm', campaign), {}))
  const child = saved.chain.find(entry => entry.digimonId === 'child')
  assert.equal(saved.chain[child.evolvesFromIndex].digimonId, 'locked')
  assert.equal(child.isUnlocked, true)
  const workshop = fixture()
  addPlayerLine(workshop, { tamer: { campaignId: null }, form: { campaignId: null, partnerId: null }, line: { campaignId: null, partnerId: null } })
  linkRefreshForms(workshop, true)
  const refreshed = await workshop.route('evolution-lines/[id]/refresh.post.ts')(workshop.event('POST', 'evolution-lines', 'line', {}, {}))
  assert.equal(refreshed.chain.find(entry => entry.digimonId === 'child').isUnlocked, true)
})
