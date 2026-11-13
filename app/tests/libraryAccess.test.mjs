import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const appDirectory = fileURLToPath(new URL('../', import.meta.url))
const pagesDirectory = resolve(appDirectory, 'pages')
const libraryDirectory = resolve(pagesDirectory, 'campaigns/[campaignId]/library')
const globals = ['createError', 'defineNuxtRouteMiddleware', 'useRequestFetch', 'useCookie', 'navigateTo', '$fetch', 'useNuxtApp']
const originals = Object.fromEntries(globals.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const name of globals) {
    if (originals[name] === undefined) delete globalThis[name]
    else globalThis[name] = originals[name]
  }
})

function pageRoute(filename) {
  const relativePath = relative(pagesDirectory, filename).replaceAll('\\', '/')
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? ''
  const source = ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let meta = {}
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue
    const call = statement.expression
    if (call.expression.getText(source) !== 'definePageMeta') continue
    assert.ok(call.arguments[0], `Missing metadata argument in ${relativePath}`)
    // Evaluate only the actual static metadata expression, never page setup.
    meta = new Function(`return (${call.arguments[0].getText(source)})`)()
  }
  const path = '/' + relativePath.replace(/\.vue$/, '').replace(/\/index$/, '')
    .replace('[campaignId]', 'campaign').replace(/\[[^\]]+\]/g, 'record')
  return { path, fullPath: path, params: { campaignId: 'campaign' }, meta, relativePath }
}

function collectPages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = resolve(directory, entry.name)
    return entry.isDirectory() ? collectPages(filename) : entry.name.endsWith('.vue') ? [pageRoute(filename)] : []
  })
}
const libraryPages = collectPages(libraryDirectory)

function fixture(overrides = {}) {
  const app = {}
  globalThis.useNuxtApp = () => app
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  globalThis.defineNuxtRouteMiddleware = guard => guard
  const campaign = { id: 'campaign', ownerId: null, passwordHash: null, dmPasswordHash: 'gm-hash', ...overrides }
  let account = { userId: null, isOwner: false, isCoOwner: false, isCoDm: false, accessibleTamerIds: [] }
  const event = { cookies: {}, context: {} }
  const hints = {}, requests = []
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', {
    '../db': { campaigns: { id: 'id' }, db: { select: () => ({ from: () => ({ where: async id => id === campaign.id ? [campaign] : [] }) }) } },
    'drizzle-orm': { eq: (_field, value) => value },
    './campaignAuth': { getMyCampaignAccess: async () => account },
    './securityTransport': { enforcePrincipalWriteLimit: () => {} },
    h3: {
      getCookie: (request, name) => request.cookies[name],
      setCookie: (request, name, value) => { request.cookies[name] = value },
    },
  })
  let fetchFailure = false
  // SSR-aware request fetch must retain the incoming signed, httpOnly cookie.
  // Plain $fetch would omit it on the server and is deliberately unavailable.
  globalThis.$fetch = () => { throw new Error('Use the SSR-aware request fetch') }
  globalThis.useRequestFetch = () => async url => {
    requests.push(url)
    assert.equal(url, `/api/campaigns/${campaign.id}/my-access`)
    if (fetchFailure) throw new Error('Access check failed')
    return security.resolveCampaignAccess(event, campaign.id)
  }
  globalThis.useCookie = name => ({
    get value() { return hints[name] },
    set value(value) { hints[name] = value },
  })
  globalThis.navigateTo = path => ({ redirect: path })
  const dmAccess = loadTypeScriptWithMocks('middleware/dm-access.ts', {}).default
  const campaignAccess = loadTypeScriptWithMocks('middleware/campaign-access.ts', {}).default
  const libraryAccess = loadTypeScriptWithMocks('middleware/library-access.global.ts', {
    './dm-access': { __esModule: true, default: dmAccess },
  }).default
  const named = { 'dm-access': dmAccess, 'campaign-access': campaignAccess }
  return {
    campaign, event, hints, requests,
    setAccount(value) { account = { ...account, ...value } },
    failFetch() { fetchFailure = true },
    issueGm() { security.issueCampaignDmCookie(event, campaign) },
    issuePlayer() { security.issueCampaignMemberCookie(event, campaign) },
    async navigate(route) {
      const denied = await libraryAccess(route, { path: '/' })
      if (denied) return denied
      const middleware = route.meta.middleware ?? []
      for (const name of Array.isArray(middleware) ? middleware : [middleware]) {
        assert.ok(named[name], `Unexpected middleware ${name}`)
        const result = await named[name](route, { path: '/' })
        if (result) return result
      }
    },
  }
}

test('every real Library root, list, new, detail and editor route rejects a guest in a GM-password-only campaign', async () => {
  const f = fixture()
  assert.equal(libraryPages.length, 14)
  for (const section of ['digimon', 'tamers', 'evolution', 'maps']) {
    assert.equal(libraryPages.filter(page => page.path.includes(`/library/${section}`)).length, 3)
  }
  for (const route of libraryPages) {
    assert.deepEqual(await f.navigate(route), { redirect: '/campaigns/campaign' }, route.relativePath)
  }
})

test('player membership and forged boolean GM cookies cannot enter any Library route', async () => {
  const f = fixture({ passwordHash: 'player-hash' })
  f.issuePlayer()
  f.hints['campaign-access-campaign'] = 'true'
  f.hints['campaign-dm-campaign'] = 'true'
  f.event.cookies['campaign-access-campaign'] = 'true'
  f.event.cookies['campaign-dm-campaign'] = 'true'
  for (const route of libraryPages) assert.deepEqual(await f.navigate(route), { redirect: '/campaigns/campaign' }, route.relativePath)
  assert.equal(f.hints['campaign-dm-campaign'], null)
})

