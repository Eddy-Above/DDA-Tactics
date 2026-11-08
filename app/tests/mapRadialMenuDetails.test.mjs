import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick } from 'vue'
import { loadTypeScript, loadVueComponent } from './helpers/loadTypeScript.mjs'

// The menu checks event targets against the browser's SVGElement.
globalThis.SVGElement ??= class SVGElement {}
const MapRadialMenu = loadVueComponent('components/MapRadialMenu.vue')
const { attackRadialItem } = loadTypeScript('utils/attackBadges.ts')
const { radialAttackItem } = loadTypeScript('utils/attackRadialOptions.ts')

// A tiny DOM-less renderer: real handlers and reactivity, no jsdom.
function createHost() {
  const node = (tag) => ({ tag, props: {}, children: [], parent: null, querySelectorAll: () => [] })
  const text = (value) => ({ tag: '#text', text: value, children: [], parent: null })
  const detach = (child) => {
    if (!child.parent) return
    child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const { render } = createRenderer({
    patchProp(el, key, _prev, next) { el.props[key] = next },
    insert(child, parent, anchor) {
      detach(child)
      child.parent = parent
      const at = anchor ? parent.children.indexOf(anchor) : -1
      if (at === -1) parent.children.push(child)
      else parent.children.splice(at, 0, child)
    },
    remove: detach,
    createElement: node,
    createText: text,
    createComment: (value) => ({ ...text(value), tag: '#comment' }),
    setText(el, value) { el.text = value },
    setElementText(el, value) { el.children = [{ ...text(value), parent: el }] },
    parentNode: (n) => n.parent,
    nextSibling(n) {
      const siblings = n.parent?.children
      return siblings ? siblings[siblings.indexOf(n) + 1] ?? null : null
    },
  })
  return { root: node('root'), render }
}

const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach(c => all(c, pred, out)); return out }
const textOf = (n) => (n.tag === '#text' ? n.text : n.children.map(textOf).join(''))
const ring = (root, which) => all(root, n => n.props?.['data-radial-item'] === which)
const classes = (n) => String(n.props?.class ?? '')
const rowsOf = (sector) => all(sector, n => n.tag === 'text').map(n => [classes(n), textOf(n)])

const base = { type: 'damage', description: '' }
const attacks = [
  { ...base, id: 'claw', name: 'Claw', range: 'melee', tags: [] },
  { ...base, id: 'blaze', name: 'Blaze Wave', range: 'ranged', effect: 'Paralysis', tags: ['Area Attack: Burst', 'Weapon II'] },
]

function attackMenuProps(choices = attacks, label = 'Agumon') {
  return {
    items: [
      { id: 'move', label: 'Move', icon: 'move' },
      {
        id: 'attack', label: 'Attack', icon: 'attack',
        children: choices.map(attack => ({ ...attackRadialItem(attack, false), id: `attack:${attack.id}` })),
      },
    ],
    center: { x: 400, y: 300 }, bounds: { width: 800, height: 600 }, label,
  }
}

function nestedItems(attackCount = 2, optionCount = 4) {
  return [{ id: 'attack', label: 'Attack', cost: 'Varies', children: Array.from({ length: attackCount }, (_, attack) => ({
    id: `attack-${attack}`, label: `Attack ${attack + 1}`, cost: '1 Simple',
    children: Array.from({ length: optionCount }, (_, option) => ({ id: `${attack}:option-${option}`, label: `Option ${attack + 1}.${option + 1}`, cost: '1 Simple' })),
  })) }]
}

async function mountNested(items = nestedItems(), center = { x: 450, y: 350 }) {
  const host = createHost(), selections = []
  const props = { items, center, bounds: { width: 900, height: 700 }, label: 'Agumon', onSelect: item => selections.push(item) }
  host.update = async nextItems => { props.items = nextItems; host.render(h(MapRadialMenu, { ...props }), host.root); await nextTick() }
  await host.update(items)
  const rootPath = ring(host.root, 'root')[0].children.find(n => n.tag === 'path').props.d
  ring(host.root, 'root')[0].props.onClick()
  await nextTick()
  return { ...host, props, selections, rootPath }
}

