import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildCombatEvolutionOptions } = loadTypeScript('utils/combatEvolutionOptions.ts')
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
  const dependencies = {
    evolutionLines: ref([{ id: 'line-1', chain, currentStageIndex: 1 }]),
    eddySoulRules: ref({ warpEvolution: false }),
    campaignLevel: ref('standard'),
    DIGIVOLVE_WILLPOWER_DC,
    buildCombatEvolutionOptions,
  }
  const functions = loadPageFunctions(pages[role], ['getParticipantEvolutionOptions'], dependencies)
  return { ...functions, ...dependencies }
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
}