test('a signed-in campaign player cannot enter GM-password-only Library pages', async () => {
  const f = fixture()
  f.setAccount({ userId: 'player', accessibleTamerIds: ['tamer'] })
  for (const route of libraryPages) assert.deepEqual(await f.navigate(route), { redirect: '/campaigns/campaign' }, route.relativePath)
})

test('verified GM credentials admit direct Library requests with incoming SSR cookies', async () => {
  const f = fixture({ passwordHash: 'player-hash' })
  f.issueGm()
  for (const route of libraryPages) assert.equal(await f.navigate(route), undefined, route.relativePath)
  assert.equal(f.hints['campaign-dm-campaign'], 'true')
  assert.ok(f.requests.length >= libraryPages.length)
})

for (const role of ['isOwner', 'isCoOwner', 'isCoDm']) {
  test(`account ${role} admission reaches every Library route without a GM cookie`, async () => {
    const f = fixture({ ownerId: 'owner', passwordHash: 'player-hash' })
    f.setAccount({ userId: 'account', [role]: true })
    for (const route of libraryPages) assert.equal(await f.navigate(route), undefined, route.relativePath)
  })
}

test('anonymous GM entry is preserved only for a wholly public ownerless campaign', async () => {
  const open = fixture({ dmPasswordHash: null })
  for (const route of libraryPages) assert.equal(await open.navigate(route), undefined, route.relativePath)
  for (const overrides of [{ ownerId: 'owner', dmPasswordHash: null }, { passwordHash: 'player-hash', dmPasswordHash: null }]) {
    const protectedCampaign = fixture(overrides)
    for (const route of libraryPages) {
      const result = await protectedCampaign.navigate(route)
      assert.ok(['/campaigns/campaign', '/?unlock=campaign'].includes(result?.redirect), route.relativePath)
    }
  }
})

test('client navigation rechecks GM authority after password revocation and clears UI hints', async () => {
  const f = fixture()
  f.issueGm()
  assert.equal(await f.navigate(libraryPages.find(page => page.path.endsWith('/digimon'))), undefined)
  f.campaign.dmPasswordHash = 'changed-gm-hash'
  assert.deepEqual(await f.navigate(libraryPages.find(page => page.path.endsWith('/evolution'))), { redirect: '/campaigns/campaign' })
  assert.equal(f.hints['campaign-dm-campaign'], null)
})

test('failed access requests deny Library navigation despite an existing GM hint', async () => {
  const f = fixture()
  f.hints['campaign-dm-campaign'] = 'true'
  f.failFetch()
  assert.deepEqual(await f.navigate(libraryPages.find(page => page.path.endsWith('/tamers/new'))), { redirect: '/campaigns/campaign' })
  assert.equal(f.hints['campaign-dm-campaign'], null)
})

test('membership and GM guards share one check per navigation and recheck a fresh visit', async () => {
  const f = fixture()
  f.issueGm()
  const root = libraryPages.find(page => page.path === '/campaigns/campaign/library')
  assert.equal(await f.navigate(root), undefined)
  assert.equal(f.requests.length, 1, 'two sequential guards make one authority request')
  assert.equal(await f.navigate({ ...root }), undefined)
  assert.equal(f.requests.length, 2, 'a new navigation must recheck authority')
  f.campaign.dmPasswordHash = 'revoked'
  assert.deepEqual(await f.navigate({ ...root }), { redirect: '/campaigns/campaign' })
  assert.equal(f.requests.length, 3)
})

test('Library guard covers case and trailing-slash route variants without matching neighbouring routes', async () => {
  const f = fixture()
  assert.deepEqual(await f.navigate({ path: '/CAMPAIGNS/campaign/LIBRARY/DIGIMON/', params: { campaignId: 'campaign' }, meta: {} }), { redirect: '/campaigns/campaign' })
  const requestCount = f.requests.length
  for (const path of ['/campaigns/campaign/library-public', '/campaigns/campaign/player', '/campaigns/campaign/encounters/enc', '/workshop/digimon']) {
    assert.equal(await f.navigate({ path, params: { campaignId: 'campaign' }, meta: {} }), undefined)
  }
  assert.equal(f.requests.length, requestCount)
})

test('Library URL matching preserves the authoritative campaign parameter casing', async () => {
  const f = fixture({ id: 'Campaign-AbC' })
  f.issueGm()
  assert.equal(await f.navigate({ path: '/CAMPAIGNS/Campaign-AbC/LIBRARY/DIGIMON/record', params: { campaignId: 'Campaign-AbC' }, meta: {} }), undefined)
  assert.deepEqual(f.requests, ['/api/campaigns/Campaign-AbC/my-access'])
})

test('real campaign player pages remain outside the Library GM guard', async () => {
  const f = fixture({ passwordHash: 'player-hash' })
  f.issuePlayer()
  const playerPages = collectPages(resolve(pagesDirectory, 'campaigns/[campaignId]/player'))
  assert.ok(playerPages.length > 0)
  for (const route of playerPages) assert.equal(await f.navigate(route), undefined, route.relativePath)
  // Player page guards, if present, may check membership but never GM access.
  assert.equal(f.hints['campaign-dm-campaign'], undefined)
})
