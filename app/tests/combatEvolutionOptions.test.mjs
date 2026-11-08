import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { computed, ref } from 'vue'
import ts from 'typescript'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildCombatEvolutionOptions, getCombatEvolutionParent, resolveCombatEvolutionIndex } = loadTypeScript('utils/combatEvolutionOptions.ts')
const { DIGIVOLVE_WILLPOWER_DC } = loadTypeScript('types/index.ts')
const entry = (species, evolvesFromIndex, isUnlocked = true, extra = {}) => ({
  species, evolvesFromIndex, isUnlocked, digimonId: species.toLowerCase(), stage: 'champion', ...extra,
})
const chain = [
  entry('Agumon', null),
  entry('Greymon', 0),
  entry('Tyrannomon', 0),
  entry('MetalTyrannomon', 2),
  entry('MetalGreymon', 1),
  entry('SkullGreymon', 1, false),
  entry('WarGreymon', 4),
  entry('LockedBranch', 0, false),
  entry('LockedBranchChild', 7),
]
const options = (overrides = {}) => ({ chain, currentIndex: 0, hasWoundsHistory: false, baseDC: 10, ...overrides })

test('ordinary evolution lists only unlocked direct children, keeping chain indices and metadata', () => {
  const result = buildCombatEvolutionOptions(options())
  assert.equal(result.canEvolve, true)
  assert.deepEqual(result.evolveTargets.map(target => target.chainIndex), [1, 2])
  assert.deepEqual(result.evolveTargets[0], { ...chain[1], chainIndex: 1 })
  assert.equal(result.evolveTargets[0].digimonId, 'greymon')
  assert.equal(result.canDevolve, false)
  assert.equal(result.devolveTarget, null)
  assert.deepEqual(result.warpTargets, [])
})

test('legacy JSON chains produce the same choices as parsed arrays', () => {
  const context = { currentIndex: 1, hasWoundsHistory: true, warpEvolution: true, baseDC: 15 }
  assert.deepEqual(
    buildCombatEvolutionOptions(options({ ...context, chain: JSON.stringify(chain) })),
    buildCombatEvolutionOptions(options(context)),
  )
})

test('devolution requires saved wound history and returns the actual parent with its original index', () => {
  const withoutHistory = buildCombatEvolutionOptions(options({ currentIndex: 4 }))
  assert.equal(withoutHistory.canDevolve, false)
  assert.equal(withoutHistory.devolveTarget, null)
  const withHistory = buildCombatEvolutionOptions(options({ currentIndex: 4, hasWoundsHistory: true }))
  assert.equal(withHistory.canDevolve, true)
  assert.deepEqual(withHistory.devolveTarget, { ...chain[1], chainIndex: 1 })
})

test('the root cannot devolve even with wound history, and parent unlock state does not block devolution', () => {
  const root = buildCombatEvolutionOptions(options({ hasWoundsHistory: true }))
  assert.equal(root.canDevolve, false)
  assert.equal(root.devolveTarget, null)
  const lockedParent = [entry('Agumon', null, false), entry('Greymon', 0)]
  const child = buildCombatEvolutionOptions(options({ chain: lockedParent, currentIndex: 1, hasWoundsHistory: true }))
  assert.equal(child.canDevolve, true)
  assert.equal(child.devolveTarget.species, 'Agumon')
})

test('partners entering combat evolved can devolve to their actual linked parent without saved history', () => {
  const result = buildCombatEvolutionOptions(options({ currentIndex: 3, allowDevolutionWithoutHistory: true }))
  assert.equal(result.canDevolve, true)
  assert.deepEqual(result.devolveTarget, { ...chain[2], chainIndex: 2 })
  assert.equal(result.devolveTarget.digimonId, 'tyrannomon')

  const lockedParent = [entry('Agumon', null, false), entry('Greymon', 0)]
  const child = buildCombatEvolutionOptions(options({
    chain: lockedParent, currentIndex: 1, allowDevolutionWithoutHistory: true,
  }))
  assert.equal(child.canDevolve, true)
  assert.deepEqual(child.devolveTarget, { ...lockedParent[0], chainIndex: 0 })
})

