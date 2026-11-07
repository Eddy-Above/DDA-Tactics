import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { computed, ref } from 'vue'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useTamers } = loadTypeScript('composables/useTamers.ts')

function createCalculator() {
  const hadRef = Object.hasOwn(globalThis, 'ref')
  const originalRef = globalThis.ref
  globalThis.ref = ref
  try {
    return useTamers().calculateDerivedStats
  } finally {
    if (hadRef) globalThis.ref = originalRef
    else delete globalThis.ref
  }
}

const calculate = createCalculator()

function makeTamer() {
  return {
    id: 'tai', name: 'Tai', inspiration: 20, grantedInspiration: 10,
    attributes: { agility: 3, body: 4, charisma: 2, intelligence: 1, willpower: 2 },
    skills: {
      dodge: 2, fight: 1, stealth: 3, athletics: 4, endurance: 3, featsOfStrength: 6,
      manipulate: 1, perform: 2, persuasion: 3, computer: 1, survival: 4, knowledge: 2,
      perception: 3, decipherIntent: 1, bravery: 2,
    },
    xpBonuses: {
      attributes: { agility: 1, body: 2, charisma: 0, intelligence: 1, willpower: 1 },
      skills: {
        dodge: 4, fight: 2, stealth: 0, athletics: 3, endurance: 1, featsOfStrength: 2,
        manipulate: 0, perform: 0, persuasion: 0, computer: 0, survival: 1, knowledge: 0,
        perception: 0, decipherIntent: 0, bravery: 0,
      },
      inspiration: 8,
    },
  }
}

const ruleNames = ['accuracyIsAgilityAthletics', 'armorIsWillpowerEndurance', 'damageIsBodyFeatsOfStrength']
// Each switch changes a distinct value; expected numbers are independent of the calculator.
const expectedSwitchedStats = [
  [7, 10, 9], [11, 10, 9], [7, 7, 9], [11, 7, 9],
  [7, 10, 14], [11, 10, 14], [7, 7, 14], [11, 7, 14],
]

for (let mask = 0; mask < 8; mask++) {
  test(`Tamer derived stats include base and XP under EddySoul switch combination ${mask}`, () => {
    const rules = Object.fromEntries(ruleNames.map((name, bit) => [name, !!(mask & (1 << bit))]))
    const [accuracyPool, armor, damage] = expectedSwitchedStats[mask]
    assert.deepEqual(calculate(makeTamer(), rules), {
      woundBoxes: 10, speed: 9, accuracyPool, dodgePool: 10, armor, damage, maxInspiration: 3,
    })
  })
}

test('Tamer stats use standard formulas when rules and XP bonuses are absent', () => {
  const tamer = makeTamer()
  delete tamer.xpBonuses
  const expected = { woundBoxes: 7, speed: 7, accuracyPool: 4, dodgePool: 5, armor: 7, damage: 5, maxInspiration: 2 }
  assert.deepEqual(calculate(tamer), expected)
  tamer.xpBonuses = null
  assert.deepEqual(calculate(tamer, {}), expected)
})

test('zero attributes and skills retain the minimum wounds and Inspiration', () => {
  const tamer = makeTamer()
  tamer.attributes = Object.fromEntries(Object.keys(tamer.attributes).map(key => [key, 0]))
  tamer.skills = Object.fromEntries(Object.keys(tamer.skills).map(key => [key, 0]))
  tamer.xpBonuses = { attributes: {}, skills: {}, inspiration: 50 }
  assert.deepEqual(calculate(tamer), {
    woundBoxes: 2, speed: 0, accuracyPool: 0, dodgePool: 0, armor: 0, damage: 0, maxInspiration: 1,
  })
})

test('sparse base and XP maps preserve the player page zero defaults', () => {
  const tamer = {
    attributes: { body: 3 }, skills: { endurance: 2 },
    xpBonuses: {
      attributes: { agility: 1, body: 1, willpower: 2 },
      skills: { fight: 2, dodge: 1, survival: 1, athletics: 3, featsOfStrength: 4 },
    },
  }
  assert.deepEqual(calculate(tamer), {
    woundBoxes: 6, speed: 2, accuracyPool: 3, dodgePool: 2, armor: 6, damage: 6, maxInspiration: 2,
  })
  assert.deepEqual(calculate(tamer, Object.fromEntries(ruleNames.map(name => [name, true]))), {
    woundBoxes: 6, speed: 2, accuracyPool: 4, dodgePool: 2, armor: 4, damage: 8, maxInspiration: 2,
  })
})

test('non-numeric NaN values retain the page totals zero fallback', () => {
  assert.deepEqual(calculate({
    attributes: { agility: NaN, body: 0, willpower: NaN },
    skills: { dodge: NaN, fight: 0, endurance: NaN, survival: NaN },
    xpBonuses: { attributes: { agility: NaN }, skills: { fight: NaN } },
  }), {
    woundBoxes: 2, speed: 0, accuracyPool: 0, dodgePool: 0, armor: 0, damage: 0, maxInspiration: 1,
  })
})

/** Evaluate only the real page's computed initializer, preserving its Vue dependency tracking. */
function loadPlayerTamerStats(tamer, eddySoulRules, calcTamerStats) {
  const filename = fileURLToPath(new URL('../pages/campaigns/[campaignId]/player/[tamerId].vue', import.meta.url))
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.equal(errors.length, 0)
  const source = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => Array.from(statement.declarationList.declarations))
    .find(candidate => ts.isIdentifier(candidate.name) && candidate.name.text === 'tamerStats')
  assert.ok(declaration?.initializer, 'the page declares its Tamer stats computed')
  const { outputText } = ts.transpileModule(`const extracted = ${declaration.initializer.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  })
  return new Function('computed', 'tamer', 'eddySoulRules', 'calcTamerStats', `${outputText}\nreturn extracted`)(computed, tamer, eddySoulRules, calcTamerStats)
}

test('the real player computed guards null and delegates reactively to the shared calculator', () => {
  const tamer = ref(null)
  const rules = ref({})
  const calls = []
  const results = []
  const stats = loadPlayerTamerStats(tamer, rules, (record, currentRules) => {
    calls.push([record, currentRules])
    const result = { name: record.name, agility: record.attributes.agility, alternativeAccuracy: !!currentRules.accuracyIsAgilityAthletics }
    results.push(result)
    return result
  })

  assert.equal(stats.value, null)
  assert.equal(calls.length, 0, 'no record means no calculator call')

  tamer.value = makeTamer()
  assert.equal(stats.value, results[0], 'the page returns the shared result unchanged')
  assert.equal(calls[0][0], tamer.value)
  assert.equal(calls[0][1], rules.value)
  assert.equal(stats.value.agility, 3)
  assert.equal(calls.length, 1, 'the computed caches an unchanged result')

  tamer.value.attributes.agility = 7
  assert.equal(stats.value.agility, 7)
  assert.equal(calls.length, 2)

  rules.value.accuracyIsAgilityAthletics = true
  assert.equal(stats.value.alternativeAccuracy, true)
  assert.equal(calls.length, 3)

  rules.value = { accuracyIsAgilityAthletics: false }
  assert.equal(stats.value.alternativeAccuracy, false)
  assert.equal(calls.at(-1)[1], rules.value)

  tamer.value = { ...makeTamer(), name: 'Matt' }
  assert.equal(stats.value.name, 'Matt')
  assert.equal(calls.at(-1)[0], tamer.value)

  const callCount = calls.length
  tamer.value = null
  assert.equal(stats.value, null)
  assert.equal(calls.length, callCount)
})
