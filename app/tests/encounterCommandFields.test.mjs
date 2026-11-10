import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const saved = Object.fromEntries(['createError', 'getRouterParam', 'readBody'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of Object.entries(saved)) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const validation = loadTypeScript('server/utils/encounterCommandFields.ts')
function validate(operation, body) {
  globalThis.createError = value => Object.assign(new Error(value.message), value)
  return validation.validateEncounterCommandFields(operation, body)
}
for (const [operation, payload] of [
  ['direct', { participantId: 'actor', targetDigimonId: 'partner', bolstered: true }],
  ['mode-change', { participantId: 'actor', newSwaps: { damage: 'armor', armor: 'damage' } }],
  ['stance', { participantId: 'actor', stance: 'offensive', operationId: 'change' }],
  ['gm-digivolve', { participantId: 'actor', targetChainIndex: 1, operationId: 'evolve' }],
]) test(`${operation} rejects unexpected authority fields even when the requester is a GM`, () => {
  validate(operation, payload)
  for (const field of ['force', 'noActionCost', 'campaignId', 'ownerId', 'skipActionDeduction']) {
    assert.throws(() => validate(operation, { ...payload, [field]: true }), { statusCode: 400 })
  }
})
test('numeric commands reject string coercion, fractional costs and nonfinite values', () => {
  for (const amount of ['5', 1.5, NaN, Infinity]) assert.throws(() => validate('grant-inspiration', { participantId: 'actor', amount }), { statusCode: 400 })
})
test('player responses have operation-specific fields and finite dice', () => {
  const body = { requestId: 'request', tamerId: 'tamer', response: { type: 'dodge-rolled', participantId: 'actor', dodgeDicePool: 2, dodgeSuccesses: 1, dodgeDiceResults: [2, 6], timestamp: new Date().toISOString() } }
  validate('response', body)
  assert.throws(() => validate('response', { ...body, response: { ...body.response, rookieDigimonId: 'foreign' } }), { statusCode: 400 })
  assert.throws(() => validate('response', { ...body, response: { ...body.response, dodgeSuccesses: '99' } }), { statusCode: 400 })
  assert.throws(() => validate('response', { ...body, response: { type: 'constructor' } }), { statusCode: 400 })
  assert.throws(() => validate('response', { ...body, response: { ...body.response, dodgeDiceResults: [8] } }), { statusCode: 400 })
})
test('the real command wrapper rejects extra fields before entering a transaction', async () => {
  let calls = 0
  const wrapper = loadTypeScriptWithMocks('server/utils/encounterCommand.ts', {
    h3: { defineEventHandler: work => work, getRouterParam: () => 'enc', getMethod: () => 'POST', getRequestURL: () => new URL('http://localhost/api/encounters/enc/actions/direct'), readBody: async event => event.body },
    './attackCommand': { runAttackCommand: async () => { calls++ } },
  }).defineEncounterCommand(async () => {})
  validate('direct', {})
  await assert.rejects(wrapper({ body: { participantId: 'actor', force: true } }), { statusCode: 400 })
  assert.equal(calls, 0)
  await wrapper({ body: { participantId: 'actor', targetDigimonId: 'partner' } })
  assert.equal(calls, 1)
})
test('the log endpoint accepts client retry metadata but stores server identity without that metadata', async () => {
  const actor = { id: 'actor', entityId: 'record', type: 'digimon' }
  const encounter = { id: 'enc', round: 2, participants: [actor], battleLog: [] }
  let written
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async event => event.body
  const route = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/log.post.ts', {
    '../../../../utils/encounterCommand': { defineEncounterCommand: work => async event => { validate('log', event.body); return work(event) } },
    '../../../../db': { encounters: { id: 'id' }, db: { select: () => ({ from: () => ({ where: async () => [encounter] }) }), update: () => ({ set: value => { written = value; return { where: () => ({ returning: async () => [{ ...encounter, ...value }] }) } } }) } },
    '../../../../utils/encounterAuthorization': { authorizeEncounterIntent: async () => ({ access: { isDm: false } }) },
    '../../../../utils/participantActionLog': { createParticipantActionLog: async (_enc, actual) => { assert.equal(actual, actor); return { actorId: actor.id, actorName: 'Stored Agumon' } } },
  }).default
  await route({ body: { actorId: 'actor', actorName: 'Forged', action: 'Dice', result: 'Manual roll', operationId: 'retry-log', expectedRevision: 4 } })
  const entry = written.battleLog[0]
  assert.equal(entry.actorName, 'Stored Agumon')
  assert.equal(entry.round, 2)
  assert.equal(entry.operationId, undefined)
  assert.equal(entry.expectedRevision, undefined)
})