test('history-free devolution requires a linked parent Digimon, while history retains its previous eligibility', () => {
  for (const digimonId of [undefined, '', '   ']) {
    const unlinkedParent = [entry('Agumon', null, true, { digimonId }), entry('Greymon', 0)]
    const context = { chain: unlinkedParent, currentIndex: 1, allowDevolutionWithoutHistory: true }
    assert.equal(buildCombatEvolutionOptions(options(context)).canDevolve, false)
    assert.equal(buildCombatEvolutionOptions(options(context)).devolveTarget, null)
    assert.equal(buildCombatEvolutionOptions(options({ ...context, hasWoundsHistory: true })).canDevolve, true)
  }
})

test('parent lookup rejects roots and missing, invalid or self-referencing parent indices', () => {
  const root = buildCombatEvolutionOptions(options({ hasWoundsHistory: true, allowDevolutionWithoutHistory: true }))
  assert.equal(root.canDevolve, false)
  assert.equal(root.devolveTarget, null)
  assert.equal(getCombatEvolutionParent(chain, 0), null)
  for (const parentIndex of [undefined, -1, 0.5, 2, Number.NaN, 1]) {
    const invalidParent = [entry('Agumon', null), entry('Greymon', parentIndex)]
    assert.equal(getCombatEvolutionParent(invalidParent, 1), null)
    const result = buildCombatEvolutionOptions(options({
      chain: invalidParent, currentIndex: 1, hasWoundsHistory: true, allowDevolutionWithoutHistory: true,
    }))
    assert.equal(result.canDevolve, false)
    assert.equal(result.devolveTarget, null)
  }
  const missingParent = new Array(2)
  missingParent[1] = entry('Greymon', 0)
  assert.equal(getCombatEvolutionParent(missingParent, 1), null)
  for (const currentIndex of [-1, 0.5, chain.length, Number.NaN]) {
    assert.equal(getCombatEvolutionParent(chain, currentIndex), null)
    assert.equal(buildCombatEvolutionOptions(options({ currentIndex, hasWoundsHistory: true })).canDevolve, false)
  }
})

test('the caller-selected current index supports an NPC override, including stage zero', () => {
  const lineIndex = buildCombatEvolutionOptions(options({ currentIndex: 1, hasWoundsHistory: true }))
  assert.deepEqual(lineIndex.evolveTargets.map(target => target.chainIndex), [4])
  assert.equal(lineIndex.devolveTarget.chainIndex, 0)
  const npcIndex = buildCombatEvolutionOptions(options({ currentIndex: 0, hasWoundsHistory: true }))
  assert.deepEqual(npcIndex.evolveTargets.map(target => target.chainIndex), [1, 2])
  assert.equal(npcIndex.canDevolve, false)
})

test('Warp Evolution offers only unlocked grandchildren through unlocked children, in branch order', () => {
  const result = buildCombatEvolutionOptions(options({ warpEvolution: true, baseDC: 12 }))
  // Greymon's child comes first even though Tyrannomon's child has an earlier chain index.
  assert.deepEqual(result.warpTargets.map(target => target.chainIndex), [4, 3])
  assert.deepEqual(result.warpTargets[0], { ...chain[4], chainIndex: 4, stagesSkipped: 1, warpDC: 17 })
  assert.ok(result.warpTargets.every(target => target.warpDC === 17 && target.stagesSkipped === 1))
  assert.ok(!result.warpTargets.some(target => ['SkullGreymon', 'WarGreymon', 'LockedBranchChild'].includes(target.species)))
})

test('disabling Warp Evolution removes warp choices and the DC follows the supplied campaign value', () => {
  assert.deepEqual(buildCombatEvolutionOptions(options({ warpEvolution: false })).warpTargets, [])
  const lower = buildCombatEvolutionOptions(options({ warpEvolution: true, baseDC: 5 }))
  const higher = buildCombatEvolutionOptions(options({ warpEvolution: true, baseDC: 20 }))
  assert.deepEqual(lower.warpTargets.map(target => target.warpDC), [10, 10])
  assert.deepEqual(higher.warpTargets.map(target => target.warpDC), [25, 25])
})

test('a leaf has no evolution choices but may still devolve, and an empty chain has no choices', () => {
  const leaf = buildCombatEvolutionOptions(options({ currentIndex: 6, hasWoundsHistory: true, warpEvolution: true }))
  assert.equal(leaf.canEvolve, false)
  assert.deepEqual(leaf.evolveTargets, [])
  assert.deepEqual(leaf.warpTargets, [])
  assert.equal(leaf.devolveTarget.chainIndex, 4)
  assert.deepEqual(buildCombatEvolutionOptions(options({ chain: [] })), {
    canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null, warpTargets: [],
  })
})