test('switching attacks keeps both parent tiers, and Back removes one concentric tier at a time', async () => {
  const host = await mountNested()
  const firstAttackPath = ring(host.root, 'child')[0].children.find(n => n.tag === 'path').props.d
  ring(host.root, 'child')[0].props.onClick()
  await nextTick()
  assert.equal(ring(host.root, 'root')[0].children.find(n => n.tag === 'path').props.d, host.rootPath)
  assert.equal(ring(host.root, 'child')[0].children.find(n => n.tag === 'path').props.d, firstAttackPath)
  assert.equal(ring(host.root, 'third')[0].props['aria-label'], 'Option 1.1')
  ring(host.root, 'child')[1].props.onClick()
  await nextTick()
  assert.equal(ring(host.root, 'third')[0].props['aria-label'], 'Option 2.1')
  assert.equal(ring(host.root, 'child').length, 2)
  assert.equal(ring(host.root, 'child')[0].props['aria-expanded'], false)
  assert.equal(ring(host.root, 'child')[1].props['aria-expanded'], true)
  const back = () => all(host.root, n => n.tag === 'button')[0].props.onClick()
  back()
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 0)
  assert.equal(ring(host.root, 'child').length, 2)
  back()
  await nextTick()
  assert.equal(ring(host.root, 'child').length, 0)
  assert.equal(ring(host.root, 'root').length, 1)
  assert.deepEqual(host.selections, [])
  host.render(null, host.root)
})

test('attack and option pages are independent and the selected attack page survives Back', async () => {
  const host = await mountNested(nestedItems(10, 11))
  ring(host.root, 'child').at(-1).props.onClick()
  await nextTick()
  const secondPage = ring(host.root, 'child').map(item => item.props['aria-label'])
  assert.equal(secondPage[0], 'Attack 8')
  ring(host.root, 'child')[0].props.onClick()
  await nextTick()
  assert.deepEqual(ring(host.root, 'child').map(item => item.props['aria-label']), secondPage)
  assert.equal(ring(host.root, 'third')[0].props['aria-label'], 'Option 8.1')
  ring(host.root, 'third').at(-1).props.onClick()
  await nextTick()
  assert.equal(ring(host.root, 'third')[0].props['aria-label'], 'Option 8.8')
  assert.deepEqual(ring(host.root, 'child').map(item => item.props['aria-label']), secondPage)
  all(host.root, n => n.tag === 'button')[0].props.onClick()
  await nextTick()
  assert.deepEqual(ring(host.root, 'child').map(item => item.props['aria-label']), secondPage)
  ring(host.root, 'child')[0].props.onClick()
  await nextTick()
  ring(host.root, 'child').at(-1).props.onClick()
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 0, 'changing attack pages closes that attack’s options')
  assert.equal(ring(host.root, 'child')[0].props['aria-label'], 'Attack 1')
  assert.deepEqual(host.selections, [])
  host.render(null, host.root)
})

test('keyboard navigation opens and closes the correct concentric tier', async () => {
  const host = await mountNested()
  const menu = all(host.root, n => n.props?.role === 'menu')[0]
  const key = (key, tier, label) => menu.props.onKeydown({ key, preventDefault() {}, stopPropagation() {}, target: { dataset: { radialItem: tier }, getAttribute: () => label } })
  key('ArrowRight', 'child', 'Attack 1')
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 4)
  key('ArrowLeft', 'third', 'Option 1.1')
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 0)
  assert.equal(ring(host.root, 'child').length, 2)
  key('ArrowRight', 'child', 'Attack 2')
  await nextTick()
  key('Escape', 'third', 'Option 2.1')
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 0)
  key('ArrowLeft', 'child', 'Attack 2')
  await nextTick()
  assert.equal(ring(host.root, 'child').length, 0)
  host.render(null, host.root)
})

test('a stale attack closes only its options tier while a disabled root closes both descendant tiers', async () => {
  const host = await mountNested()
  ring(host.root, 'child')[0].props.onClick()
  await nextTick()
  const updated = nestedItems()
  updated[0].children[0].disabled = true
  await host.update(updated)
  assert.equal(ring(host.root, 'third').length, 0)
  assert.equal(ring(host.root, 'child').length, 2)
  ring(host.root, 'child')[1].props.onClick()
  await nextTick()
  assert.equal(ring(host.root, 'third').length, 4)
  await host.update([{ ...updated[0], disabled: true }])
  assert.equal(ring(host.root, 'child').length, 0)
  assert.equal(ring(host.root, 'third').length, 0)
  host.render(null, host.root)
})

async function mountAttackRing(choices = attacks) {
  const host = createHost()
  host.render(h(MapRadialMenu, attackMenuProps(choices)), host.root)
  await nextTick()
  const attack = ring(host.root, 'root').find(sector => sector.props['aria-label'] === 'Attack')
  attack.props.onClick()
  await nextTick()
  return host
}

