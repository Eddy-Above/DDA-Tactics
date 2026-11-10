import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const scope = loadTypeScript('server/utils/databaseScope.ts')
const position = x => ({ x, y: 0, z: 0 })
function fixture() {
  const updates = [], sent = []
  let row = { participantPositions: { unit: position(0) }, destructibleStates: [] }
  const control = { failRead: false, failWrite: false, commits: 0 }
  const database = (read, write) => ({
    select: () => ({ from: () => ({ where: () => ({
      for: async () => { if (control.failRead) throw new Error('Read failed'); return [structuredClone(read())] },
      then: (done, fail) => (control.failRead ? Promise.reject(new Error('Read failed')) : Promise.resolve([structuredClone(read())])).then(done, fail),
    }) }) }),
    update: () => ({ set: value => ({ where: async () => {
      if (control.failWrite) throw new Error('Persistence failed')
      write(structuredClone(value))
    } }) }),
  })
  const live = database(() => row, value => { updates.push(value); Object.assign(row, value) })
  live.transaction = async work => {
    const staged = structuredClone(row), writes = []
    const result = await work(database(() => staged, value => { writes.push(value); Object.assign(staged, value) }))
    row = staged; updates.push(...writes); control.commits++
    return result
  }
  const db = new Proxy({}, { get: (_target, key) => (scope.scopedDatabase() ?? live)[key] })
  const room = loadTypeScriptWithMocks('server/utils/encounterRoom.ts', { '../db': { db, encounters: { id: 'id' } }, 'drizzle-orm': { eq: (_id, value) => value }, './databaseScope': scope })
  const peer = { send: raw => sent.push({ ...JSON.parse(raw), durable: structuredClone(row) }), _securityCanReceive: () => true }
  const commit = async work => {
    const callbacks = []
    const result = await live.transaction(tx => scope.withDatabase(tx, work, callbacks))
    for (const publish of callbacks) await publish()
    return result
  }
  return { room, db, updates, sent, peer, control, commit, row: () => structuredClone(row) }
}

test('committed positions are visible within the transaction and published only after commit, without another durability write', async () => {
  const f = fixture(); await f.room.joinRoom('enc', f.peer)
  const callbacks = []
  await scope.withDatabase(f.db, async () => {
    await f.room.publishCommittedPositions('enc', { unit: position(2) })
    assert.deepEqual(await f.room.getRoomPositions('enc'), { unit: position(2) })
    assert.equal((await f.room.getRoomSnapshot('enc')).version, 1)
    assert.equal(f.sent.length, 0)
  }, callbacks)
  assert.deepEqual(await f.room.getRoomPositions('enc'), { unit: position(0) })
  for (const publish of callbacks) await publish()
  assert.deepEqual(await f.room.getRoomPositions('enc'), { unit: position(2) })
  assert.equal(f.sent.length, 1)
  assert.equal(f.updates.length, 0)
  f.room.leaveRoom('enc', f.peer)
})

test('rolled-back position and structure changes cannot leak into live rooms or peers', async () => {
  const f = fixture(); await f.room.joinRoom('enc', f.peer)
  const callbacks = []
  await assert.rejects(f.commit(async () => {
    await f.room.broadcastPositionPatch('enc', { unit: position(8) })
    await f.room.applyStructureDamaged('enc', 'wall', 0)
    f.room.broadcast('enc', { type: 'encounter-updated', encounterId: 'enc' })
    assert.deepEqual((await f.room.getRoomSnapshot('enc')).destructibleStates, [{ structureId: 'wall', currentWounds: 0 }])
    throw new Error('Rollback')
  }), /Rollback/)
  assert.deepEqual(await f.room.getRoomPositions('enc'), { unit: position(0) })
  assert.deepEqual(await f.room.getRoomDestructibleStates('enc'), [])
  assert.equal(f.sent.length, 0); assert.equal(f.updates.length, 0)
  f.room.leaveRoom('enc', f.peer)
})

test('forced movement and structure damage are durable in the command transaction before peers receive them', async () => {
  const f = fixture(); await f.room.joinRoom('enc', f.peer)
  await f.commit(async () => {
    await f.room.broadcastPositionPatch('enc', { unit: position(3) })
    const version = await f.room.applyStructureDamaged('enc', 'wall', 1)
    f.room.broadcast('enc', { type: 'structure-damaged', structureId: 'wall', version })
    assert.equal(f.sent.length, 0)
    assert.deepEqual(f.row().participantPositions, { unit: position(0) })
  })
  assert.deepEqual(f.row().participantPositions, { unit: position(3) })
  assert.deepEqual(f.row().destructibleStates, [{ structureId: 'wall', currentWounds: 1 }])
  assert.equal(f.updates.length, 2)
  assert.equal(f.sent.length, 2)
  for (const message of f.sent) {
    assert.deepEqual(message.durable.participantPositions, { unit: position(3) })
    assert.deepEqual(message.durable.destructibleStates, [{ structureId: 'wall', currentWounds: 1 }])
  }
  f.room.leaveRoom('enc', f.peer)
  assert.equal(f.updates.length, 2, 'committed changes must not schedule another durability write')
})

test('failed displacement persistence publishes nothing and leaves both durable and live positions unchanged', async () => {
  const f = fixture(); await f.room.joinRoom('enc', f.peer)
  f.control.failWrite = true
  await assert.rejects(f.commit(() => f.room.broadcastPositionPatch('enc', { unit: position(9) })), /Persistence failed/)
  assert.deepEqual(f.row().participantPositions, { unit: position(0) })
  assert.deepEqual(await f.room.getRoomPositions('enc'), { unit: position(0) })
  assert.equal(f.sent.length, 0); assert.equal(f.control.commits, 0)
  f.room.leaveRoom('enc', f.peer)
})

