import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, createRenderer, h, nextTick, reactive, ref, watch } from 'vue'
import { loadVueComponent } from './helpers/loadTypeScript.mjs'

// MapPlayerHUD relies on Nuxt's auto-imported Vue APIs.
Object.assign(globalThis, { ref, computed, watch })
const MapPlayerHUD = loadVueComponent('components/MapPlayerHUD.vue')

// ── A tiny DOM-less renderer: real handlers, real reactivity, no jsdom ─────────────────────────
function createHost() {
  const node = (tag) => ({ tag, props: {}, children: [], parent: null })
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

const walk = (n, fn) => { fn(n); n.children.forEach(c => walk(c, fn)) }
const all = (n, pred) => { const out = []; walk(n, c => { if (pred(c)) out.push(c) }); return out }
const classesOf = (n) => String(n.props?.class ?? '').split(/\s+/).filter(Boolean)
const byClass = (n, cls) => all(n, c => !c.tag.startsWith('#') && classesOf(c).includes(cls))
const textOf = (n) => (n.tag === '#text' ? n.text : n.children.map(textOf).join(''))

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
const participants = [
  { id: 'P-tai', type: 'tamer', entityId: 't1' },
  { id: 'P-agumon', type: 'digimon', entityId: 'd1' },
  { id: 'P-devimon', type: 'digimon', entityId: 'd2' },
]
const tamerMap = { t1: { name: 'Tai', currentWounds: 0, woundBoxes: 6 } }
const digimonMap = {
  d1: { name: 'Agumon', currentWounds: 1, woundBoxes: 8 },
  d2: { name: 'Devimon', currentWounds: 0, woundBoxes: 10 },
}

function mount(initial = {}) {
  const state = reactive({
    participants, tamerMap, digimonMap, isDm: false, myTamerId: 't1',
    myParticipantIds: ['P-tai', 'P-agumon'],
    ...initial,
  })
  const emitted = []
  const record = (name) => (...args) => emitted.push([name, ...args])
  const host = createHost()
  host.render(h({
    render: () => h(MapPlayerHUD, {
      ...state,
      onSelectPlacement: record('select-placement'),
      onPlacementDragStart: record('placement-drag-start'),
      onPlacementDragEnd: record('placement-drag-end'),
    }),
  }), host.root)
  const cards = () => byClass(host.root, 'hud-card')
  const cardFor = (name) => cards().find(c => textOf(c).includes(name))
  return { state, emitted, host, cards, cardFor }
}

const isPlaceable = (card) => classesOf(card).includes('placeable')

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────
test('with placement inactive the HUD is display-only: no buttons, drag handles, badges or hint', async () => {
  const { host, cards } = mount()
  assert.equal(cards().length, 2)
  for (const card of cards()) {
    assert.equal(isPlaceable(card), false)
    assert.equal(card.props.role, undefined)
    assert.equal(card.props.draggable, undefined)
    assert.equal(card.props.onClick, undefined)
  }
  assert.equal(byClass(host.root, 'place-badge').length, 0)
  assert.equal(byClass(host.root, 'hud-hint').length, 0)
  assert.equal(classesOf(byClass(host.root, 'player-hud')[0]).includes('placing'), false)
})

test('setup, player: own cards are buttons and drag sources, with a placed/unplaced badge and a hint', async () => {
  const { host, cards, cardFor } = mount({
    placementActive: true, setupPlacement: true,
    placeableIds: ['P-tai', 'P-agumon'], placedIds: ['P-tai'],
  })
  assert.equal(cards().length, 2, 'a player still only sees their own characters')
  for (const card of cards()) {
    assert.equal(isPlaceable(card), true)
    assert.equal(card.props.role, 'button')
    assert.equal(card.props.tabindex, 0)
    assert.equal(card.props.draggable, true)
  }
  assert.equal(textOf(byClass(cardFor('Tai'), 'place-badge')[0]), '✓')
  assert.equal(textOf(byClass(cardFor('Agumon'), 'place-badge')[0]), '📍')
  assert.match(textOf(byClass(host.root, 'hud-hint')[0]), /drag it onto the map/)
  assert.ok(classesOf(byClass(host.root, 'player-hud')[0]).includes('placing'))
})

test('clicking, Enter and Space arm a card; other keys do not', async () => {
  const { emitted, cardFor } = mount({
    placementActive: true, setupPlacement: true, placeableIds: ['P-tai', 'P-agumon'], placedIds: [],
  })
  const card = cardFor('Agumon')
  card.props.onClick()
  let prevented = 0
  card.props.onKeydown({ key: 'Enter', preventDefault: () => prevented++ })
  card.props.onKeydown({ key: ' ', preventDefault: () => prevented++ })
  card.props.onKeydown({ key: 'a', preventDefault: () => prevented++ })
  assert.deepEqual(emitted, [
    ['select-placement', 'P-agumon'],
    ['select-placement', 'P-agumon'],
    ['select-placement', 'P-agumon'],
  ])
  assert.equal(prevented, 2, 'the page must not scroll on Space')
})

test('dragging a card announces itself, carries its id, and reports when the drag ends', async () => {
  const { emitted, cardFor } = mount({
    placementActive: true, setupPlacement: true, placeableIds: ['P-agumon'], placedIds: [],
  })
  const data = {}
  let dragImageSet = false
  const dataTransfer = {
    effectAllowed: '',
    setData: (type, value) => { data[type] = value },
    setDragImage: () => { dragImageSet = true },
  }
  const card = cardFor('Agumon')
  card.props.onDragstart({ dataTransfer, currentTarget: { querySelector: () => null } })
  assert.equal(data['text/plain'], 'P-agumon', 'Firefox needs data or the drag never starts')
  assert.equal(dataTransfer.effectAllowed, 'move')
  assert.equal(dragImageSet, false, 'no sprite image, so the browser default drag image is used')
  card.props.onDragend()
  assert.deepEqual(emitted, [['placement-drag-start', 'P-agumon'], ['placement-drag-end']])
})

test('a loaded sprite becomes the drag image', async () => {
  const { cardFor } = mount({
    placementActive: true, setupPlacement: true, placeableIds: ['P-agumon'], placedIds: [],
  })
  let image = null
  const sprite = { complete: true, naturalWidth: 64, width: 40, height: 40 }
  cardFor('Agumon').props.onDragstart({
    dataTransfer: { setData() {}, setDragImage: (img, x, y) => { image = { img, x, y } } },
    currentTarget: { querySelector: (sel) => (sel === 'img.sprite-img' ? sprite : null) },
  })
  assert.deepEqual(image, { img: sprite, x: 20, y: 20 })
})

test('combat: only unplaced characters are offered, so a placed one cannot be yanked off the board', async () => {
  const { host, emitted, cardFor } = mount({
    placementActive: true, setupPlacement: false,
    placeableIds: ['P-agumon'], placedIds: ['P-tai'],
  })
  const placed = cardFor('Tai')
  const unplaced = cardFor('Agumon')
  assert.equal(isPlaceable(placed), false)
  assert.equal(placed.props.draggable, undefined)
  assert.equal(placed.props.onClick, undefined)
  assert.equal(byClass(placed, 'place-badge').length, 0)
  assert.equal(isPlaceable(unplaced), true)
  assert.equal(unplaced.props.draggable, true)
  assert.match(textOf(byClass(host.root, 'hud-hint')[0]), /Select or drag a deployed character/)
  unplaced.props.onClick()
  assert.deepEqual(emitted, [['select-placement', 'P-agumon']])
})

test('an armed card is highlighted and the hint names who is being placed', async () => {
  const { host, state, cardFor } = mount({
    placementActive: true, setupPlacement: true,
    placeableIds: ['P-tai', 'P-agumon'], placedIds: [], armedId: 'P-agumon',
  })
  assert.ok(classesOf(cardFor('Agumon')).includes('armed'))
  assert.equal(classesOf(cardFor('Tai')).includes('armed'), false)
  assert.equal(textOf(byClass(host.root, 'hud-hint')[0]), 'Click a tile to place Agumon')
  state.armedId = null
  await nextTick()
  assert.equal(classesOf(cardFor('Agumon')).includes('armed'), false)
  assert.match(textOf(byClass(host.root, 'hud-hint')[0]), /Select a character/)
})

test('GM: every deployed unit gets the same controls on its compact card', async () => {
  const { host, emitted, cards, cardFor } = mount({
    isDm: true,
    placementActive: true, setupPlacement: true,
    placeableIds: ['P-tai', 'P-agumon', 'P-devimon'], placedIds: ['P-devimon'],
  })
  assert.equal(cards().length, 3, 'the GM sees all participants')
  for (const card of cards()) {
    assert.ok(classesOf(card).includes('compact'))
    assert.equal(isPlaceable(card), true)
    assert.equal(card.props.draggable, true)
  }
  assert.equal(textOf(byClass(cardFor('Devimon'), 'place-badge')[0]), '✓')
  assert.equal(textOf(byClass(cardFor('Tai'), 'place-badge')[0]), '📍')
  cardFor('Devimon').props.onClick()
  assert.deepEqual(emitted, [['select-placement', 'P-devimon']])
  assert.equal(textOf(byClass(host.root, 'hud-title')[0]), 'All Participants')
})

test('minimised: the icon counts characters still to place and flags the armed one', async () => {
  const { host, state } = mount({
    placementActive: true, setupPlacement: true,
    placeableIds: ['P-tai', 'P-agumon'], placedIds: ['P-tai'],
  })
  byClass(host.root, 'hud-min-btn')[0].props.onClick()
  await nextTick()
  const [icon] = byClass(host.root, 'hud-icon')
  assert.ok(icon, 'minimised to the icon')
  assert.equal(textOf(byClass(icon, 'hud-icon-badge')[0]), '1')
  assert.equal(icon.props.title, 'Show HUD — 1 to place')
  assert.equal(classesOf(icon).includes('armed'), false)

  state.armedId = 'P-agumon'
  await nextTick()
  const [armedIcon] = byClass(host.root, 'hud-icon')
  assert.ok(classesOf(armedIcon).includes('armed'))
  assert.equal(armedIcon.props.title, 'Placing Agumon')
})

test('minimised with nothing left to place: no badge and the plain title', async () => {
  const { host } = mount({
    placementActive: true, setupPlacement: true,
    placeableIds: ['P-tai', 'P-agumon'], placedIds: ['P-tai', 'P-agumon'],
  })
  byClass(host.root, 'hud-min-btn')[0].props.onClick()
  await nextTick()
  const [icon] = byClass(host.root, 'hud-icon')
  assert.equal(byClass(icon, 'hud-icon-badge').length, 0)
  assert.equal(icon.props.title, 'Show HUD')
})

test('a new placement round expands a minimised HUD, but ending one does not touch it', async () => {
  const { host, state } = mount({ placementActive: false })
  byClass(host.root, 'hud-min-btn')[0].props.onClick()
  await nextTick()
  assert.equal(byClass(host.root, 'hud-icon').length, 1)

  Object.assign(state, { placementActive: true, setupPlacement: false, placeableIds: ['P-agumon'], placedIds: [] })
  await nextTick()
  assert.equal(byClass(host.root, 'hud-icon').length, 0, 'opened by itself so placement is reachable')
  assert.equal(byClass(host.root, 'player-hud').length, 1)

  byClass(host.root, 'hud-min-btn')[0].props.onClick()
  await nextTick()
  state.placementActive = false
  await nextTick()
  assert.equal(byClass(host.root, 'hud-icon').length, 1, 'a manual minimise sticks when placement ends')
})
