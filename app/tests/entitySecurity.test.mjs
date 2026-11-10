import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = globalThis.createError
afterEach(() => { if (original === undefined) delete globalThis.createError; else globalThis.createError = original })
function fixture() {
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const rows = { tamers: [{ id: 'private-tamer', campaignId: 'private' }, { id: 'owned', campaignId: null, ownerId: 'owner' }], digimon: [{ id: 'private-mon', campaignId: 'private' }, { id: 'owned-mon', campaignId: null, ownerId: 'owner' }] }
  let user = null, admitted = false, gm = false
  const tables = Object.fromEntries(['tamers', 'digimon', 'maps'].map(name => [name, { name, id: 'id' }]))
  const access = id => ({ campaign: { id }, isMember: admitted, isDm: gm, userId: user?.id ?? null })
  const requireMember = async (_event, id) => { if (!admitted) throw Object.assign(new Error('denied'), { statusCode: 401 }); return access(id) }
  const helper = loadTypeScriptWithMocks('server/utils/entitySecurity.ts', {
    '../db': { ...tables, db: { select: () => ({ from: table => ({ where: async id => (rows[table.name] ?? []).filter(row => row.id === id) }) }) } },
    'drizzle-orm': { eq: (_field, id) => id },
    './session': { getSessionUser: async () => user },
    './campaignSecurity': {
      requireCampaignMember: requireMember,
      requireCampaignDm: async (...args) => { const result = await requireMember(...args); if (!gm) throw Object.assign(new Error('GM required'), { statusCode: 403 }); return result },
      resolveCampaignAccess: async (_event, id) => access(id),
      assertCanControlTamer: async () => { if (!admitted) throw Object.assign(new Error('denied'), { statusCode: 401 }) },
    },
  })
  return { ...helper, rows, set: values => { if ('user' in values) user = values.user; if ('admitted' in values) admitted = values.admitted; if ('gm' in values) gm = values.gm } }
}

test('public unowned Workshop editing survives, while account-owned records remain owner-only', async () => {
  const f = fixture()
  await f.requireEntityAccess({}, 'tamer', { id: 'legacy', campaignId: null, ownerId: null }, true)
  await assert.rejects(f.requireEntityAccess({}, 'tamer', f.rows.tamers[1], true), error => error.statusCode === 403)
  f.set({ user: { id: 'owner' } })
  await f.requireEntityAccess({}, 'tamer', f.rows.tamers[1], true)
})

test('legacy null-campaign partner forms cannot leak a private campaign through Workshop queries', async () => {
  const f = fixture()
  const legacy = { id: 'legacy-mon', campaignId: null, partnerId: 'private-tamer' }
  await assert.rejects(f.requireEntityAccess({}, 'digimon', legacy), error => error.statusCode === 401)
  assert.deepEqual(await f.filterReadableEntities({}, [legacy, { id: 'public', campaignId: null }], 'digimon'), [{ id: 'public', campaignId: null }])
})

test('all linked objects must share scope and independently allow writes', async () => {
  const f = fixture()
  await assert.rejects(f.requireLinkedEntity({}, 'digimon', 'private-mon', null), error => error.statusCode === 400)
  await assert.rejects(f.requireLinkedEntity({}, 'digimon', 'owned-mon', null), error => error.statusCode === 403)
  f.set({ user: { id: 'owner' } })
  assert.equal((await f.requireLinkedEntity({}, 'digimon', 'owned-mon', null)).id, 'owned-mon')
})

test('maps need GM permission and standalone maps are readable without becoming writable', async () => {
  const f = fixture()
  f.set({ admitted: true })
  await assert.rejects(f.requireEntityAccess({}, 'map', { campaignId: 'campaign' }, true), error => error.statusCode === 403)
  f.set({ gm: true })
  await f.requireEntityAccess({}, 'map', { campaignId: 'campaign' }, true)
  await f.requireEntityAccess({}, 'map', { campaignId: null })
  await assert.rejects(f.requireEntityAccess({}, 'map', { campaignId: null }, true), error => error.statusCode === 403)
})
