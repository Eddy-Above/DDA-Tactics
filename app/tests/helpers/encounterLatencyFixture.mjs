import { loadTypeScript, loadTypeScriptWithMocks } from './loadTypeScript.mjs'

/** Real command/auth/validation/action code; persistence is isolated and can model DB round trips. */
export function encounterLatencyFixture({ delayMs = 0, signedIn = false } = {}) {
  const scope = loadTypeScript('server/utils/databaseScope.ts'), cache = loadTypeScript('server/utils/combatRecordCache.ts')
  const tables = Object.fromEntries(['encounters', 'campaigns', 'digimon', 'tamers', 'evolutionLines', 'maps', 'sessions', 'users', 'campaignAccessGrants', 'tamerAccessGrants']
    .map(name => [name, Object.fromEntries(['name', 'id', 'campaignId', 'partnerId', 'chain', 'userId', 'tamerId', 'expiresAt', 'username'].map(key => [key, key === 'name' ? name : `${name}.${key}`]))]))
  const participant = (id, type, entityId) => ({ id, type, entityId, isActive: id === 'actor', currentWounds: 0, maxWounds: 20, currentStance: 'neutral', actionsRemaining: { simple: 2 }, activeEffects: [] })
  const rows = {
    encounters: [{ id: 'enc', campaignId: 'campaign', mapId: 'map', visibleToPlayers: true, phase: 'combat', round: 1,
      revision: 1, participants: [participant('actor', 'tamer', 'tai'), participant('partner', 'digimon', 'mon')],
      turnOrder: ['actor'], currentTurnIndex: 0, battleLog: [], pendingRequests: [], requestResponses: [], intercedeOptOuts: {}, participantPositions: {}, destructibleStates: [] }],
    campaigns: [{ id: 'campaign', ownerId: 'owner', passwordHash: 'fixture-member', dmPasswordHash: 'fixture-dm', level: 'standard', rulesSettings: {} }],
    tamers: [{ id: 'tai', campaignId: 'campaign', name: 'Tai', attributes: {}, skills: {} }],
    digimon: [{ id: 'mon', campaignId: 'campaign', partnerId: 'tai', name: 'Agumon', qualities: [] }],
    maps: [{ id: 'map', campaignId: 'campaign' }], evolutionLines: [], users: [], campaignAccessGrants: [], tamerAccessGrants: [],
    sessions: [{ id: 'session', userId: 'owner', username: 'Owner', expiresAt: new Date(Date.now() + 60000) }],
  }
  const trace = [], headers = {}, control = { failNextWrite: false, failCommit: false }
  const sql = { eq: (column, value) => ({ column, values: [value] }), inArray: (column, values) => ({ column, values }), and: (...all) => ({ all }) }
  const matches = (row, filter) => !filter || (filter.all ? filter.all.every(item => matches(row, item)) : filter.values.includes(row[filter.column.split('.')[1]]))
  const execute = async (kind, table, work) => {
    trace.push({ kind, table })
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
    if (kind === 'write' && control.failNextWrite) { control.failNextWrite = false; throw Error('Write failed') }
    if (kind === 'commit' && control.failCommit) { control.failCommit = false; throw Error('Commit failed') }
    return work()
  }
  const database = {
    select: () => ({ from: table => {
      let filter
      const query = {
        innerJoin: () => query, where: value => { filter = value; return query },
        for: () => execute('lock', table.name, () => structuredClone(rows[table.name].filter(row => matches(row, filter)))),
        then: (yes, no) => execute('read', table.name, () => structuredClone(rows[table.name].filter(row => matches(row, filter)))).then(yes, no),
      }
      return query
    } }),
    update: table => ({ set: patch => ({ where: filter => {
      let operation
      const save = () => operation ??= execute('write', table.name, () => rows[table.name].filter(row => matches(row, filter)).map(row => {
        Object.assign(row, structuredClone(patch)); if (table === tables.encounters) row.revision++; return structuredClone(row)
      }))
      return { then: (yes, no) => save().then(yes, no), returning: save }
    } }) }),
    transaction: async work => {
      await execute('begin', 'transaction', () => {})
      const before = structuredClone(rows)
      try { const result = await work(database); await execute('commit', 'transaction', () => {}); return result }
      catch (error) { Object.assign(rows, before); await execute('rollback', 'transaction', () => {}); throw error }
    },
  }
  const db = new Proxy({}, { get: (_object, name) => (scope.scopedDatabase() ?? database)[name] })
  const store = { db, ...tables }
  const h3 = {
    defineEventHandler: work => work, getRouterParam: () => 'enc', readBody: async event => event.body,
    getMethod: () => 'POST', getRequestURL: event => new URL(event.url), getCookie: (event, name) => event.cookies[name],
    setCookie: (event, name, value) => { event.cookies[name] = value },
    setResponseHeader: (_event, name, value) => { headers[name] = value }, appendResponseHeader: (_event, name, value) => { headers[name] = value },
  }
  const saved = new Map(['createError', 'getRouterParam', 'readBody', 'getCookie'].map(name => [name, globalThis[name]]))
  Object.assign(globalThis, { createError: options => Object.assign(new Error(options.message), options), getRouterParam: h3.getRouterParam, readBody: h3.readBody, getCookie: h3.getCookie })
  const common = { '../db': store, 'drizzle-orm': sql, h3, './combatRecordCache': cache, './databaseScope': scope }
  const session = loadTypeScriptWithMocks('server/utils/session.ts', common)
  const account = loadTypeScriptWithMocks('server/utils/campaignAuth.ts', { ...common, './session': session })
  const graph = loadTypeScriptWithMocks('server/utils/entityScopeGraph.ts', common)
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', { ...common, './campaignAuth': account, './entityScopeGraph': graph, './securityTransport': { enforcePrincipalWriteLimit() {} } })
  const characters = loadTypeScriptWithMocks('server/utils/encounterCharacterScope.ts', { ...common, './entityScopeGraph': graph })
  const contexts = loadTypeScriptWithMocks('server/utils/encounterContextScope.ts', { ...common, './encounterCharacterScope': characters })
  const state = loadTypeScriptWithMocks('server/utils/encounterStateScope.ts', { ...common, './encounterCharacterScope': characters, './encounterContextScope': contexts })
  const auth = loadTypeScriptWithMocks('server/utils/encounterAuthorization.ts', { './campaignSecurity': security })
  const room = { prepareRoomCommit: async () => {}, getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }) }
  const command = loadTypeScriptWithMocks('server/utils/attackCommand.ts', { ...common, './encounterAuthorization': auth, './encounterStateScope': state, './encounterContextScope': contexts, './encounterRoom': room })
  const boundary = loadTypeScriptWithMocks('server/utils/encounterCommand.ts', { h3, './attackCommand': command })
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', common)
  const rules = loadTypeScriptWithMocks('server/utils/combatContext.ts', common)
  const update = loadTypeScriptWithMocks('server/utils/encounterUpdate.ts', {
    ...common, './encounterStateScope': state, './combatSpatial': spatial, './combatContext': rules, './encounterRoom': room,
    './naturewalk': { applyNaturewalkEnvironment: async (_enc, participants) => ({ participants, changed: false }) },
    './guidingLight': { applyGuidingLightAuras: async participants => ({ participants, changed: false }) },
    './enemyKnockouts': { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: async () => { throw Error('Unexpected knockout') } },
  })
  const log = loadTypeScriptWithMocks('server/utils/participantActionLog.ts', common)
  const event = { url: '', cookies: signedIn ? { session: 'session' } : {}, body: null, context: {}, node: { req: { headers: {} }, res: { setHeader: (name, value) => { headers[name] = value } } } }
  security.issueCampaignDmCookie(event, rows.campaigns[0])
  const invoke = async (action, body) => {
    const requestHeaders = {}
    const request = { ...event, url: `http://fixture/api/encounters/enc/actions/${action}`,
      body: { ...(action === 'log' ? {} : { participantId: 'actor' }), operationId: `operation-${trace.length}`, ...body },
      context: {}, node: { ...event.node, res: { setHeader: (name, value) => { requestHeaders[name] = value } } } }
    const handler = loadTypeScriptWithMocks(`server/api/encounters/[id]/actions/${action}.post.ts`, {
      '../../../../db': store, 'drizzle-orm': sql,
      '../../../../utils/encounterCommand': boundary, '../../../../utils/encounterAuthorization': auth,
      '../../../../utils/encounterUpdate': update, '../../../../utils/participantActionLog': log,
      '../../../../utils/combatRecordCache': cache, '../../../../utils/combatContext': rules, '../../../../utils/combatSpatial': spatial,
    }).default
    const start = performance.now(), result = await handler(request)
    return { result, elapsedMs: performance.now() - start, statements: trace.length, trace: structuredClone(trace), headers: requestHeaders }
  }
  return { invoke, rows, trace, control, restore: () => { for (const [key, value] of saved) value === undefined ? delete globalThis[key] : globalThis[key] = value } }
}
