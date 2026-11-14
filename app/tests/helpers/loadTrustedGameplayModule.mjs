import { readFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as h3 from 'h3'
import { loadTypeScript, loadTypeScriptWithMocks } from './loadTypeScript.mjs'

const appDirectory = fileURLToPath(new URL('../../', import.meta.url))
const defaultQueue = loadTypeScript('server/utils/intercedeClaims.ts')
const validation = loadTypeScript('server/utils/securityValidation.ts')
const scopeHelpers = loadTypeScript('server/utils/encounterStateScope.ts')
const canonical = (filename, name) => (name.startsWith('~/') || name.startsWith('@/') ? resolve(appDirectory, name.slice(2)) : name.startsWith('.') ? resolve(dirname(filename), name) : name).replaceAll('\\', '/').replace(/\.(ts|mjs)$/, '')

/**
 * Explicit trusted-GM BUSINESS fixture. This does not test HTTP authentication or
 * the new outer command transaction; dedicated security tests use the ordinary
 * loader and actual guards/command boundary. Existing business queues, spatial
 * rules, inner transactions and their lock/rollback assertions remain real.
 */
export function loadTrustedGameplayModule(relativePath, mocks = {}) {
  if (/server\/utils\/(?:campaignSecurity|campaignDm|campaignAuth|session|entitySecurity|encounterAuthorization|encounterCommand|attackCommand|securityTransport|websocketSecurity)\.ts$/.test(relativePath)) {
    return loadTypeScriptWithMocks(relativePath, mocks)
  }
  const filename = resolve(appDirectory, relativePath)
  const definitions = new Map(Object.entries(mocks).map(([name, value]) => [canonical(filename, name), value]))
  const databaseEntry = [...definitions].find(([name, value]) => /\/server\/db(?:\/index)?$/.test(name) && value?.db)
  const database = databaseEntry?.[1]
  const queue = [...definitions].find(([name]) => name.endsWith('/utils/intercedeClaims'))?.[1] ?? defaultQueue
  const accessFor = id => ({ campaign: { id: id ?? 'campaign', level: 'standard', rulesSettings: {} }, userId: 'trusted-gameplay-gm', isMember: true, isDm: true, isManager: true, isGuest: false, accessibleTamerIds: [], principalId: 'test:trusted-gameplay-gm' })
  const encounterFor = async id => {
    if (!database?.encounters) return { id, campaignId: 'campaign', participants: [], pendingRequests: [], requestResponses: [] }
    const eq = mocks['drizzle-orm']?.eq ?? ((_column, value) => value)
    return (await database.db.select().from(database.encounters).where(eq(database.encounters.id, id)))[0]
  }
  const contextFor = async id => { const encounter = await encounterFor(id); return { encounter, access: accessFor(encounter?.campaignId) } }
  const security = {
    resolveCampaignAccess: async (_event, id) => accessFor(id),
    requireCampaignMember: async (_event, id) => accessFor(id),
    requireCampaignDm: async (_event, id) => accessFor(id),
    requireCampaignManager: async (_event, id) => accessFor(id),
    requireEncounterAccess: async (_event, id) => contextFor(id),
    requireEncounterActor: async (_event, encounter, id) => encounter.participants?.find(participant => participant.id === id),
    assertCanControlTamer: async () => undefined,
  }
  const entitySecurity = {
    requireEntityAccess: async (_event, _kind, record) => accessFor(record?.campaignId),
    requireLinkedEntity: async () => undefined,
    entityCampaignId: async (_kind, record) => record?.campaignId ?? null,
    filterReadableEntities: async (_event, rows) => rows,
    entityWrite: async work => work(),
  }
  const known = new Map([
    ['campaignSecurity', security], ['campaignDm', security], ['entitySecurity', entitySecurity],
    ['encounterAuthorization', { authorizeEncounterIntent: () => ({ access: accessFor('campaign') }) }],
    ['encounterStateScope', { validateEncounterStateScope: async () => {}, clearInvalidChargeMoves: scopeHelpers.clearInvalidChargeMoves }],
    ['encounterCommand', { defineEncounterCommand: work => work.length < 2 ? work : async event => {
      // Handlers consuming the boundary's locked context need that context in
      // business fixtures too. Preserve explicitly supplied access guards.
      const policy = [...definitions].find(([name, value]) => name.endsWith('/utils/campaignSecurity') && value.requireEncounterAccess)?.[1] ?? security
      return work(event, await policy.requireEncounterAccess(event, globalThis.getRouterParam(event, 'id'), 'dm'))
    } }],
    ['attackCommand', { runAttackCommand: async (_event, id, _body, _operation, work) => queue.serializeIntercedeClaim(id, async () => work(await contextFor(id))) }],
    ['securityValidation', {
      ...validation,
      // Legacy business fixtures deliberately use small table tokens, not Drizzle schema.
      // Their row mutations are already explicit in the test; real metadata is exercised in security suites.
      tableWriteBody: (body, table, ...args) => table?.[Symbol.for('drizzle:Columns')] ? validation.tableWriteBody(body, table, ...args) : { ...body },
    }],
  ])
  const augmented = { ...mocks }
  const source = readFileSync(filename, 'utf8')
  const names = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2])
  for (const name of names) {
    if (Object.hasOwn(augmented, name)) continue
    const key = canonical(filename, name)
    if (definitions.has(key)) { augmented[name] = definitions.get(key); continue }
    const basename = key.split('/').at(-1)
    if (known.has(basename)) { augmented[name] = known.get(basename); continue }
    if (name === 'h3') {
      augmented[name] = { ...h3, defineEventHandler: work => work,
        getRouterParam: (...args) => globalThis.getRouterParam(...args), readBody: (...args) => globalThis.readBody(...args),
      }
    }
    if (basename === 'encounterUpdate' || basename === 'attackMovement' || basename === 'digivolutionAction') {
      const child = relative(appDirectory, key + '.ts').replaceAll('\\', '/')
      const childImports = [...readFileSync(key + '.ts', 'utf8').matchAll(/from\s+(['"])([^'"]+)\1/g)].map(match => match[2])
      const forwarded = Object.fromEntries(childImports.flatMap(childName => {
        const candidate = definitions.get(canonical(key + '.ts', childName))
        return candidate === undefined ? [] : [[childName, candidate]]
      }))
      const childModule = loadTrustedGameplayModule(child, forwarded)
      augmented[name] = basename === 'attackMovement' ? {
        ...childModule,
        // These business fixtures start AFTER trusted targeting/movement admission.
        // New geometry authorization and atomic attack movement have separate real security tests.
        canonicalizeAreaAttack: async () => {},
        commitAttackMovement: async (...args) => args[3]?.movement ? childModule.commitAttackMovement(...args) : { defeated: false },
      } : basename === 'digivolutionAction' ? {
        ...childModule,
        // Historical GM business fixtures exercise the force-capable internal service;
        // real public HTTP guard tests separately reject a supplied force flag.
        performDigivolution: (id, body) => childModule.performDigivolution(id, body, !!body.force),
      } : childModule
    }
    if (key.endsWith('/actions/intercede-offer.post') && key !== filename.replace(/\.ts$/, '')) {
      let child
      augmented[name] = { resolveAttackOffers: async (id, body, trusted) => {
        const legacy = { ...body, ...(trusted?.actionsPaid ? { skipActionDeduction: true } : {}), ...(trusted?.clashAttack ? { clashAttack: true } : {}) }
        if (typeof globalThis.$fetch === 'function') return globalThis.$fetch(`/api/encounters/${id}/actions/intercede-offer`, { method: 'POST', body: legacy })
        child ??= loadTrustedGameplayModule(relative(appDirectory, key + '.ts').replaceAll('\\', '/'), Object.fromEntries(definitions))
        return child.resolveAttackOffers(id, body, trusted)
      } }
    }
  }
  const result = loadTypeScriptWithMocks(relativePath, augmented)
  if (relativePath.endsWith('/actions/intercede-offer.post.ts') && result.default && result.resolveAttackOffers) {
    const handler = result.default
    result.default = async event => {
      const body = await globalThis.readBody(event)
      if (Object.hasOwn(body, 'skipActionDeduction') || Object.hasOwn(body, 'clashAttack')) {
        const id = globalThis.getRouterParam(event, 'id')
        return queue.serializeIntercedeClaim(id, () => result.resolveAttackOffers(id, body, { actionsPaid: !!body.skipActionDeduction, clashAttack: !!body.clashAttack }))
      }
      return handler(event)
    }
  }
  return result
}
