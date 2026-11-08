import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { radialAttackItem, toggleAttackRider, validAttackRiders, attackRiderSelection } = loadTypeScript('utils/attackRadialOptions.ts')
const { withRadialActionCosts } = loadTypeScript('utils/radialActionCosts.ts')
const { radialDetailRows } = loadTypeScript('utils/radialMenu.ts')
const { INSPIRATION_ACT_COST, INSPIRATION_FATEFUL_COST } = loadTypeScript('types/index.ts')
const actor = () => ({ type: 'digimon', actionsRemaining: { simple: 2 } })
const attack = { id: 'attack:colon', name: 'Fire Burst', range: 'ranged', tags: ['Area Attack: Burst'] }
const context = () => ({ record: { qualities: [{ id: 'huge-power', ranks: 2 }] }, round: 3,
  campaignLevel: 'standard', hasTamer: true, inspiration: 100, fatefulAvailable: true })
const rider = (item, id) => item.children.find(child => child.attackRider === id)

test('attack options have compatible riders and Continue handles both ordinary and configured attacks', () => {
  const selected = ['bolster-bit-cpu', 'huge-power-2', 'act-of-inspiration', 'fateful-intervention']
  const item = radialAttackItem(actor(), attack, context(), selected)
  assert.equal(item.id, attack.id)
  assert.equal(item.cost, '1 Simple')
  assert.equal(item.children.some(child => child.label === 'None'), false)
  const ordinary = radialAttackItem(actor(), attack, context()).children.at(-1)
  assert.equal(ordinary.label, 'Continue')
  assert.equal(ordinary.disabled, false)
  assert.equal(ordinary.attackId, attack.id)
  assert.deepEqual(ordinary.attackRiders, [])
  assert.equal(ordinary.cost, '1 Simple')
  assert.equal(rider(item, 'huge-power-2').active, true)
  const confirm = item.children.at(-1)
  assert.deepEqual(confirm.attackRiders, selected)
  assert.equal(confirm.disabled, false)
  assert.equal(confirm.cost, `2 Simple + ${INSPIRATION_ACT_COST.standard + INSPIRATION_FATEFUL_COST.standard} Insp`)
})

test('options toggle off and replace mutually exclusive Bolster, Lifesteal and Huge Power variants', () => {
  let selected = toggleAttackRider([], 'bolster-bit-cpu')
  selected = toggleAttackRider(selected, 'bolster-damage-accuracy')
  assert.deepEqual(selected, ['bolster-damage-accuracy'])
  selected = toggleAttackRider(selected, 'lifesteal')
  assert.deepEqual(selected, ['lifesteal'])
  selected = toggleAttackRider(selected, 'huge-power')
  selected = toggleAttackRider(selected, 'huge-power-2')
  assert.deepEqual(selected, ['lifesteal', 'huge-power-2'])
  assert.deepEqual(toggleAttackRider(selected, 'lifesteal'), ['huge-power-2'])
  assert.equal(attackRiderSelection(selected).hugePower, true)
  assert.equal(attackRiderSelection(selected).hugePowerRank2, true)
  assert.deepEqual(attackRiderSelection([]), { bolster: false, bolsterType: 'damage-accuracy', lifesteal: false,
    hugePower: false, hugePowerRank2: false, actOfInspiration: false, fatefulIntervention: false })
})

test('rider availability respects actions, Bolster limits, cooldowns, Signature, Haste and Combat Monster', () => {
  const p = actor(), ctx = context()
  p.actionsRemaining.simple = 1
  assert.equal(rider(radialAttackItem(p, attack, ctx), 'bolster-bit-cpu').disabled, true)
  assert.equal(radialAttackItem(p, { ...attack, effect: 'Haste' }, ctx).disabled, true)
  p.actionsRemaining.simple = 2
  p.digimonBolsterCount = 2
  assert.equal(validAttackRiders(p, attack, ctx, ['bolster-damage-accuracy']), false)
  p.digimonBolsterCount = 0
  p.lastBitCpuBolsterRound = 2
  assert.equal(validAttackRiders(p, attack, ctx, ['bolster-bit-cpu']), false)
  assert.equal(validAttackRiders(p, attack, ctx, ['bolster-damage-accuracy']), true)
  assert.equal(validAttackRiders(p, { ...attack, tags: ['Signature Move'] }, ctx, ['bolster-damage-accuracy']), false)
  assert.equal(radialAttackItem(p, { ...attack, tags: ['Area Attack: Pass'] }, ctx).cost, '2 Simple')
  assert.equal(radialAttackItem(p, { ...attack, tags: ['Area Attack: Pass', 'Charge Attack'] }, ctx).cost, '1 Simple')
  ctx.eddySoulRules = { combatMonsterAreaAttackRequiresComplex: true }
  p.combatMonsterBonus = 1
  assert.equal(radialAttackItem(p, attack, ctx).cost, '2 Simple')
  assert.equal(validAttackRiders(p, attack, ctx, ['bolster-damage-accuracy']), false)
  p.lastHugePowerRound = 3
  assert.equal(validAttackRiders(p, attack, ctx, ['huge-power']), false)
  assert.equal(validAttackRiders(p, { ...attack, range: 'melee' }, ctx, ['huge-power']), true)
  p.lastHugePowerRank2Round = 3
  assert.equal(validAttackRiders(p, { ...attack, range: 'melee' }, ctx, ['huge-power-2']), false)
})

