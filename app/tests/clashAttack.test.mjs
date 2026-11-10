import assert from 'node:assert/strict'
import test from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript, loadVueComponent } from './helpers/loadTypeScript.mjs'

const { useClashAttack } = loadTypeScript('composables/useClashAttack.ts')
const ClashAttackDialog = loadVueComponent('components/ClashAttackDialog.vue')

const melee = { id: 'basic-melee', name: 'Basic Melee', range: 'melee', type: 'damage', tags: [], description: '' }
const charge = { ...melee, id: 'charge', name: 'Charge', tags: ['Charge Attack'] }
const pass = { ...melee, id: 'pass', name: 'Pass', tags: ['Charge Attack', 'Area Attack: Pass'] }
const ranged = { ...melee, id: 'basic-ranged', name: 'Basic Ranged', range: 'ranged' }

function makeFlow(overrides = {}) {
  const actor = {
    id: 'controller', type: 'digimon', entityId: 'digimon',
    clash: { clashId: 'clash', isController: true, opponentParticipantId: 'opponent' },
  }
  const opponent = {
    id: 'opponent', type: 'digimon', entityId: 'enemy',
    clash: { clashId: 'clash', isController: false, opponentParticipantId: 'controller' },
  }
  const encounter = { id: 'encounter', participants: [actor, opponent] }
  const calls = []
  const flow = useClashAttack({
    getEncounter: () => encounter,
    getParticipantAttacks: () => [melee, ranged, charge, pass],
    getAttackStats: () => ({ accuracy: 4 }),
    submitAttack: async (encounterId, body) => { calls.push({ kind: 'submit', encounterId, body }) },
    refreshEncounter: async encounterId => { calls.push({ kind: 'refresh', encounterId }) },
    beginAreaAttack: (participant, attack) => { calls.push({ kind: 'area', participant, attack }) },
    beginChargeMove: participantId => { calls.push({ kind: 'move', participantId }) },
    onError: message => { calls.push({ kind: 'error', message }) },
    ...overrides,
  })
  return { flow, actor, encounter, calls }
}

test('only a clash controller opens the picker; available melee options include Basic Melee', () => {
  const { flow } = makeFlow()
  flow.startClashAttack('missing')
  flow.startClashAttack('opponent')
  assert.equal(flow.clashAttackActorId.value, null)
  flow.startClashAttack('controller')
  assert.equal(flow.clashAttackParticipant.value.id, 'controller')
  assert.deepEqual(flow.clashAttackOptions.value.map(attack => attack.id), ['basic-melee', 'charge', 'pass'])
})

test('a normal clash attack submits the unmodified accuracy pool and refreshes after resolution', async t => {
  const dice = [0, 0.66, 0.67, 0.99]
  t.mock.method(Math, 'random', () => dice.shift())
  const { flow, actor, calls } = makeFlow()
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, melee)
  assert.equal(flow.clashAttackActorId.value, null)
  assert.deepEqual(calls, [
    { kind: 'submit', encounterId: 'encounter', body: {
      operationId: calls[0].body.operationId,
      clashId: 'clash', participantId: 'controller', tamerId: undefined, actionType: 'attack',
      attackId: 'basic-melee', attackName: 'Basic Melee', accuracySuccesses: 2,
      accuracyDiceResults: [1, 4, 5, 6], accuracyDicePool: 4, endClash: false,
    } },
    { kind: 'refresh', encounterId: 'encounter' },
  ])
})

test('tamer attacks retain the actor tamer entity id', async () => {
  const { flow, actor, calls } = makeFlow()
  actor.type = 'tamer'
  actor.entityId = 'tamer-entity'
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, melee)
  assert.equal(calls[0].body.tamerId, 'tamer-entity')
})

test('retrying a lost Clash attack response reuses the exact command and dice', async () => {
  const attempts = []
  const { flow, actor } = makeFlow({ submitAttack: async (_id, body) => {
    attempts.push(structuredClone(body))
    if (attempts.length === 1) throw new Error('Reply lost')
  } })
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, melee)
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, melee)
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1], attempts[0])
})

test('Charge waits for a choice; attack and stay keeps the clash and does not move', async () => {
  const { flow, actor, calls } = makeFlow()
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, charge)
  assert.equal(flow.clashChargeChoice.value.attack.id, 'charge')
  assert.equal(calls.length, 0)
  await flow.chooseClashCharge(false)
  assert.equal(flow.clashChargeChoice.value, null)
  assert.equal(calls[0].body.endClash, false)
  assert.deepEqual(calls.map(call => call.kind), ['submit', 'refresh'])
})

