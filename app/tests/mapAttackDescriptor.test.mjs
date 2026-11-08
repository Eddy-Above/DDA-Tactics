import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { computed, ref } from 'vue'
import ts from 'typescript'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildMapAttackDescriptor } = loadTypeScript('utils/mapAttackDescriptor.ts')
const selection = (overrides = {}) => ({
  participant: { id: 'actor', entityId: 'agumon', activeEffects: [] },
  attack: { type: 'damage', range: 'ranged', tags: ['Charge Attack', 'Area Attack: Burst 3'] },
  ...overrides,
})
const source = (digimon = {}) => ({
  digimon: { size: 'medium', qualities: [], ...digimon },
  stats: { bit: 3, movement: 8, ram: 4, effectiveLimit: 12 },
})

test('a missing record preserves attack metadata and the original map fallback', () => {
  assert.deepEqual(buildMapAttackDescriptor(selection()), {
    tags: ['Charge Attack', 'Area Attack: Burst 3'], range: 'ranged', type: 'damage',
    bit: 0, effectiveLimit: 0, meleeRange: 1, attackerParticipantId: 'actor',
  })
  assert.deepEqual(buildMapAttackDescriptor(selection({ attack: { type: 'clash-initiate' } })), {
    tags: [], range: 'melee', type: 'clash-initiate',
    bit: 0, effectiveLimit: 0, meleeRange: 1, attackerParticipantId: 'actor',
  })
})

test('map ranges use size and Reach ranks independently', () => {
  for (const [size, expected] of [
    ['tiny', 0], ['small', 0], ['medium', 0], ['large', 0], ['huge', 1], ['GIGANTIC', 2],
    [null, 0], [undefined, 0], ['unknown', 0],
  ]) {
    const result = buildMapAttackDescriptor(selection(), source({ size, qualities: [{ id: 'reach', ranks: 3 }] }))
    assert.equal(result.sizeAboveLarge, expected, `size=${size}`)
    assert.equal(result.meleeRange, 6)
    assert.equal(result.bit, 3)
    assert.equal(result.ram, 4)
    assert.equal(result.movement, 8)
    assert.equal(result.effectiveLimit, 12)
  }
  for (const ranks of [undefined, 0, -1]) {
    assert.equal(buildMapAttackDescriptor(selection(), source({ qualities: [{ id: 'reach', ranks }] })).meleeRange, 1)
  }
  assert.equal(buildMapAttackDescriptor(selection(), source()).meleeRange, 1)
})

test('Bastion and Debilitate affect map stats without mutating records, effects, or base stats', () => {
  const selected = selection({ participant: {
    id: 'actor', activeEffects: Object.freeze([
      Object.freeze({ name: 'Bastion', potency: 4 }),
      Object.freeze({ name: 'Debilitate', potency: 1 }),
      Object.freeze({ name: 'Vigor', potency: 9 }),
    ]),
  } })
  const input = source({ qualities: Object.freeze([Object.freeze({ id: 'reach', ranks: 2 })]) })
  Object.freeze(input.stats)
  Object.freeze(input.digimon)
  const before = structuredClone({ selected, input })
  const result = buildMapAttackDescriptor(selected, input)
  assert.deepEqual([result.bit, result.movement, result.ram, result.effectiveLimit], [6, 11, 7, 15])
  assert.equal(result.meleeRange, 4)
  assert.deepEqual({ selected, input }, before)
  const unbuffed = buildMapAttackDescriptor(selection({ participant: { id: 'actor' } }), source())
  assert.equal(unbuffed.bit, 3)
})

// Execute each real computed so its visibility gate, record lookup and Vue dependencies are covered.
function loadMapAttackComputed(page, dependencies) {
  const filename = fileURLToPath(new URL(`../${page}`, import.meta.url))
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.equal(errors.length, 0)
  const script = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = script.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(candidate => ts.isIdentifier(candidate.name) && candidate.name.text === 'mapSelectedAttackProp')
  assert.ok(declaration?.initializer)
  const { outputText } = ts.transpileModule(`const extracted = ${declaration.initializer.getText(script)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  })
  return new Function(...Object.keys(dependencies), `${outputText}\nreturn extracted`)(...Object.values(dependencies))
}

for (const [role, page] of [
  ['GM', 'pages/campaigns/[campaignId]/encounters/[id].vue'],
  ['player', 'pages/campaigns/[campaignId]/player/[tamerId].vue'],
]) {
  test(`${role} map selection reacts to visibility, records, effects and its own stat calculator`, () => {
    const selectedAttack = ref(null)
    const showMapView = ref(true)
    const digimonMap = ref(new Map())
    const calls = []
    const baseMovement = ref(role === 'GM' ? 8 : 10)
    const descriptor = loadMapAttackComputed(page, {
      computed, selectedAttack, showMapView, digimonMap, buildMapAttackDescriptor,
      calcDigimonStats: record => {
        calls.push(record.id)
        return { ...source().stats, movement: baseMovement.value }
      },
    })
    assert.equal(descriptor.value, null)
    selectedAttack.value = selection()
    assert.equal(descriptor.value.bit, 0)
    assert.equal(calls.length, 0, 'missing records must not invoke the stat calculator')
    digimonMap.value.set('agumon', { id: 'agumon', ...source({ size: 'huge' }).digimon })
    assert.equal(descriptor.value.movement, baseMovement.value)
    assert.equal(descriptor.value.sizeAboveLarge, 1)
    selectedAttack.value.participant.activeEffects.push({ name: 'Bastion', potency: 2 })
    assert.equal(descriptor.value.bit, 5)
    baseMovement.value = 12
    assert.equal(descriptor.value.movement, 14)
    showMapView.value = false
    const callCount = calls.length
    assert.equal(descriptor.value, null)
    assert.equal(calls.length, callCount)
    showMapView.value = true
    digimonMap.value.delete('agumon')
    assert.equal(descriptor.value.effectiveLimit, 0)
    assert.equal(descriptor.value.attackerParticipantId, 'actor')
    selectedAttack.value = null
    assert.equal(descriptor.value, null)
  })
}
