import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, reactive } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildParticipantDisplayNames } = loadTypeScript('utils/participantDisplayNames.ts')
const participant = (id, entityId, extra = {}) => ({ id, entityId, type: 'digimon', ...extra })
const enemy = (id, entityId, extra = {}) => participant(id, entityId, { isEnemy: true, ...extra })

test('unique names stay unnumbered and records without a name are excluded', () => {
  const roster = [participant('tai', 't1', { type: 'tamer' }), participant('agumon', 'd1'), participant('missing', 'absent')]
  const records = { t1: { name: 'Tai' }, d1: { name: 'Agumon' } }
  assert.deepEqual(buildParticipantDisplayNames(roster, p => records[p.entityId]?.name), { tai: 'Tai', agumon: 'Agumon' })
  assert.deepEqual(buildParticipantDisplayNames([], () => 'Nobody'), {})
})

test('legacy enemy duplicates group by base name across entity IDs, using ID order', () => {
  const roster = [
    enemy('unit-c', 'd3'),
    enemy('unit-a', 'd1'),
    enemy('unit-b', 'd2'),
  ]
  assert.deepEqual(buildParticipantDisplayNames(roster, () => 'Alex'), {
    'unit-c': 'Alex 3', 'unit-a': 'Alex 1', 'unit-b': 'Alex 2',
  })
})

test('enemy Digimon sequence numbers survive removals and do not depend on sorted ID or input order', () => {
  const first = enemy('unit-z', 'd1', { seq: 1 })
  const second = enemy('unit-a', 'd1', { seq: 2 })
  assert.deepEqual(buildParticipantDisplayNames([second, first], () => 'Goblimon'), {
    'unit-a': 'Goblimon 2', 'unit-z': 'Goblimon 1',
  })
  assert.deepEqual(buildParticipantDisplayNames([second], () => 'Goblimon'), { 'unit-a': 'Goblimon 2' })
  assert.deepEqual(buildParticipantDisplayNames([first], () => 'Goblimon'), { 'unit-z': 'Goblimon' })
})

test('enemy numbering ignores same-name tamers and partners, even when they have stale sequence numbers', () => {
  const roster = [
    enemy('b', 'legacy'), enemy('a', 'stable', { seq: 7 }),
    participant('c', 't1', { type: 'tamer', seq: 12, isEnemy: true }),
    participant('d', 'partner', { seq: 8, isEnemy: false }), participant('e', 'partner-legacy'),
  ]
  assert.deepEqual(buildParticipantDisplayNames(roster, () => 'Sam'), {
    b: 'Sam 2', a: 'Sam 7', c: 'Sam', d: 'Sam', e: 'Sam',
  })
})

test('a single enemy stays unnumbered alongside same-name tamers and partner Digimon', () => {
  const nonEnemies = [
    participant('t1', 'tamer-a', { type: 'tamer' }), participant('t2', 'tamer-b', { type: 'tamer', seq: 2 }),
    participant('p1', 'partner-a', { seq: 3 }), participant('p2', 'partner-b', { isEnemy: false, seq: 4 }),
  ]
  for (const opponent of [enemy('e1', 'enemy'), enemy('e1', 'enemy', { seq: 1 })]) {
    assert.deepEqual(buildParticipantDisplayNames([...nonEnemies, opponent], () => 'Alex'), {
      t1: 'Alex', t2: 'Alex', p1: 'Alex', p2: 'Alex', e1: 'Alex',
    })
  }
})

test('an explicit enemy resolver supports entity records while still excluding tamers', () => {
  const roster = [participant('b', 'enemy-record'), participant('a', 'enemy-record'), participant('t', 'enemy-record', { type: 'tamer' })]
  const records = { 'enemy-record': { isEnemy: true } }
  assert.deepEqual(buildParticipantDisplayNames(roster, () => 'Alex', p => records[p.entityId]?.isEnemy === true), {
    b: 'Alex 2', a: 'Alex 1', t: 'Alex',
  })
})

test('missing records do not consume duplicate numbers and an existing empty name is retained', () => {
  const roster = [enemy('a', 'missing'), enemy('b', 'present'), enemy('c', 'empty'), enemy('d', 'null')]
  const records = { present: 'Agumon', empty: '', null: null }
  assert.deepEqual(buildParticipantDisplayNames(roster, p => records[p.entityId]), { b: 'Agumon', c: '' })
})

test('building names preserves input order and never mutates participant records or their array', () => {
  const roster = Object.freeze([Object.freeze(enemy('z', 'd1')), Object.freeze(enemy('a', 'd2'))])
  const names = buildParticipantDisplayNames(roster, () => 'Agumon')
  assert.deepEqual(Object.keys(names), ['z', 'a'])
  assert.deepEqual(names, { z: 'Agumon 2', a: 'Agumon 1' })
  assert.deepEqual(roster.map(p => p.id), ['z', 'a'])
})

test('a Vue computed tracks record name changes, record arrival and participant sequence changes', () => {
  const state = reactive({
    participants: [enemy('a', 'd1'), enemy('b', 'd2')],
    records: { d1: { name: 'Agumon' } },
  })
  const names = computed(() => buildParticipantDisplayNames(state.participants, p => state.records[p.entityId]?.name))
  assert.deepEqual(names.value, { a: 'Agumon' })
  state.records.d2 = { name: 'Agumon' }
  assert.deepEqual(names.value, { a: 'Agumon 1', b: 'Agumon 2' })
  state.participants[1].seq = 5
  assert.deepEqual(names.value, { a: 'Agumon 1', b: 'Agumon 5' })
  state.records.d2.name = 'Gabumon'
  assert.deepEqual(names.value, { a: 'Agumon', b: 'Gabumon 5' })
})

test('reactive enemy classification updates duplicate counts and ignores a former enemy sequence number', () => {
  const state = reactive({ participants: [enemy('a', 'd1', { seq: 1 }), enemy('b', 'd2', { seq: 5 })] })
  const names = computed(() => buildParticipantDisplayNames(state.participants, () => 'Agumon'))
  assert.deepEqual(names.value, { a: 'Agumon 1', b: 'Agumon 5' })
  state.participants[1].isEnemy = false
  assert.deepEqual(names.value, { a: 'Agumon', b: 'Agumon' })
  state.participants[1].isEnemy = true
  assert.deepEqual(names.value, { a: 'Agumon 1', b: 'Agumon 5' })
})
