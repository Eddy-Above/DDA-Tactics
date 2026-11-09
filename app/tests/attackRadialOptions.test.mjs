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
    hugePower: false, hugePowerRank2: false, shieldComplex: false, actOfInspiration: false, fatefulIntervention: false, chargeMode: null })
})

test('Charge movement is optional, mutually exclusive and compatible with the other third-tier options', () => {
  const charge = { ...attack, tags: ['Charge Attack'] }, p = actor(), ctx = context()
  const item = radialAttackItem(p, charge, ctx)
  assert.equal(rider(item, 'charge-before').label, 'Move Before Attack')
  assert.equal(rider(item, 'charge-after').label, 'Move After Attack')
  assert.equal(rider(item, 'charge-before').disabled, false)
  assert.equal(rider(item, 'charge-before').cost, 'No extra cost')
  assert.deepEqual(item.children.at(-1).attackRiders, [])
  assert.equal(attackRiderSelection([]).chargeMode, null, 'Continue without a movement choice means no move')
  let selected = toggleAttackRider(['huge-power', 'act-of-inspiration'], 'charge-before')
  assert.equal(attackRiderSelection(selected).chargeMode, 'before')
  selected = toggleAttackRider(selected, 'charge-after')
  assert.deepEqual(selected, ['huge-power', 'act-of-inspiration', 'charge-after'])
  assert.equal(attackRiderSelection(selected).chargeMode, 'after')
  assert.equal(validAttackRiders(p, charge, ctx, selected), true)
  assert.equal(radialAttackItem(p, charge, ctx, selected).children.at(-1).cost, `1 Simple + ${INSPIRATION_ACT_COST.standard} Insp`)
  assert.equal(attackRiderSelection(toggleAttackRider(selected, 'charge-after')).chargeMode, null)
  assert.equal(validAttackRiders(p, charge, ctx, ['charge-before', 'charge-after']), false)
})

test('ordinary attacks and Pass never offer or accept separate Charge movement choices', () => {
  for (const tags of [[], ['Area Attack: Burst'], ['Charge Attack', 'Area Attack: Pass']]) {
    const current = { ...attack, tags }, p = actor(), ctx = context()
    const item = radialAttackItem(p, current, ctx)
    assert.equal(rider(item, 'charge-before'), undefined)
    assert.equal(rider(item, 'charge-after'), undefined)
    assert.equal(validAttackRiders(p, current, ctx, ['charge-before']), false)
    assert.equal(validAttackRiders(p, current, ctx, ['charge-after']), false)
  }
})

test('Double Lifesteal and Triple Shield appear only for their effect and replace either Bolster option', () => {
  const p = actor(), ctx = context()
  for (const [effect, id, label] of [['Lifesteal', 'lifesteal', 'Double Lifesteal'], ['Shield', 'shield-complex', 'Triple Shield']]) {
    const current = { ...attack, effect }
    const choice = rider(radialAttackItem(p, current, ctx), id)
    assert.equal(choice.label, label)
    assert.equal(choice.cost, '2 Simple (Complex)')
    assert.equal(choice.disabled, false)
    assert.equal(radialAttackItem(p, current, ctx, [id]).children.at(-1).cost, '2 Simple')
    assert.equal(radialAttackItem(p, current, ctx).children.at(-1).cost, '1 Simple')
    for (const bolster of ['bolster-damage-accuracy', 'bolster-bit-cpu']) {
      assert.deepEqual(toggleAttackRider([bolster, 'huge-power'], id), ['huge-power', id])
      assert.deepEqual(toggleAttackRider([id, 'huge-power'], bolster), ['huge-power', bolster])
      assert.equal(validAttackRiders(p, current, ctx, [id, bolster]), false)
    }
    assert.equal(rider(radialAttackItem(p, attack, ctx), id), undefined)
    assert.equal(rider(radialAttackItem({ ...p, actionsRemaining: { simple: 1 } }, current, ctx), id).disabled, true)
  }
})

test('Shield is limited across all Shield attacks in a round, while Haste and Lag always cost two actions', () => {
  const p = actor(), ctx = context(), shield = { ...attack, effect: 'Shield' }
  p.lastShieldRound = ctx.round
  assert.equal(radialAttackItem(p, shield, ctx).disabled, true)
  assert.equal(validAttackRiders(p, shield, ctx, []), false)
  assert.equal(validAttackRiders(p, shield, ctx, ['shield-complex']), false)
  ctx.round++
  assert.equal(radialAttackItem(p, shield, ctx).disabled, false)
  for (const effect of ['Haste', 'Lag']) {
    const current = { ...attack, effect }
    assert.equal(radialAttackItem(p, current, ctx).cost, '2 Simple')
    assert.equal(validAttackRiders(p, current, ctx, ['bolster-damage-accuracy']), false)
    assert.equal(radialAttackItem({ ...p, actionsRemaining: { simple: 1 } }, current, ctx).disabled, true)
  }
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

test('partner evolution names the Tamer as payer on the root and every form choice; NPC costs remain their own', () => {
  const items = [{ id: 'digivolve', label: 'Digivolve', children: [
    { id: 'digivolve:1', label: 'Digivolve → Champion' }, { id: 'digivolve:0', label: 'Devolve → Rookie' },
  ] }]
  const tamers = [{ type: 'tamer', entityId: 'owner' }]
  let menu = withRadialActionCosts(items, actor(), { partnerId: 'owner' }, {}, tamers)
  assert.equal(menu[0].cost, 'Tamer: 1 Simple')
  assert.deepEqual(menu[0].children.map(item => item.cost), ['Tamer: 1 Simple', 'Tamer: 1 Simple'])
  menu = withRadialActionCosts(items, actor(), {}, {}, tamers)
  assert.equal(menu[0].cost, '1 Simple')
  menu = withRadialActionCosts(items, actor(), { partnerId: 'absent-owner' }, {}, tamers)
  assert.equal(menu[0].cost, '1 Simple', 'without a deployed owner, the server charges the Digimon')
})