test('choice construction never mutates the chain or its entries, and preserves extra entry fields', () => {
  const notes = Object.freeze({ source: 'library' })
  const original = Object.freeze([
    Object.freeze(entry('Agumon', null)),
    Object.freeze(entry('Greymon', 0, true, { notes })),
    Object.freeze(entry('MetalGreymon', 1)),
  ])
  const before = JSON.stringify(original)
  const result = buildCombatEvolutionOptions(options({ chain: original, warpEvolution: true }))
  assert.equal(JSON.stringify(original), before)
  assert.notEqual(result.evolveTargets[0], original[1])
  assert.equal(result.evolveTargets[0].notes, notes)
  assert.deepEqual(result.warpTargets.map(target => target.species), ['MetalGreymon'])
})

const pages = {
  gm: 'pages/campaigns/[campaignId]/encounters/[id].vue',
  player: 'pages/campaigns/[campaignId]/player/[tamerId].vue',
}

function pageChoices(role) {
  const digimonRecords = ref([])
  const dependencies = {
    evolutionLines: ref([{ id: 'line-1', chain, currentStageIndex: 1 }]),
    digimonMap: computed(() => new Map(digimonRecords.value.map(digimon => [digimon.id, digimon]))),
    partnerDigimon: digimonRecords,
    allDigimon: ref([]),
    eddySoulRules: ref({ warpEvolution: false }),
    campaignLevel: ref('standard'),
    DIGIVOLVE_WILLPOWER_DC,
    buildCombatEvolutionOptions,
  }
  const functions = loadPageFunctions(pages[role], ['getParticipantEvolutionOptions'], dependencies)
  return { ...functions, ...dependencies, digimonRecords }
}