test('Charge attack and move ends the clash, refreshes, then starts the free map move', async () => {
  const { flow, actor, calls } = makeFlow()
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, charge)
  await flow.chooseClashCharge(true)
  assert.equal(calls[0].body.endClash, true)
  assert.deepEqual(calls.map(call => call.kind), ['submit', 'refresh', 'move'])
  assert.equal(calls[2].participantId, actor.id)
})

test('Back and Cancel leave the encounter unchanged and clear a pending Charge choice', async () => {
  const { flow, actor, calls } = makeFlow()
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, charge)
  flow.backToClashAttacks()
  assert.equal(flow.clashChargeChoice.value, null)
  assert.equal(flow.clashAttackActorId.value, actor.id)
  await flow.pickClashAttack(actor, charge)
  flow.cancelClashAttack()
  assert.equal(flow.clashChargeChoice.value, null)
  assert.equal(flow.clashAttackActorId.value, null)
  await flow.chooseClashCharge(true)
  assert.equal(calls.length, 0)
})

test('Pass uses area aiming with the forced opponent context instead of the Charge choice or single-target endpoint', async () => {
  const { flow, actor, calls } = makeFlow()
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, pass)
  assert.equal(flow.clashAttackActorId.value, null)
  assert.equal(flow.clashChargeChoice.value, null)
  assert.deepEqual(flow.clashAreaAttack.value, { controllerId: actor.id, opponentId: 'opponent' })
  assert.deepEqual(calls, [{ kind: 'area', participant: actor, attack: pass }])
})

test('the player readiness guard prevents submission while its tamer is unavailable', async () => {
  const { flow, actor, calls } = makeFlow({ canAct: () => false })
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, melee)
  assert.equal(calls.length, 0)
  assert.equal(flow.clashAttackActorId.value, actor.id)
})

test('a rejected attack reports the server message and never starts a Charge move', async () => {
  const { flow, actor, calls } = makeFlow({ submitAttack: async () => { throw { data: { message: 'Not enough actions' } } } })
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, charge)
  await flow.chooseClashCharge(true)
  assert.deepEqual(calls, [{ kind: 'error', message: 'Not enough actions' }])
})

test('a failed refresh keeps the follow-up Charge move from using stale encounter state', async () => {
  const { flow, actor, calls } = makeFlow({ refreshEncounter: async () => { throw new Error('offline') } })
  flow.startClashAttack(actor.id)
  await flow.pickClashAttack(actor, charge)
  await flow.chooseClashCharge(true)
  assert.deepEqual(calls.map(call => call.kind), ['submit', 'error'])
  assert.equal(calls[1].message, 'Failed to execute clash attack')
})

async function renderDialog(props) {
  const context = {}
  await renderToString(createSSRApp({ render: () => h(ClashAttackDialog, props) }), context)
  return context.teleports?.body ?? ''
}

test('the shared picker shows attack badges and the existing half-dodge explanation', async () => {
  const attack = { ...melee, name: 'Blazing Pass', tags: ['Charge Attack', 'Area Attack: Pass', 'Armor Piercing II'], effect: 'Burn' }
  const html = await renderDialog({ open: true, attacks: [attack], chargeAttack: null })
  for (const text of ['Blazing Pass', 'Pass', 'Charge', 'AP II', 'Burn', 'half their Dodge pool', 'Cancel']) {
    assert.ok(html.includes(text), `expected picker to include ${text}`)
  }
  assert.ok(!html.includes('Attack &amp; stay'))
})

test('the Charge choice displays stay, move and Back while hiding the attack list', async () => {
  const html = await renderDialog({ open: true, attacks: [melee], chargeAttack: charge })
  for (const text of ['Attack &amp; stay', 'Attack &amp; move', 'ends the clash', 'Back']) {
    assert.ok(html.includes(text), `expected Charge choice to include ${text}`)
  }
  assert.ok(!html.includes('Basic Melee'))
  assert.ok(!html.includes('>Cancel<'))
})

test('an empty picker explains the lack of melee attacks; a closed picker hides its contents', async () => {
  const empty = await renderDialog({ open: true, attacks: [], chargeAttack: null })
  assert.ok(empty.includes('No melee attacks available.'))
  const closed = await renderDialog({ open: false, attacks: [melee], chargeAttack: null })
  assert.ok(!closed.includes('Clash Attack'))
})