test('Attack, the chosen attack and its options remain visible in three separate radial tiers', async () => {
  const host = createHost(), selections = []
  const actor = { type: 'digimon', actionsRemaining: { simple: 2 } }
  const context = { record: { qualities: [] }, round: 2, campaignLevel: 'standard', hasTamer: false, inspiration: 0, fatefulAvailable: false }
  function render(selected = []) {
    const item = radialAttackItem(actor, attacks[0], context, selected)
    host.render(h(MapRadialMenu, { items: [{ id: 'attack', label: 'Attack', cost: 'Varies', children: [item] }],
      center: { x: 400, y: 300 }, bounds: { width: 800, height: 600 }, label: 'Agumon', onSelect: item => selections.push(item) }), host.root)
  }
  render()
  await nextTick()
  assert.ok(rowsOf(ring(host.root, 'root')[0]).some(([kind, text]) => kind === 'sector-cost' && text.includes('Varies')))
  ring(host.root, 'root')[0].props.onClick()
  await nextTick()
  ring(host.root, 'child')[0].props.onClick()
  await nextTick()
  assert.deepEqual(ring(host.root, 'root').map(choice => choice.props['aria-label']), ['Attack'])
  const attacksRing = ring(host.root, 'child')
  assert.deepEqual(attacksRing.map(choice => choice.props['aria-label']), ['Claw'])
  assert.equal(attacksRing[0].props['aria-expanded'], true)
  assert.ok(classes(attacksRing[0]).includes('selected'))
  let choices = ring(host.root, 'third')
  assert.deepEqual(choices.map(choice => choice.props['aria-label']), ['Bolster Accuracy/Damage', 'Bolster BIT/CPU', 'Continue'])
  const rootGeometry = sectorGeometry(ring(host.root, 'root')[0])
  const attackGeometry = sectorGeometry(attacksRing[0])
  const optionsGeometry = sectorGeometry(choices[0])
  assert.ok(attackGeometry.inner > rootGeometry.outer, 'attacks occupy the second concentric ring')
  assert.ok(optionsGeometry.inner > attackGeometry.outer, 'options occupy a distinct third concentric ring')
  for (const sector of [...attacksRing, ...choices]) for (const row of all(sector, n => n.tag === 'text')) assertTextInsideSector(sector, row)
  assert.ok(rowsOf(choices[2]).some(([kind, text]) => kind === 'sector-cost' && text === '1 Simple'))
  choices[1].props.onClick()
  assert.equal(selections[0].attackRider, 'bolster-bit-cpu')
  render(['bolster-bit-cpu'])
  await nextTick()
  choices = ring(host.root, 'third')
  assert.deepEqual(ring(host.root, 'child').map(choice => choice.props['aria-label']), ['Claw'])
  assert.ok(rowsOf(choices[1]).some(([kind]) => kind === 'choice-current'))
  assert.ok(rowsOf(choices[2]).some(([kind, text]) => kind === 'sector-cost' && text === '2 Simple'))
  choices[2].props.onClick()
  assert.deepEqual(selections[1].attackRiders, ['bolster-bit-cpu'])
  render([])
  await nextTick()
  ring(host.root, 'third')[2].props.onClick()
  assert.deepEqual(selections[2].attackRiders, [])
  host.render(null, host.root)
})

test('attack choices draw range type, AoE type, effect and tags on the outer ring', async () => {
  const host = await mountAttackRing()
  const [claw, blaze] = ring(host.root, 'child')

  assert.deepEqual(rowsOf(claw), [['sector-label', 'Claw'], ['sector-meta', 'Melee']])
  assert.deepEqual(rowsOf(blaze), [
    ['sector-label', 'Blaze Wave'],
    ['sector-meta', 'Ranged · Burst'],
    ['sector-effect', 'Paralysis'],
    ['sector-tags', 'Weapon II'],
  ])
  const ys = all(blaze, n => n.tag === 'text').map(n => Number(n.props.y))
  assert.ok(ys.every((y, index) => index === 0 || y > ys[index - 1]), 'rows stack top to bottom')
  assert.match(textOf(blaze.children.find(n => n.tag === 'title')), /Ranged · Burst · Paralysis · Area Attack: Burst · Weapon II/)
  host.render(null, host.root)
})

