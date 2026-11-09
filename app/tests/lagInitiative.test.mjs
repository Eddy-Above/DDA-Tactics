import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { applyLagInitiative } = loadTypeScript('utils/lagInitiative.ts')
const { applyEffectToParticipant } = loadTypeScript('server/utils/applyEffect.ts')
const roster = () => ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, type: 'digimon', entityId: id, activeEffects: [] }))
const lag = (places, round) => ({ id: `lag-${round}-${places}`, name: 'Lag', type: 'debuff', duration: 1,
  source: 'caster', potency: places, ...(round === undefined ? {} : { appliesRound: round }) })

test('Lag rolls dBIT once on application, schedules the next round, and keeps the strongest non-stacking instance', t => {
  const random = Math.random
  t.after(() => { Math.random = random })
  Math.random = () => 0.5
  const input = { name: 'Lag', type: 'debuff', source: 'first', duration: 4, potency: 6, potencyStat: 'bit' }
  let effects = applyEffectToParticipant([], input, undefined, undefined, 1)
  assert.equal(effects[0].potency, 4)
  assert.equal(effects[0].appliesRound, 2)
  Math.random = () => 0
  effects = applyEffectToParticipant(effects, { ...input, source: 'second' }, undefined, undefined, 1)
  assert.equal(effects.length, 1)
  assert.equal(effects[0].potency, 4)
  Math.random = () => 0.99
  effects = applyEffectToParticipant(effects, { ...input, source: 'third' }, undefined, undefined, 1)
  assert.equal(effects.length, 1)
  assert.equal(effects[0].potency, 6)
  assert.equal(effects[0].duration, 1)
  assert.deepEqual(applyEffectToParticipant([], input, undefined, [{ id: 'immunity' }], 1), [])
})

test('Lag lowers places in the next round only and restores the prior order without rerolling or stacking', () => {
  const participants = roster(), base = participants.map(participant => participant.id)
  participants[0].activeEffects.push(lag(3, 2), lag(2, 2))
  assert.deepEqual(applyLagInitiative(participants, base, 1), base)
  const delayed = applyLagInitiative(participants, base, 2)
  assert.deepEqual(delayed, ['b', 'c', 'd', 'a', 'e'])
  assert.deepEqual(applyLagInitiative(participants, delayed, 2), delayed, 'repeated resolution is idempotent')
  assert.deepEqual(applyLagInitiative(participants, delayed, 3), base)
  assert.deepEqual(participants[0].activeEffects, [])
  assert.equal(participants.some(participant => participant.lagBaseOrder !== undefined), false)
})

test('a partner’s Lag moves its owning Tamer slot; simultaneous Lag on the same slot uses the maximum', () => {
  const participants = [{ id: 'tamer', type: 'tamer', entityId: 'owner', activeEffects: [lag(1, 2)] },
    { id: 'partner', type: 'digimon', entityId: 'form', activeEffects: [lag(2, 2)] },
    { id: 'enemy-a', activeEffects: [] }, { id: 'enemy-b', activeEffects: [] }]
  const records = new Map([['form', { partnerId: 'owner' }]])
  const base = ['tamer', 'enemy-a', 'enemy-b']
  const result = applyLagInitiative(participants, base, 2, records)
  assert.deepEqual(result, ['enemy-a', 'enemy-b', 'tamer'])
  assert.deepEqual(applyLagInitiative(participants, result, 3, records), base)
})

test('Lag clamps at the final slot, ignores reserves, and uses the base order for consecutive affected rounds', () => {
  const participants = roster(), base = participants.map(participant => participant.id)
  participants[0].activeEffects.push(lag(99, 2))
  let order = applyLagInitiative(participants, base, 2)
  assert.deepEqual(order, ['b', 'c', 'd', 'e', 'a'])
  participants[1].activeEffects.push(lag(2, 3))
  order = applyLagInitiative(participants, order, 3)
  assert.deepEqual(order, ['a', 'c', 'd', 'b', 'e'])
  assert.deepEqual(applyLagInitiative(participants, order, 4), base)
  participants.push({ id: 'reserve', inReserve: true, activeEffects: [lag(99, 5)] })
  assert.deepEqual(applyLagInitiative(participants, [...base, 'reserve'], 5), base)
})
