import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useFatefulIntervention } = loadTypeScript('composables/useFatefulIntervention.ts')
const { useSpecialOrderTargets } = loadTypeScript('composables/useSpecialOrderTargets.ts')
const { useReactionOrders } = loadTypeScript('composables/useReactionOrders.ts')
const { useAreaDefenseBatch } = loadTypeScript('composables/useAreaDefenseBatch.ts')

test('Fateful Intervention pays once before changing dice and retains a roll when payment fails', async () => {
  let accepted = false, payments = 0, result
  const target = { id: 'roll', label: 'Attack', rollType: 'accuracy', baseDicePool: 3, successThreshold: 4, automaticSuccesses: 1,
    isCurrent: () => true, apply: value => { result = value } }
  const fateful = useFatefulIntervention({ rolls: () => [target], willpower: () => 2, cost: () => 5,
    pay: async () => { payments++; return accepted } })
  const choice = { bonusSign: 1, willpowerSign: -1, diceResults: [4, 4, 4, 4, 4, 4] }
  assert.equal(await fateful.confirm('roll', choice), false)
  assert.equal(result, undefined)
  accepted = true
  assert.equal(await fateful.confirm('roll', choice), true)
  assert.equal(result.dicePool, 6)
  assert.equal(result.successes, 7)
  assert.equal(result.successThreshold, 4)
  assert.equal(result.automaticSuccesses, 1)
  assert.equal(result.fatefulIntervention, true)
  assert.equal(payments, 2)
})

test('Fateful checks keep three chosen dice, add signed bonuses, and reject invalid faces before spending', async () => {
  let payments = 0, result
  const target = { id: 'check', label: 'Check', rollType: 'check', baseDicePool: 3, baseModifier: 4,
    isCurrent: () => true, apply: value => { result = value } }
  const fateful = useFatefulIntervention({ rolls: () => [target], willpower: () => 3, cost: () => 7,
    pay: async () => { payments++; return true } })
  assert.equal(await fateful.confirm('check', { bonusSign: -1, willpowerSign: 1, diceResults: [0, 6, 6] }), false)
  assert.equal(payments, 0)
  assert.equal(await fateful.confirm('check', { bonusSign: -1, willpowerSign: 1, diceResults: [6, 6, 6] }), true)
  assert.equal(result.modifier, 2)
  assert.equal(result.total, 20)
  assert.equal(result.fatefulIntervention, true)
})

test('overlapping Fateful confirms cannot pay twice or replace a newer roll', async () => {
  let finish, current = true, applied = false, payments = 0
  const target = { id: 'roll', label: 'Attack', rollType: 'accuracy', baseDicePool: 1,
    isCurrent: () => current, apply: () => { applied = true } }
  const fateful = useFatefulIntervention({ rolls: () => [target], willpower: () => 0, cost: () => 5,
    pay: async () => { payments++; return new Promise(resolve => { finish = resolve }) } })
  const choice = { bonusSign: 1, willpowerSign: 1, diceResults: [6, 6, 6, 6, 6, 6] }
  const first = fateful.confirm('roll', choice)
  assert.equal(await fateful.confirm('roll', choice), false)
  current = false
  finish(true)
  assert.equal(await first, true)
  assert.equal(applied, false)
  assert.equal(payments, 1)
})

test('order targeting offers only own partners and opposing Digimon, with selectable negative effects', async () => {
  const actor = { id: 't', type: 'tamer', entityId: 'tamer' }
  const ally = { id: 'ally', type: 'digimon', entityId: 'ally', activeEffects: [] }
  const partner = { id: 'partner', type: 'digimon', entityId: 'digimon', activeEffects: [{ id: 'burn', name: 'Burn', type: 'debuff' }, { id: 'bastion', name: 'Bastion', type: 'buff' }] }
  const sent = []
  const picker = useSpecialOrderTargets({ participants: () => [actor, partner, ally, { id: 'enemy', type: 'digimon', isEnemy: true }, { id: 'enemy-human', type: 'tamer', isEnemy: true }],
    digimon: () => [{ id: 'digimon', partnerId: 'tamer' }, { id: 'ally', partnerId: 'other' }], nameFor: p => p.id,
    send: async (...args) => { sent.push(args); return true } })
  await picker.open(actor, 'Tough it Out!')
  assert.deepEqual(picker.partners.value.map(p => p.id), ['partner'])
  assert.deepEqual(picker.partners.value[0].effects.map(e => e.id), ['burn'])
  assert.deepEqual(picker.targets.value.map(p => p.id), ['enemy'])
  await picker.confirm({ partnerId: 'partner', effectId: 'burn' })
  assert.equal(sent[0][2].effectId, 'burn')
  assert.equal(picker.selection.value, null)
})

test('incoming reaction orders require an enemy Digimon, an eligible owner, and an unused daily order', () => {
  const requests = ref([{ id: 'request', type: 'intercede-offer', data: { attackerId: 'enemy', targetId: 'partner', canUseQuickReaction: true, intercedeGroupId: 'cast' } }])
  const tamer = { id: 'tamer', attributes: { agility: 5, intelligence: 3 }, usedPerDayOrders: [] }
  const encounter = { id: 'encounter', phase: 'combat', participants: [{ id: 't', type: 'tamer', entityId: 'tamer' }, { id: 'partner', type: 'digimon', entityId: 'digimon' }, { id: 'enemy', type: 'digimon', isEnemy: true }], requestResponses: [] }
  const controls = useReactionOrders({ encounter: () => encounter, requests: () => requests.value, tamers: () => [tamer], digimon: () => [{ id: 'digimon', partnerId: 'tamer' }], campaignLevel: () => 'standard', nameFor: p => p.id, canControl: () => true, send: async () => true })
  assert.equal(controls.choices.value.length, 1)
  assert.equal(controls.choices.value[0].quickReaction, true)
  assert.equal(controls.canDeclareStrikeLast({ id: 'request' }), true)
  controls.skip(controls.choices.value[0])
  assert.equal(controls.choices.value.length, 0)
  requests.value = [{ id: 'other', type: 'dodge-roll', targetParticipantId: 'partner', data: { attackerParticipantId: 'enemy' } }]
  assert.equal(controls.choices.value[0].quickReaction, false)
  assert.equal(controls.choices.value[0].strikeLast, true)
})

test('an area zero-dice defense continues normally without rolling or spending Inspiration', async () => {
  const sent = []
  const batch = useAreaDefenseBatch({ defense: () => ({ pool: 0, blocked: true, automaticSuccesses: 0 }), currentInspiration: () => 5, actOfInspirationCost: () => 2,
    spend: async () => { throw new Error('must not spend') }, rollDie: () => { throw new Error('must not roll') },
    submit: async (request, roll) => { sent.push(roll); return { ok: true, summary: { hit: true, finalDamage: 3, netSuccesses: 2 } } },
    isAnswered: () => false, isTargetPresent: () => true })
  batch.open('cast', [{ id: 'defense' }])
  assert.equal(await batch.resolveBlocked('defense'), true)
  assert.deepEqual(sent, [{ rolls: [], successes: 0, dicePool: 0 }])
  assert.equal(batch.entries.value[0].summary.finalDamage, 3)
  assert.equal(await batch.resolveBlocked('defense'), false)
})