test('actual GM structure WebSocket handler commits before broadcasting and suppresses failed persistence', async () => {
  const originalHandler = globalThis.defineWebSocketHandler, originalOrigin = process.env.APP_ALLOWED_ORIGINS
  const security = loadTypeScript('server/utils/websocketSecurity.ts')
  globalThis.defineWebSocketHandler = handler => handler
  process.env.APP_ALLOWED_ORIGINS = 'https://room.example'
  try {
    for (const fail of [false, true]) {
      const f = fixture()
      f.control.failWrite = fail
      Object.assign(f.peer, { remoteAddress: '127.0.0.80', request: { url: 'https://room.example/api/encounters/enc/ws', headers: new Headers({ origin: 'https://room.example' }) }, closed: [], close(code) { this.closed.push(code) } })
      const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/ws.ts', {
        '../../../db': { db: f.db, encounters: { id: 'id' } }, 'drizzle-orm': { eq: () => null },
        '../../../utils/databaseScope': scope, '../../../utils/encounterRoom': f.room,
        '../../../utils/campaignSecurity': { securityEventFromHeaders: () => ({}), requireEncounterAccess: async () => ({ encounter: { id: 'enc', campaignId: 'campaign', mapId: 'map' }, access: { isMember: true, isDm: true, principalId: 'gm' } }) },
        '../../../utils/combatSpatial': { loadEncounterMap: async () => ({ walls: [{ id: 'wall', woundBoxes: 5 }] }) },
        '../../../utils/intercedeClaims': loadTypeScript('server/utils/intercedeClaims.ts'),
        '../../../utils/websocketSecurity': security,
      }).default
      try {
        await handler.open(f.peer); f.sent.length = 0
        await handler.message(f.peer, { text: () => JSON.stringify({ type: 'structure-damaged', encounterId: 'enc', structureId: 'wall', woundsRemaining: 2 }) })
        if (fail) {
          assert.equal(f.sent.length, 0); assert.deepEqual(f.row().destructibleStates, [])
          assert.deepEqual(await f.room.getRoomDestructibleStates('enc'), [])
          assert.equal(f.control.commits, 0); assert.equal(f.peer.closed[0], 1008)
        } else {
          assert.equal(f.control.commits, 1); assert.equal(f.updates.length, 1)
          assert.equal(f.sent[0].type, 'structure-damaged')
          assert.deepEqual(f.sent[0].durable.destructibleStates, [{ structureId: 'wall', currentWounds: 2 }])
        }
      } finally { security.releaseAuthorizedPeer(f.peer) }
    }
  } finally {
    globalThis.defineWebSocketHandler = originalHandler
    originalOrigin === undefined ? delete process.env.APP_ALLOWED_ORIGINS : process.env.APP_ALLOWED_ORIGINS = originalOrigin
  }
})

test('expired or invalidated peers receive no broadcasts', async () => {
  const f = fixture(); f.peer._securityCanReceive = () => false
  await f.room.joinRoom('enc', f.peer)
  f.room.broadcast('enc', { type: 'encounter-updated', encounterId: 'enc' })
  assert.equal(f.sent.length, 0)
  f.room.leaveRoom('enc', f.peer)
})

test('failed hydration sends no empty full-state and a retry recovers the stored positions', async () => {
  const originalHandler = globalThis.defineWebSocketHandler, originalOrigin = process.env.APP_ALLOWED_ORIGINS
  const security = loadTypeScript('server/utils/websocketSecurity.ts'), f = fixture()
  globalThis.defineWebSocketHandler = handler => handler
  process.env.APP_ALLOWED_ORIGINS = 'https://room.example'
  const makePeer = () => ({ remoteAddress: '127.0.0.81', request: { url: 'https://room.example/api/encounters/enc/ws', headers: new Headers({ origin: 'https://room.example' }) }, closed: [], close(code) { this.closed.push(code) }, send: raw => f.sent.push(JSON.parse(raw)) })
  const failed = makePeer(), retry = makePeer()
  try {
    const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/ws.ts', {
      '../../../db': { db: f.db, encounters: { id: 'id' } }, 'drizzle-orm': { eq: () => null },
      '../../../utils/databaseScope': scope, '../../../utils/encounterRoom': f.room,
      '../../../utils/campaignSecurity': { securityEventFromHeaders: () => ({}), requireEncounterAccess: async () => ({ encounter: { id: 'enc', campaignId: 'campaign' }, access: { isMember: true, isDm: false, principalId: 'guest' } }) },
      '../../../utils/combatSpatial': { loadEncounterMap: async () => null },
      '../../../utils/intercedeClaims': loadTypeScript('server/utils/intercedeClaims.ts'),
      '../../../utils/websocketSecurity': security,
    }).default
    f.control.failRead = true
    await handler.open(failed)
    assert.equal(f.sent.length, 0); assert.equal(failed.closed[0], 1011)
    f.control.failRead = false
    await handler.open(retry)
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'full-state')
    assert.deepEqual(f.sent[0].participantPositions, { unit: position(0) })
    assert.deepEqual(f.row().participantPositions, { unit: position(0) })
  } finally {
    security.releaseAuthorizedPeer(failed); security.releaseAuthorizedPeer(retry)
    globalThis.defineWebSocketHandler = originalHandler
    originalOrigin === undefined ? delete process.env.APP_ALLOWED_ORIGINS : process.env.APP_ALLOWED_ORIGINS = originalOrigin
  }
})
