import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { useMapAutosave } = loadTypeScript('composables/useMapAutosave.ts')
const { useMap } = loadTypeScript('composables/useMap.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'getQuery', 'createError', '$fetch']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
const queues = []
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose()
  mock.timers.reset()
  for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value
})

const map = (voxels = [], other = {}) => ({ id: 'map', updatedAt: 'old', voxels, groundTiles: [], spaceTiles: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [], ...other })
const voxel = (x, extra = {}) => ({ x, y: 0, z: 0, materialId: 'earth', ...extra })
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture(save = async id => ({ id, updatedAt: 'saved' })) {
  const requests = [], notifications = []
  const queue = useMapAutosave({ save: async (id, patch) => { requests.push({ id, patch }); return await save(id, patch) },
    onSaved: (...args) => notifications.push(args) })
  queues.push(queue)
  return { queue, requests, notifications }
}

test('autosave coalesces changed immutable collections after 300ms and serializes only the transmitted batch', async () => {
  const f = fixture()
  let serializations = 0
  const first = [voxel(0)]
  first.toJSON = () => { serializations++; return [voxel(0)] }
  f.queue.enqueue(map(first), ['voxels'], 'voxel')
  assert.equal(f.queue.status.value, 'pending')
  assert.equal(serializations, 0)
  mock.timers.tick(200)
  f.queue.enqueue(map([voxel(0), voxel(1)], { doors: [{ id: 'door', wallId: 'wall', isOpen: true }] }), ['voxels', 'doors'], 'door')
  mock.timers.tick(299)
  await settle()
  assert.equal(f.requests.length, 0)
  mock.timers.tick(1)
  await settle()
  assert.equal(serializations, 0, 'the superseded pending collection was never serialized')
  assert.deepEqual(f.requests[0].patch, { voxels: [voxel(0), voxel(1)], doors: [{ id: 'door', wallId: 'wall', isOpen: true }] })
  assert.equal(f.queue.status.value, 'saved')
  assert.equal(f.notifications.length, 1)
  assert.deepEqual(f.notifications[0][2], ['voxel', 'door'])
})

test('continuous edits reach the 1500ms maximum delay without creating extra requests', async () => {
  const f = fixture()
  f.queue.enqueue(map([voxel(0)]), ['voxels'])
  for (let i = 1; i <= 7; i++) {
    mock.timers.tick(200)
    f.queue.enqueue(map([voxel(i)]), ['voxels'])
  }
  mock.timers.tick(99)
  await settle()
  assert.equal(f.requests.length, 0)
  mock.timers.tick(1)
  await settle()
  assert.equal(f.requests.length, 1)
  assert.deepEqual(f.requests[0].patch.voxels, [voxel(7)])
  assert.equal(f.queue.hasUnsaved.value, false)
})

test('one request per map stays in flight while newer edits queue and only acknowledged edits broadcast', async () => {
  const first = deferred(), second = deferred()
  let saves = 0
  const f = fixture(() => (++saves === 1 ? first.promise : second.promise))
  f.queue.enqueue(map([voxel(0, { tags: ['first'] })]), ['voxels'], 'first')
  mock.timers.tick(300)
  await settle()
  f.queue.enqueue(map([voxel(1, { tags: ['newer'] })]), ['voxels'], 'second')
  mock.timers.tick(2000)
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.notifications.length, 0)
  assert.equal(f.queue.status.value, 'saving')
  first.resolve({ id: 'map', updatedAt: 'one' })
  await settle()
  assert.equal(f.requests.length, 2)
  assert.deepEqual(f.requests[0].patch.voxels, [voxel(0, { tags: ['first'] })])
  assert.deepEqual(f.requests[1].patch.voxels, [voxel(1, { tags: ['newer'] })])
  assert.deepEqual(f.notifications[0][2], ['first'])
  assert.equal(f.queue.hasUnsaved.value, true)
  second.resolve({ id: 'map', updatedAt: 'two' })
  assert.equal(await f.queue.flush(), true)
  assert.equal(f.queue.status.value, 'saved')
  assert.deepEqual(f.notifications[1][2], ['second'])
})

test('failed saves retain latest edits and notifications until retry succeeds', async () => {
  const first = deferred()
  let saves = 0
  const f = fixture(id => ++saves === 1 ? first.promise : Promise.resolve({ id, updatedAt: 'retry' }))
  f.queue.enqueue(map([voxel(0)]), ['voxels'], 'first')
  mock.timers.tick(300)
  await settle()
  f.queue.enqueue(map([voxel(1)], { doors: [{ id: 'd', wallId: 'w', isOpen: true }] }), ['voxels', 'doors'], 'second')
  first.reject(new Error('offline'))
  await settle()
  assert.equal(f.queue.status.value, 'error')
  assert.equal(f.queue.error.value, 'offline')
  assert.equal(f.notifications.length, 0)
  mock.timers.tick(10_000)
  await settle()
  assert.equal(f.requests.length, 1, 'failure does not create an uncontrolled retry loop')
  assert.equal(await f.queue.retry(), true)
  assert.deepEqual(f.requests[1].patch.voxels, [voxel(1)])
  assert.deepEqual(f.requests[1].patch.doors, [{ id: 'd', wallId: 'w', isOpen: true }])
  assert.deepEqual(new Set(f.notifications[0][2]), new Set(['first', 'second']))
  assert.equal(f.queue.hasUnsaved.value, false)
})

