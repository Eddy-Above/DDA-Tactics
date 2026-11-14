import assert from 'node:assert/strict'
import test from 'node:test'
import { encounterLatencyFixture } from './helpers/encounterLatencyFixture.mjs'

for (const signedIn of [false, true]) for (const [action, body] of [
  ['stance', { stance: 'defensive' }], ['card-move', {}],
  ['log', { actorId: 'actor', actorName: 'Forged', action: 'Skill check', result: 'Success' }],
]) test(`${action} (${signedIn ? 'account' : 'guest'}) reuses locked admission and persists its receipt in one write`, async t => {
  const f = encounterLatencyFixture({ signedIn }); t.after(f.restore)
  const response = await f.invoke(action, body)
  assert.equal(response.trace.filter(item => item.kind === 'write').length, 1)
  assert.ok(response.statements <= (signedIn ? 15 : 13), `query budget exceeded: ${response.statements}`)
  assert.equal(f.rows.encounters[0].participants[0].attackReceipts.length, 1)
  assert.equal(f.rows.encounters[0].battleLog[0].actorName, 'Tai')
})

test('an atomic action receipt still prevents duplicate spending before stale revision checks', async t => {
  const f = encounterLatencyFixture(); t.after(f.restore)
  const body = { stance: 'offensive', operationId: 'retry', expectedRevision: 1 }
  await f.invoke('stance', body)
  const writes = f.trace.filter(item => item.kind === 'write').length
  const retry = await f.invoke('stance', body)
  assert.equal(retry.result.participants[0].actionsRemaining.simple, 1)
  assert.equal(f.trace.filter(item => item.kind === 'write').length, writes)
  await assert.rejects(f.invoke('stance', { ...body, stance: 'defensive' }), { statusCode: 409 })
})

for (const failure of ['failNextWrite', 'failCommit']) test(`${failure} rolls back both the mechanical action and retry receipt`, async t => {
  const f = encounterLatencyFixture(); t.after(f.restore); f.control[failure] = true
  await assert.rejects(f.invoke('stance', { stance: 'offensive', operationId: 'retry' }), /failed/)
  assert.equal(f.rows.encounters[0].participants[0].actionsRemaining.simple, 2)
  assert.equal(f.rows.encounters[0].participants[0].attackReceipts, undefined)
  await f.invoke('stance', { stance: 'offensive', operationId: 'retry' })
  assert.equal(f.rows.encounters[0].participants[0].actionsRemaining.simple, 1)
})