test('choices without attack details keep the original label-only sector', async () => {
  const host = createHost()
  const items = [{
    id: 'stance', label: 'Stance',
    children: [{ id: 'stance:neutral', label: 'Neutral', active: true }, { id: 'stance:brave', label: 'Brave' }],
  }]
  host.render(h(MapRadialMenu, { items, center: { x: 400, y: 300 }, bounds: { width: 800, height: 600 }, label: 'Agumon' }), host.root)
  await nextTick()
  ring(host.root, 'root')[0].props.onClick()
  await nextTick()
  const [neutral, brave] = ring(host.root, 'child')
  assert.deepEqual(rowsOf(neutral).map(([cls]) => cls), ['choice-current', 'sector-label'])
  assert.deepEqual(rowsOf(brave), [['sector-label', 'Brave']])
  assert.ok(all(brave, n => n.tag === 'tspan').length === 1, 'plain labels keep their tspan line layout')
  host.render(null, host.root)
})

const detailedAttacks = Array.from({ length: 8 }, (_, index) => ({
  ...base,
  id: `detailed-${index}`,
  name: `Transcendent Dragon Flame Attack ${index + 1}`,
  range: 'ranged', effect: 'Paralysis',
  tags: ['Area Attack: Close Blast', 'Weapon II', 'Charge Attack', 'Signature Move'],
}))

const numbersIn = (value) => String(value).match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number)
const degrees = (x, y) => Math.atan2(y, x) * 180 / Math.PI

function sectorGeometry(sector) {
  // M outer-start, A outer-radius/flags/end, L inner-end, A inner-radius/flags/start.
  const values = numbersIn(sector.children.find(n => n.tag === 'path').props.d)
  const start = degrees(values[0], values[1])
  const end = degrees(values[7], values[8])
  return { inner: values[11], outer: values[2], start, sweep: (end - start + 360) % 360 }
}

const fontSizes = { 'choice-current': 7, 'sector-label': 10.5, 'sector-cost': 8.5, 'sector-meta': 8.5, 'sector-effect': 9, 'sector-tags': 8 }

test('three-tier fans fit at viewport edges and use separate clips for attack and option sectors', async () => {
  for (const center of [{ x: 12, y: 12 }, { x: 450, y: 12 }, { x: 888, y: 12 }, { x: 888, y: 350 },
    { x: 888, y: 688 }, { x: 450, y: 688 }, { x: 12, y: 688 }, { x: 12, y: 350 }]) {
    const host = await mountNested(nestedItems(1, 4), center)
    ring(host.root, 'child')[0].props.onClick()
    await nextTick()
    const menu = all(host.root, n => n.props?.role === 'menu')[0]
    assert.equal(menu.props.style.left, `${center.x}px`)
    assert.equal(menu.props.style.top, `${center.y}px`)
    const allSectors = ['root', 'child', 'third'].flatMap(tier => ring(host.root, tier))
    assert.ok(ring(host.root, 'third').length > 0)
    for (const sector of allSectors) {
      const geometry = sectorGeometry(sector)
      for (let fraction = 0; fraction <= 1; fraction += .1) {
        const angle = (geometry.start + geometry.sweep * fraction) * Math.PI / 180
        for (const radius of [geometry.inner, geometry.outer]) {
          const x = center.x + Math.cos(angle) * radius, y = center.y + Math.sin(angle) * radius
          assert.ok(x >= 0 && x <= 900 && y >= 0 && y <= 700, `${sector.props['data-radial-item']} stays in the viewport`)
        }
      }
    }
    const clips = all(host.root, n => n.tag === 'clipPath')
    assert.equal(new Set(clips.map(clip => clip.props.id)).size, clips.length)
    for (const sector of allSectors.filter(sector => sector.props['data-radial-item'] !== 'root')) {
      for (const row of all(sector, n => n.tag === 'text')) assertTextInsideSector(sector, row)
      const clipped = sector.children.find(child => child.props?.['clip-path'])
      if (!clipped) { assert.equal(sector.props['aria-label'], 'More'); continue }
      const id = clipped.props['clip-path'].slice(5, -1)
      const clip = clips.find(clip => clip.props.id === id)
      assert.equal(clip.children[0].props.d, sector.children.find(child => child.tag === 'path').props.d)
    }
    host.render(null, host.root)
  }
})

