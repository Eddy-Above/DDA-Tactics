import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})
const copy = value => structuredClone(value)
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function server() {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = (event, key) => key === 'id' ? 'encounter' : event[key]
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps']
    .map(name => [name, { name, id: name }]))
  const request = id => ({ id, type: 'dodge-roll', targetTamerId: 'tamer-1', targetParticipantId: id, data: {} })
  let stored = {
    id: 'encounter', campaignId: null, phase: 'combat', round: 1,
    participants: [], turnOrder: [], currentTurnIndex: 0, battleLog: [],
    pendingRequests: [{ ...request('old'), answeredAt: 'then' }, request('incoming')],
    requestResponses: [{ id: 'old-response', requestId: 'old' }],
  }
  let nextReadGate
  const reads = []
  const db = {
    select: () => ({ from: table => ({ where: async () => {
      assert.equal(table, tables.encounters)
      const snapshot = copy(stored)
      reads.push(snapshot)
      if (nextReadGate) {
        const gate = nextReadGate
        nextReadGate = undefined
        gate.entered.resolve()
        await gate.release.promise
      }
      return [snapshot]
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      assert.equal(table, tables.encounters)
      stored = { ...stored, ...copy(fields) }
    } }) }),
  }
  const queue = loadTrustedGameplayModule('server/utils/intercedeClaims.ts', {})
  const common = {
    'drizzle-orm': { eq: () => ({}) },
    '../../../../db': { db, ...tables },
    '../../../../utils/intercedeClaims': queue,
  }
  const deleteRequest = loadTrustedGameplayModule('server/api/encounters/[id]/requests/[requestId].delete.ts', common).default
  const deleteResponse = loadTrustedGameplayModule('server/api/encounters/[id]/responses/[responseId].delete.ts', common).default
  const createRequest = loadTrustedGameplayModule('server/api/encounters/[id]/requests.post.ts', {
    'drizzle-orm': common['drizzle-orm'], '../../../db': { db, ...tables }, '../../../utils/intercedeClaims': queue,
  }).default
  const unexpected = new Proxy({}, { get: (_target, name) => () => { throw new Error(`unexpected ${String(name)}`) } })
  const submit = loadTrustedGameplayModule('server/api/encounters/[id]/responses.post.ts', {
    'drizzle-orm': { eq: () => ({}), inArray: () => ({}) },
    '../../../db': { db, ...tables },
    '../../../utils/intercedeClaims': queue,
    ...Object.fromEntries([
      'pushPull', 'applyEffect', 'resolveSupportAttack', 'triggerCounterattack', 'resolveNpcAttack',
      'selectiveTargeting', 'digizoidArmor', 'clashArmor', 'damageOverTime', 'enemyKnockouts', 'guidingLight',
    ].map(name => [`../../../utils/${name}`, unexpected])),
  }).default
  return {
    reads, state: () => copy(stored),
    holdNextRead() {
      nextReadGate = { entered: deferred(), release: deferred() }
      return nextReadGate
    },
    deleteRequest: requestId => deleteRequest({ requestId }),
    deleteResponse: responseId => deleteResponse({ responseId }),
    createRequest: () => createRequest({ body: { type: 'recovery-check', targetTamerId: 'tamer-1' } }),
    submit: () => submit({ body: {
      requestId: 'incoming', tamerId: 'tamer-1',
      response: { type: 'dodge-rolled', dodgeDicePool: 1, dodgeSuccesses: 1, dodgeDiceResults: [6] },
    } }),
  }
}

for (const kind of ['request', 'response']) {
  test(`${kind} cleanup cannot overwrite a defense submitted while cleanup is waiting`, async () => {
    const f = server()
    const gate = f.holdNextRead()
    const cleanup = kind === 'request' ? f.deleteRequest('old') : f.deleteResponse('old-response')
    await gate.entered.promise
    const submission = f.submit()
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(f.reads.length, 1, 'the defense waits until cleanup releases the encounter queue')
    } finally {
      gate.release.resolve()
    }
    await Promise.all([cleanup, submission])
    const state = f.state()
    assert.ok(state.pendingRequests.find(request => request.id === 'incoming').answeredAt)
    assert.equal(state.requestResponses.filter(response => response.requestId === 'incoming').length, 1)
    if (kind === 'request') assert.equal(state.pendingRequests.some(request => request.id === 'old'), false)
    else assert.equal(state.requestResponses.some(response => response.id === 'old-response'), false)
    // A retry sees the surviving answered stamp and cannot append another response.
    await f.submit()
    assert.equal(f.state().requestResponses.filter(response => response.requestId === 'incoming').length, 1)
  })
}

test('two request cleanups and a newly created prompt preserve each other changes', async () => {
  const f = server()
  const gate = f.holdNextRead()
  const first = f.deleteRequest('old')
  await gate.entered.promise
  const second = f.deleteRequest('incoming')
  const created = f.createRequest()
  gate.release.resolve()
  await Promise.all([first, second, created])
  assert.deepEqual(f.state().pendingRequests.map(request => request.type), ['recovery-check'])
})