for (const role of Object.keys(pages)) {
  test(`${role} page returns no choices when a participant or its record has no evolution line`, () => {
    const page = pageChoices(role)
    // Unrelated malformed JSON must not be parsed when this participant has no matching line.
    page.evolutionLines.value = [{ id: 'unrelated', chain: 'not-json', currentStageIndex: 0 }]
    const empty = { canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null, warpTargets: [] }
    assert.deepEqual(page.getParticipantEvolutionOptions({ id: 'actor' }), empty)
    assert.deepEqual(page.getParticipantEvolutionOptions({ id: 'actor', evolutionLineId: 'removed-line' }), empty)
  })

  test(`${role} page ${role === 'gm' ? 'honors the NPC stage override, including zero' : 'uses the line stage even when an NPC override is present'}`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', evolutionLineId: 'line-1', npcStageIndex: 0, woundsHistory: [{}] }
    const zeroOverride = page.getParticipantEvolutionOptions(actor)
    assert.deepEqual(zeroOverride.evolveTargets.map(target => target.chainIndex), role === 'gm' ? [1, 2] : [4])
    assert.equal(zeroOverride.canDevolve, role !== 'gm')
    actor.npcStageIndex = 2
    const otherOverride = page.getParticipantEvolutionOptions(actor)
    assert.deepEqual(otherOverride.evolveTargets.map(target => target.chainIndex), role === 'gm' ? [3] : [4])
    assert.equal(otherOverride.devolveTarget.chainIndex, 0)
    delete actor.npcStageIndex
    assert.deepEqual(page.getParticipantEvolutionOptions(actor).evolveTargets.map(target => target.chainIndex), [4])
  })

  test(`${role} page reads current Warp Evolution rules and campaign DC on every choice calculation`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', evolutionLineId: 'line-1' }
    page.evolutionLines.value[0].currentStageIndex = 0
    assert.deepEqual(page.getParticipantEvolutionOptions(actor).warpTargets, [])
    page.eddySoulRules.value.warpEvolution = true
    for (const campaignLevel of ['standard', 'enhanced', 'extreme']) {
      page.campaignLevel.value = campaignLevel
      const targets = page.getParticipantEvolutionOptions(actor).warpTargets
      assert.deepEqual(targets.map(target => target.chainIndex), [4, 3])
      assert.ok(targets.every(target => target.warpDC === DIGIVOLVE_WILLPOWER_DC[campaignLevel] + 5))
    }
    page.eddySoulRules.value.warpEvolution = false
    assert.deepEqual(page.getParticipantEvolutionOptions(actor).warpTargets, [])
  })

  test(`${role} page offers history-free devolution to partners without requiring their Tamer in combat`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line-1' }
    page.digimonRecords.value = [{ id: 'greymon', partnerId: 'absent-tamer' }]
    page.evolutionLines.value[0].chain = [entry('Agumon', null, false), entry('Greymon', 0)]

    const result = page.getParticipantEvolutionOptions(actor)
    assert.equal(result.canDevolve, true)
    assert.deepEqual(result.devolveTarget, { ...page.evolutionLines.value[0].chain[0], chainIndex: 0 })
    assert.equal(result.devolveTarget.digimonId, 'agumon')
    page.evolutionLines.value[0].currentStageIndex = 0
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, true, 'a stale line index must not hide the actual parent')
    actor.entityId = 'agumon'
    page.digimonRecords.value.push({ id: 'agumon', partnerId: 'absent-tamer' })
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
  })

  test(`${role} page keeps NPCs and explicit enemies history-gated and reads current partner classification`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line-1' }
    page.digimonRecords.value = [{ id: 'greymon' }]
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
    actor.woundsHistory = [{}]
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, true)
    delete actor.woundsHistory

    const record = page.digimonRecords.value[0]
    record.partnerId = 'tamer'
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, true)
    actor.isEnemy = true
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
    actor.isEnemy = false
    record.isEnemy = true
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
    record.isEnemy = false
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, true)
    actor.type = 'tamer'
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
    actor.type = 'digimon'
    page.digimonRecords.value = []
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
  })

  test(`${role} partner choices follow the shared line after devolution and later evolution, ignoring stale NPC state`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line-1', npcStageIndex: 0 }
    page.digimonRecords.value = [{ id: 'greymon', partnerId: 'tamer' }, { id: 'metalgreymon', partnerId: 'tamer' }]
    assert.equal(page.getParticipantEvolutionOptions(actor).devolveTarget.chainIndex, 0)
    actor.entityId = 'metalgreymon'
    page.evolutionLines.value[0].currentStageIndex = 4
    assert.equal(page.getParticipantEvolutionOptions(actor).devolveTarget.chainIndex, 1)
  })

  test(`${role} partner choices resolve the actual form before parent, child and warp choices when the line index is stale`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line-1', npcStageIndex: 2 }
    page.digimonRecords.value = [{ id: 'greymon', partnerId: 'tamer' }, { id: 'metalgreymon', partnerId: 'tamer' }]
    page.evolutionLines.value[0].currentStageIndex = 3
    page.eddySoulRules.value.warpEvolution = true
    const greymon = page.getParticipantEvolutionOptions(actor)
    assert.equal(greymon.devolveTarget.chainIndex, 0)
    assert.deepEqual(greymon.evolveTargets.map(target => target.chainIndex), [4])
    assert.deepEqual(greymon.warpTargets.map(target => target.chainIndex), [6])

    actor.entityId = 'metalgreymon'
    page.evolutionLines.value[0].currentStageIndex = 0
    const metalGreymon = page.getParticipantEvolutionOptions(actor)
    assert.equal(metalGreymon.devolveTarget.chainIndex, 1)
    assert.deepEqual(metalGreymon.evolveTargets.map(target => target.chainIndex), [6])
    assert.deepEqual(metalGreymon.warpTargets, [])
  })

  test(`${role} partner choices are empty when the actual form is absent from its line, even with combat history`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'missing-form', evolutionLineId: 'line-1', woundsHistory: [{}] }
    page.digimonRecords.value = [{ id: 'missing-form', partnerId: 'tamer' }]
    page.eddySoulRules.value.warpEvolution = true
    assert.deepEqual(page.getParticipantEvolutionOptions(actor), {
      canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null, warpTargets: [],
    })
  })

  test(`${role} page follows a partner's actual branch parent and suppresses broken fallback targets`, () => {
    const page = pageChoices(role)
    const actor = { id: 'actor', type: 'digimon', entityId: 'metalgreymon', evolutionLineId: 'line-1' }
    page.digimonRecords.value = [{ id: 'metalgreymon', partnerId: 'tamer' }]
    page.evolutionLines.value[0].chain = chain.map(form => ({ ...form }))
    page.evolutionLines.value[0].currentStageIndex = 4
    const result = page.getParticipantEvolutionOptions(actor)
    assert.equal(result.canDevolve, true)
    assert.equal(result.devolveTarget.chainIndex, 1)
    assert.equal(result.devolveTarget.digimonId, 'greymon')

    page.evolutionLines.value[0].chain[1].digimonId = ''
    assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
    page.evolutionLines.value[0].chain[1].digimonId = 'greymon'
    for (const invalidParent of [undefined, -1, chain.length, 4]) {
      page.evolutionLines.value[0].chain[4].evolvesFromIndex = invalidParent
      const invalid = page.getParticipantEvolutionOptions(actor)
      assert.equal(invalid.canDevolve, false)
      assert.equal(invalid.devolveTarget, null)
    }
  })
}

