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

function fixture() {
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
          for: async () => query,
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
  const transport = loadTypeScriptWithMocks('server/utils/securityTransport.ts', { h3 })
  const account = loadTypeScriptWithMocks('server/utils/campaignAuth.ts', { ...common, './session': session, './securityTransport': transport })
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', { ...common, './campaignAuth': account, './securityTransport': transport })
  const entities = loadTypeScriptWithMocks('server/utils/entitySecurity.ts', { ...common, './session': session, './campaignSecurity': security, './databaseScope': scopes })
  const authorization = loadTypeScriptWithMocks('server/utils/encounterAuthorization.ts', { './campaignSecurity': security, './entitySecurity': entities })
  const queue = loadTypeScript('server/utils/intercedeClaims.ts')
  const command = loadTypeScriptWithMocks('server/utils/attackCommand.ts', {
    ...common, './databaseScope': scopes, './encounterAuthorization': authorization,
    './intercedeClaims': queue, './encounterRoom': { prepareRoomCommit: async () => {} },
  })
  const boundary = loadTypeScriptWithMocks('server/utils/encounterCommand.ts', { h3, './attackCommand': command })
  const routeMocks = {
    '../../db': persistence, 'drizzle-orm': { getTableColumns, ...predicates },
    '../../utils/campaignSecurity': security, '../../utils/campaignAuth': account,
    '../../utils/campaignDm': security, '../../utils/entitySecurity': entities,
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
    if (!cache.has(path)) cache.set(path, loadTypeScriptWithMocks(`server/api/${path}`, routeMocks).default)
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
  return { route, event, campaign, map, encounter, credentials, login, add, writes: () => writes, rows }
}

const rejectedWithoutWrites = async (f, path, event) => {
  const before = f.writes()
  await assert.rejects(f.route(path)(event), error => [401, 403].includes(error.statusCode), path)
  assert.equal(f.writes(), before, `${path} must not write when unauthorized`)
}

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
