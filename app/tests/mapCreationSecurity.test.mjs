import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const originals = Object.fromEntries(['defineEventHandler', 'readBody', 'createError'].map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of Object.entries(originals)) value === undefined ? delete globalThis[key] : globalThis[key] = value })
function fixture(admitted = true) {
  Object.assign(globalThis, { defineEventHandler: work => work, readBody: async event => event.body, createError: value => Object.assign(new Error(value.message), value) })
  const writes = []
  const route = loadTypeScriptWithMocks('server/api/maps/index.post.ts', {
    '../../db': { maps: {}, db: { insert: () => ({ values: async value => writes.push(value) }) } },
    '../../utils/session': { getSessionUser: async event => event.user ?? null },
    '../../utils/campaignSecurity': { requireCampaignDm: async (_event, id) => { assert.equal(id, 'campaign'); if (!admitted) throw Object.assign(new Error('GM required'), { statusCode: 403 }) } },
  }).default
  return { route, writes }
}
test('map creation requires campaign GM admission before allocating terrain or writing', async () => {
  const f = fixture(false)
  await assert.rejects(f.route({ body: { name: 'Private', campaignId: 'campaign', dimensions: { width: 20000, depth: 20000 } } }), { statusCode: 403 })
  assert.equal(f.writes.length, 0)
})
test('large maps retain their dimensions and ordinary floor generation without a new size limit', async () => {
  const f = fixture()
  const large = await f.route({ body: { name: 'Large', campaignId: 'campaign', dimensions: { width: 20000, depth: 20000, height: 5000 }, generateGround: false } })
  assert.equal(large.dimensions.width, 20000)
  assert.equal(large.dimensions.height, 5000)
  assert.equal(large.groundTiles.length, 0)
  const filled = await f.route({ body: { name: 'Floor', campaignId: 'campaign', dimensions: { width: 100, depth: 500 }, generateGround: true } })
  assert.equal(filled.groundTiles.length, 50000)
  assert.deepEqual(filled.groundTiles.at(-1), { x: 99, y: 0, z: 499, element: 'void', terrain: 'normal' })
})

test('workshop maps capture the current owner and start publicly shared', async () => {
  const f = fixture()
  const map = await f.route({ user: { id: 'owner' }, body: { name: 'Workshop', dimensions: { width: 4, depth: 4 } } })
  assert.equal(map.campaignId, null)
  assert.equal(map.ownerId, 'owner')
  assert.equal(map.hidden, false)
  assert.equal(map.groundTiles.length, 0)
})

test('new endless maps need no dimensions and start without generated terrain', async () => {
  const f = fixture()
  for (const campaignId of [undefined, 'campaign']) {
    const map = await f.route({ body: { name: 'Endless', campaignId } })
    assert.deepEqual(map.dimensions, { width: 1, depth: 1, height: 1 })
    for (const field of ['groundTiles', 'spaceTiles', 'voxels', 'walls', 'ceilings', 'stairs']) assert.deepEqual(map[field], [])
  }
})