test('NPCs without a Tamer omit Inspiration options; absent qualities and wrong effects omit their riders', () => {
  const ctx = { ...context(), hasTamer: false, record: { qualities: [] } }
  const item = radialAttackItem(actor(), attack, ctx)
  assert.deepEqual(item.children.filter(child => child.attackRider).map(child => child.attackRider), ['bolster-damage-accuracy', 'bolster-bit-cpu'])
  assert.equal(validAttackRiders(actor(), attack, ctx, ['fateful-intervention']), false)
  assert.equal(validAttackRiders(actor(), attack, ctx, ['huge-power']), false)
  assert.equal(validAttackRiders(actor(), attack, ctx, ['lifesteal']), false)
  assert.equal(validAttackRiders(actor(), { ...attack, effect: 'Lifesteal' }, ctx, ['lifesteal']), true)
})

test('combined Inspiration costs are affordable together and invalid/stale rider sets cannot continue', () => {
  const ctx = context(), p = actor()
  ctx.inspiration = Math.max(INSPIRATION_ACT_COST.standard, INSPIRATION_FATEFUL_COST.standard)
  assert.equal(validAttackRiders(p, attack, ctx, ['act-of-inspiration']), true)
  assert.equal(validAttackRiders(p, attack, ctx, ['fateful-intervention']), true)
  assert.equal(validAttackRiders(p, attack, ctx, ['act-of-inspiration', 'fateful-intervention']), false)
  assert.equal(rider(radialAttackItem(p, attack, ctx, ['act-of-inspiration']), 'fateful-intervention').disabled, true)
  for (const invalid of [['unknown'], ['huge-power', 'huge-power'], ['huge-power', 'huge-power-2'], ['bolster-bit-cpu', 'lifesteal']]) {
    assert.equal(validAttackRiders(p, attack, ctx, invalid), false)
  }
  p.actionsRemaining.simple = 0
  assert.equal(radialAttackItem(p, attack, ctx).disabled, true)
})

test('root and child action costs include free GM controls, Direct, clash and free Mode Change swaps', () => {
  const items = ['move', 'stance', 'clash', 'clash-attack', 'clash-check', 'gm-move', 'gm-manage', 'mode-change'].map(id => ({ id, label: id }))
  items.push({ id: 'direct', label: 'Direct', children: ['direct', 'bolster'].map(id => ({ id: `direct:${id}`, label: id })) })
  let menu = withRadialActionCosts(items, actor(), { qualities: [{ choiceId: 'wrestlemania' }, { id: 'mode-change-x0', ranks: 2 }] }, { modeChangeFreeSwapsPerCombat: true })
  const cost = id => menu.find(item => item.id === id).cost
  assert.equal(cost('move'), '1 Simple')
  assert.equal(cost('clash'), 'Free')
  assert.equal(cost('clash-attack'), '2 Simple')
  assert.equal(cost('clash-check'), 'Free')
  assert.equal(cost('gm-move'), 'Free')
  assert.equal(cost('gm-manage'), 'Free')
  assert.equal(cost('mode-change'), 'Free')
  assert.deepEqual(menu.at(-1).children.map(item => item.cost), ['1 Simple', '2 Simple'])
  menu = withRadialActionCosts(items, { usedFreeClashThisRound: true, modeChangeFreeSwapsUsed: 3 }, { qualities: [{ choiceId: 'wrestlemania' }, { id: 'mode-change-x0', ranks: 2 }] }, { modeChangeFreeSwapsPerCombat: true })
  assert.equal(cost('clash'), '1 Simple')
  assert.equal(cost('mode-change'), '1 Simple')
})

test('names and action costs remain visible in narrow wedges at every orientation', () => {
  for (const width of [22, 30, 43, 60]) for (let angle = 0; angle < 360; angle += 15) {
    const rows = radialDetailRows({ label: 'Bolster Accuracy/Damage', cost: '2 Simple', active: true }, { inner: 145, outer: 225, start: angle, end: angle + width })
    assert.ok(rows.some(row => row.kind === 'label'))
    assert.deepEqual(rows.filter(row => row.kind === 'cost').map(row => row.text), ['2 Simple'])
  }
})