test('player page resolves partner ownership from encounter Digimon when absent from its own partner list', () => {
  const page = pageChoices('player')
  const actor = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line-1' }
  page.allDigimon.value = [{ id: 'greymon', partnerId: 'another-tamer' }]
  assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, true)
  page.allDigimon.value[0].isEnemy = true
  assert.equal(page.getParticipantEvolutionOptions(actor).canDevolve, false)
})

function forceEvolutionChoices() {
  const filename = fileURLToPath(new URL('../pages/campaigns/[campaignId]/encounters/[id].vue', import.meta.url))
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.equal(errors.length, 0)
  const script = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = script.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(candidate => ts.isIdentifier(candidate.name) && candidate.name.text === 'selectedParticipantForceEvoOptions')
  assert.ok(declaration?.initializer)
  const dependencies = {
    computed,
    selectedParticipant: ref(null),
    evolutionLines: ref([{ id: 'line', currentStageIndex: 1, chain: structuredClone(chain) }]),
    digimonMap: ref(new Map()),
    eddySoulRules: ref({ warpEvolution: true }),
    resolveCombatEvolutionIndex,
  }
  const { outputText } = ts.transpileModule(`const extracted = ${declaration.initializer.getText(script)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  })
  const choices = new Function(...Object.keys(dependencies), `${outputText}\nreturn extracted`)(...Object.values(dependencies))
  return { ...dependencies, choices }
}

test('GM force-evolution choices follow the actual partner form when both stored line and NPC indices are stale', () => {
  const f = forceEvolutionChoices()
  f.selectedParticipant.value = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line', npcStageIndex: 0 }
  f.digimonMap.value.set('greymon', { id: 'greymon', partnerId: 'tamer' })
  f.digimonMap.value.set('metalgreymon', { id: 'metalgreymon', partnerId: 'tamer' })
  f.evolutionLines.value[0].currentStageIndex = 3
  assert.equal(f.choices.value.devolveTarget.chainIndex, 0)
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [4])
  assert.deepEqual(f.choices.value.warpTargets.map(target => target.chainIndex), [6])

  f.eddySoulRules.value.warpEvolution = false
  assert.deepEqual(f.choices.value.warpTargets, [])
  f.selectedParticipant.value.entityId = 'metalgreymon'
  f.evolutionLines.value[0].currentStageIndex = 0
  assert.equal(f.choices.value.devolveTarget.chainIndex, 1)
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [6])
})

test('GM force-evolution choices are empty when the actual partner entity is absent from the line', () => {
  const f = forceEvolutionChoices()
  f.selectedParticipant.value = { id: 'actor', type: 'digimon', entityId: 'missing-form', evolutionLineId: 'line', npcStageIndex: 0 }
  f.digimonMap.value.set('missing-form', { id: 'missing-form', partnerId: 'tamer' })
  assert.deepEqual(f.choices.value, { evolveTargets: [], devolveTarget: null, warpTargets: [] })
})

test('GM force-evolution choices retain explicit NPC stage overrides, including zero and enemy-linked records', () => {
  const f = forceEvolutionChoices()
  f.selectedParticipant.value = { id: 'actor', type: 'digimon', entityId: 'greymon', evolutionLineId: 'line', npcStageIndex: 2 }
  f.digimonMap.value.set('greymon', { id: 'greymon' })
  assert.equal(f.choices.value.devolveTarget.chainIndex, 0)
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [3])
  assert.deepEqual(f.choices.value.warpTargets, [])

  f.selectedParticipant.value.npcStageIndex = 0
  assert.equal(f.choices.value.devolveTarget, null)
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [1, 2])
  assert.deepEqual(f.choices.value.warpTargets.map(target => target.chainIndex), [4, 3])

  f.selectedParticipant.value.npcStageIndex = 2
  f.digimonMap.value.set('greymon', { id: 'greymon', partnerId: 'tamer', isEnemy: true })
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [3])
  f.digimonMap.value.get('greymon').isEnemy = false
  f.selectedParticipant.value.isEnemy = true
  assert.deepEqual(f.choices.value.evolveTargets.map(target => target.chainIndex), [3])
})