function assertTextInsideSector(sector, row) {
  const geometry = sectorGeometry(sector)
  const content = all(sector, n => n.tag === 'g' && classes(n) === 'sector-content')[0]
  const [translateX, translateY] = numbersIn(content.props.transform)
  const size = fontSizes[classes(row)]
  const width = textOf(row).length * size * .62
  const cx = translateX + Number(row.props.x ?? 0)
  const baseline = translateY + Number(row.props.y)
  const top = baseline - size * .8
  const bottom = baseline + size * .2
  for (let ix = 0; ix <= 6; ix++) {
    for (let iy = 0; iy <= 6; iy++) {
      const x = cx - width / 2 + width * ix / 6
      const y = top + (bottom - top) * iy / 6
      const radius = Math.hypot(x, y)
      let angle = degrees(x, y)
      angle += 360 * Math.round((geometry.start + geometry.sweep / 2 - angle) / 360)
      const reason = `${classes(row)} "${textOf(row)}" must fit its own ${geometry.start.toFixed(1)}° wedge`
      assert.ok(radius >= geometry.inner - 1e-6 && radius <= geometry.outer + 1e-6, reason)
      assert.ok(angle >= geometry.start - 1e-6 && angle <= geometry.start + geometry.sweep + 1e-6, reason)
    }
  }
}

test('eight detailed attacks fit text into their individual wedges, including diagonal sectors', async () => {
  const host = await mountAttackRing(detailedAttacks)
  const choices = ring(host.root, 'child')
  assert.equal(choices.length, 8)
  let shiftedRows = 0
  for (const sector of choices) {
    const rows = all(sector, n => n.tag === 'text')
    assert.ok(rows.length >= 3, 'attack details remain visible rather than relying only on clipping')
    for (const row of rows) {
      if (Math.abs(Number(row.props.x ?? 0)) > .5) shiftedRows++
      assertTextInsideSector(sector, row)
    }
    const clipWrapper = sector.children.find(n => n.props?.['clip-path'])
    assert.ok(clipWrapper, 'a sector clip catches font rendering differences')
    assert.equal(clipWrapper.props.transform, undefined, 'the clip stays in the sector coordinate system')
  }
  assert.ok(shiftedRows > 0, 'diagonal text rows adjust horizontally to the available wedge slice')
  host.render(null, host.root)
})

test('abbreviated attack names retain the full name and metadata in title and accessible description', async () => {
  const host = await mountAttackRing(detailedAttacks)
  for (const [index, sector] of ring(host.root, 'child').entries()) {
    const attack = detailedAttacks[index]
    const visibleName = rowsOf(sector).filter(([kind]) => kind === 'sector-label').map(([, text]) => text).join(' ')
    assert.notEqual(visibleName, attack.name, 'the narrow wedge abbreviates this long attack name')
    assert.equal(sector.props['aria-label'], attack.name)
    const title = textOf(sector.children.find(n => n.tag === 'title'))
    assert.ok(title.includes(attack.name))
    for (const detail of ['Ranged', 'Close Blast', 'Paralysis', ...attack.tags]) {
      assert.ok(title.includes(detail), `title preserves ${detail}`)
      assert.ok(sector.props['aria-description'].includes(detail), `accessible description preserves ${detail}`)
    }
  }
  host.render(null, host.root)
})

test('two menu instances give every child sector its own clip definition and reference', async () => {
  const host = createHost()
  const MenuPair = { setup: () => () => h('div', null, [
    h(MapRadialMenu, attackMenuProps(detailedAttacks, 'Agumon')),
    h(MapRadialMenu, attackMenuProps(detailedAttacks, 'Gabumon')),
  ]) }
  host.render(h(MenuPair), host.root)
  await nextTick()
  const menus = all(host.root, n => n.props?.role === 'menu')
  assert.equal(menus.length, 2)
  for (const menu of menus) {
    ring(menu, 'root').find(sector => sector.props['aria-label'] === 'Attack').props.onClick()
  }
  await nextTick()
  const allIds = []
  for (const menu of menus) {
    const definitions = all(menu, n => n.tag === 'clipPath')
    const ids = new Set(definitions.map(definition => definition.props.id))
    assert.equal(ids.size, 8)
    allIds.push(...ids)
    for (const definition of definitions) {
      assert.equal(definition.props.clipPathUnits, 'userSpaceOnUse')
    }
    for (const sector of ring(menu, 'child')) {
      const wrapper = sector.children.find(n => n.props?.['clip-path'])
      const reference = wrapper.props['clip-path'].match(/^url\(#(.+)\)$/)?.[1]
      assert.ok(ids.has(reference), 'the content references a clip from its own menu')
      const definition = definitions.find(item => item.props.id === reference)
      assert.equal(definition.children.find(n => n.tag === 'path').props.d, sector.children.find(n => n.tag === 'path').props.d)
    }
  }
  assert.equal(new Set(allIds).size, allIds.length, 'sibling menu instances cannot share clip IDs')
  host.render(null, host.root)
})
