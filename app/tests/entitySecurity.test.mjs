import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = globalThis.createError
afterEach(() => { if (original === undefined) delete globalThis.createError; else globalThis.createError = original })
function fixture() {
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const rows = { tamers: [{ id: 'private-tamer', campaignId: 'private' }, { id: 'owned', campaignId: null, ownerId: 'owner' }], digimon: [{ id: 'private-mon', campaignId: 'private' }, { id: 'owned-mon', campaignId: null, ownerId: 'owner' }], evolutionLines: [] }
  let user = null, admitted = false, gm = false
  const tables = Object.fromEntries(['tamers', 'digimon', 'maps', 'evolutionLines'].map(name => [name, { name, id: 'id' }]))
  const reads = []
  const store = { ...tables, db: { select: () => ({ from: table => ({ where: async id => {
    reads.push(table.name)
    return (rows[table.name] ?? []).filter(row => id === undefined || (Array.isArray(id) ? id.includes(row.id) : row.id === id))
  } }) }) } }
  const sql = { eq: (_field, id) => id, inArray: (_field, ids) => ids }
  const graph = loadTypeScriptWithMocks('server/utils/entityScopeGraph.ts', { '../db': store, 'drizzle-orm': sql })
  const access = id => ({ campaign: { id }, isMember: admitted, isDm: gm, userId: user?.id ?? null })
  const requireMember = async (_event, id) => { if (!admitted) throw Object.assign(new Error('denied'), { statusCode: 401 }); return access(id) }
  const helper = loadTypeScriptWithMocks('server/utils/entitySecurity.ts', {
    '../db': store,
    'drizzle-orm': sql,
    './entityScopeGraph': graph,
    './session': { getSessionUser: async () => user },
    './campaignSecurity': {
      requireCampaignMember: requireMember,
      requireCampaignDm: async (...args) => { const result = await requireMember(...args); if (!gm) throw Object.assign(new Error('GM required'), { statusCode: 403 }); return result },
      resolveCampaignAccess: async (_event, id) => access(id),
      assertCanControlTamer: async () => { if (!admitted) throw Object.assign(new Error('denied'), { statusCode: 401 }) },
    },
  })
  return { ...helper, rows, reads, set: values => { if ('user' in values) user = values.user; if ('admitted' in values) admitted = values.admitted; if ('gm' in values) gm = values.gm } }
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

test('campaign maps need GM permission and workshop maps follow ownership', async () => {
  const f = fixture()
  f.set({ admitted: true })
  await assert.rejects(f.requireEntityAccess({}, 'map', { campaignId: 'campaign' }, true), error => error.statusCode === 403)
  f.set({ gm: true })
  await f.requireEntityAccess({}, 'map', { campaignId: 'campaign' }, true)
  await f.requireEntityAccess({}, 'map', { campaignId: null })
  await f.requireEntityAccess({}, 'map', { campaignId: null }, true)
  const owned = { id: 'workshop', campaignId: null, ownerId: 'owner', hidden: false }
  await f.requireEntityAccess({}, 'map', owned)
  await assert.rejects(f.requireEntityAccess({}, 'map', owned, true), { statusCode: 403 })
  owned.hidden = true
  await assert.rejects(f.requireEntityAccess({}, 'map', owned), { statusCode: 404 })
  assert.deepEqual(await f.filterReadableEntities({}, [owned], 'map'), [])
  f.set({ user: { id: 'owner' } })
  await f.requireEntityAccess({}, 'map', owned, true)
  assert.deepEqual(await f.filterReadableEntities({}, [owned], 'map'), [owned])
})

test('unpartnered legacy forms inherit a private evolution line for direct reads, writes and lists', async () => {
  const f = fixture()
  const legacy = { id: 'legacy-unpartnered', campaignId: null, partnerId: null }
  f.rows.digimon.push(legacy)
  f.rows.evolutionLines.push({ id: 'private-line', campaignId: 'private', chain: [{ digimonId: legacy.id }] })
  assert.equal(await f.entityCampaignId('digimon', legacy), 'private')
  for (const write of [false, true]) await assert.rejects(f.requireEntityAccess({}, 'digimon', legacy, write), { statusCode: 401 })
  await assert.rejects(f.requireLinkedEntity({}, 'digimon', legacy.id, null), { statusCode: 400 })
  assert.deepEqual(await f.filterReadableEntities({}, [legacy, { id: 'public', campaignId: null }], 'digimon'), [{ id: 'public', campaignId: null }])
  f.set({ admitted: true, gm: true })
  await f.requireEntityAccess({}, 'digimon', legacy, true)
})

test('nullable Workshop graphs remain public and cyclic/shared lines reject conflicting anchors', async () => {
  const f = fixture()
  const forms = [{ id: 'one', campaignId: null }, { id: 'two', campaignId: null }]
  f.rows.digimon.push(...forms)
  f.rows.evolutionLines.push(
    { id: 'line-one', campaignId: null, chain: forms.map(form => ({ digimonId: form.id })) },
    { id: 'line-two', campaignId: null, chain: forms.map(form => ({ digimonId: form.id })) },
  )
  assert.equal(await f.entityCampaignId('digimon', forms[0]), null)
  await f.requireEntityAccess({}, 'digimon', forms[0], true)
  f.rows.evolutionLines[0].campaignId = 'one-campaign'
  f.rows.evolutionLines[1].campaignId = 'another-campaign'
  await assert.rejects(f.entityCampaignId('digimon', forms[0]), { statusCode: 400 })
})

test('filtered legacy form lists share one associated-line metadata read and batched records', async () => {
  const f = fixture()
  const forms = Array.from({ length: 50 }, (_, index) => ({ id: `legacy-${index}`, campaignId: null }))
  f.rows.digimon.push(...forms)
  f.rows.evolutionLines.push(...forms.map((form, index) => ({ id: `line-${index}`, campaignId: 'private', chain: [{ digimonId: form.id }] })))
  assert.deepEqual(await f.filterReadableEntities({}, forms, 'digimon'), [])
  assert.equal(f.reads.filter(table => table === 'evolutionLines').length, 1)
  assert.equal(f.reads.filter(table => table === 'digimon').length, 0, 'the list already supplied every required form')
})