test('flush waits for all queued edits and a failed flush stays unsaved', async () => {
  const f = fixture(async () => { throw new Error('cannot save') })
  f.queue.enqueue(map([voxel(0)]), ['voxels'])
  assert.equal(await f.queue.flush(), false)
  assert.equal(f.queue.hasUnsaved.value, true)
  assert.equal(f.queue.status.value, 'error')
})

test('different maps have independent queues and disposal cancels timers without reporting saved', async () => {
  const f = fixture()
  f.queue.enqueue(map([voxel(0)]), ['voxels'])
  f.queue.enqueue(map([], { id: 'other', doors: [{ id: 'd', wallId: 'w', isOpen: true }] }), ['doors'])
  assert.equal(await f.queue.flush('other'), true)
  assert.deepEqual(f.requests.map(r => r.id), ['other'])
  assert.equal(f.queue.hasUnsaved.value, true)
  f.queue.dispose()
  mock.timers.tick(10_000)
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.queue.status.value, 'pending')
})

test('map compact saves cannot replace newer local state, and failed/stale loads keep the latest map', async () => {
  const oldFetch = deferred(), newFetch = deferred()
  const requests = []
  globalThis.$fetch = (url, options) => {
    requests.push({ url, options })
    if (url.includes('return=minimal')) return Promise.resolve({ id: 'map', updatedAt: 'ack' })
    return requests.filter(r => !r.url.includes('return=minimal')).length === 1 ? oldFetch.promise : newFetch.promise
  }
  const store = useMap()
  store.currentMap.value = map([voxel(9)])
  await store.updateMapMinimal('map', { voxels: [voxel(0)] })
  assert.equal(store.currentMap.value.voxels[0].x, 9)
  const older = store.fetchMap('old'), newer = store.fetchMap('map')
  newFetch.resolve(map([voxel(2)]))
  await newer
  oldFetch.resolve(map([voxel(1)], { id: 'old' }))
  await older
  assert.equal(store.currentMap.value.id, 'map')
  assert.equal(store.currentMap.value.voxels[0].x, 2)
  globalThis.$fetch = async () => { throw new Error('network failed') }
  assert.equal(await store.fetchMap('map'), null)
  assert.equal(store.currentMap.value.voxels[0].x, 2)
  assert.equal(store.error.value, 'network failed')
})

function endpointFixture() {
  let row = map([voxel(0)]), writes = 0, reads = 0
  const columns = { id: { key: 'id' }, updatedAt: { key: 'updatedAt' } }
  const db = {
    select() { reads++; throw new Error('a full-row read is unnecessary') },
    update() { return { set(patch) { return { where(condition) { return { returning: async projection => {
      writes++
      if (!row || row.id !== condition.value) return []
      row = { ...row, ...patch }
      return [projection ? Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[column.key]])) : row]
    } } } } } } },
  }
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.mapId ?? 'map'
  globalThis.readBody = async event => event.body
  globalThis.getQuery = event => event.query ?? {}
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const handler = loadTypeScriptWithMocks('server/api/maps/[mapId].put.ts', {
    '../../db': { db, maps: columns }, 'drizzle-orm': { eq: (column, value) => ({ column, value }) },
  }).default
  return { handler, remove: () => { row = null }, get writes() { return writes }, get reads() { return reads } }
}

test('map PUT returns only an acknowledgement when requested and uses one update without full-map reads', async () => {
  const f = endpointFixture()
  const result = await f.handler({ query: { return: 'minimal' }, body: { voxels: [voxel(4)] } })
  assert.deepEqual(Object.keys(result).sort(), ['id', 'updatedAt'])
  assert.equal(result.id, 'map')
  assert.ok(result.updatedAt instanceof Date)
  assert.equal(f.writes, 1)
  assert.equal(f.reads, 0)
})

test('map PUT keeps the default full-map response and reports missing maps', async () => {
  const f = endpointFixture()
  const result = await f.handler({ body: { voxels: [voxel(5, { shape: 'ramp', rampDirection: 'west' })] } })
  assert.equal(result.voxels[0].rampDirection, 'west')
  assert.deepEqual(result.groundTiles, [])
  f.remove()
  await assert.rejects(f.handler({ body: { doors: [] } }), error => error.statusCode === 404)
})
