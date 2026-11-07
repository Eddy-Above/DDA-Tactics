import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createTokenDragController } = loadTypeScript('utils/tokenDrag.ts')

const ptr = (x, y, extra = {}) => ({ clientX: x, clientY: y, button: 0, isPrimary: true, ...extra })
const CELL = { x: 4, y: 0, z: 7 }

// A controller wired to a fake adapter that records every effect, in order.
function setup(over = {}) {
  const log = []
  const world = { draggable: ['agumon'], allowed: true, tokenAt: 'agumon', drop: CELL }
  const adapter = {
    draggableIds: () => world.draggable,
    allowed: () => world.allowed,
    tokenAt: () => world.tokenAt,
    preview: (e, id) => log.push(['preview', id, e.clientX, e.clientY]),
    resolveDrop: () => world.drop,
    commit: (id, cell) => log.push(['commit', id, cell]),
    clearPreview: () => log.push(['clearPreview']),
    lockCamera: () => log.push(['lock']),
    unlockCamera: () => log.push(['unlock']),
    setCursor: (c) => log.push(['cursor', c]),
    begin: () => log.push(['begin']),
    swallowNextClick: () => log.push(['swallow']),
    ...over,
  }
  const drag = createTokenDragController(adapter)
  const names = () => log.map(l => l[0])
  const count = (name) => log.filter(l => l[0] === name).length
  return { drag, log, world, names, count }
}

test('pressing a draggable token locks the camera before anything else can pan it', () => {
  const { drag, log } = setup()
  drag.pointerDown(ptr(100, 100))
  assert.deepEqual(log, [['lock']])
  assert.equal(drag.isPressed(), true)
})

test('a click on a token (no travel) hands the camera back and leaves the click alone', () => {
  const { drag, names, count } = setup()
  drag.pointerDown(ptr(100, 100))
  drag.pointerMove(ptr(102, 101))
  drag.pointerUp(ptr(102, 101))
  assert.equal(count('begin'), 0)
  assert.equal(count('preview'), 0)
  assert.equal(count('commit'), 0)
  assert.equal(count('swallow'), 0, 'the real click must still reach the radial/health-bar handlers')
  assert.equal(names().at(-1) === 'clearPreview' && count('unlock') === 1, true)
  assert.equal(drag.isPressed(), false)
})

test('a real drag previews while moving, then commits the cell and swallows the trailing click', () => {
  const { drag, log, names, count } = setup()
  drag.pointerDown(ptr(100, 100))
  drag.pointerMove(ptr(110, 100))
  drag.pointerMove(ptr(140, 120))
  assert.equal(count('begin'), 1, 'dismissed once, on the first move past the threshold')
  assert.deepEqual(log.filter(l => l[0] === 'cursor'), [['cursor', 'grabbing']])
  assert.deepEqual(log.filter(l => l[0] === 'preview'), [['preview', 'agumon', 110, 100], ['preview', 'agumon', 140, 120]])
  drag.pointerUp(ptr(140, 120))
  assert.deepEqual(log.filter(l => l[0] === 'commit'), [['commit', 'agumon', CELL]])
  assert.equal(count('swallow'), 1)
  assert.equal(count('unlock'), 1)
  assert.ok(names().indexOf('swallow') < names().indexOf('commit'), 'the click is swallowed even if commit throws')
})

test('a drop the rules refuse commits nothing, but still restores the camera and eats the click', () => {
  const { drag, world, count } = setup()
  world.drop = null
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(50, 0))
  drag.pointerUp(ptr(50, 0))
  assert.equal(count('commit'), 0)
  assert.equal(count('unlock'), 1)
  assert.equal(count('swallow'), 1)
  assert.equal(count('clearPreview'), 1)
})

test('Escape mid-drag ends the gesture: preview gone, no commit, camera back only once released', () => {
  const { drag, log, names, count } = setup()
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(50, 0))
  assert.equal(drag.abort(), true)
  assert.equal(count('clearPreview'), 1)
  assert.equal(count('unlock'), 0, 'the button is still down')
  const before = log.length
  drag.pointerMove(ptr(90, 0))
  assert.equal(log.length, before, 'further movement is ignored')
  drag.pointerUp(ptr(90, 0))
  assert.equal(count('commit'), 0)
  assert.equal(count('unlock'), 1)
  assert.equal(count('swallow'), 1, 'releasing after Escape must not click through to a menu')
  assert.ok(names().includes('unlock'))
})

test('Escape with nothing being dragged is not consumed, so it can close menus as before', () => {
  const { drag, log } = setup()
  assert.equal(drag.abort(), false)
  drag.pointerDown(ptr(0, 0))
  drag.pointerUp(ptr(0, 0))
  assert.equal(drag.abort(), false)
  assert.equal(log.some(l => l[0] === 'swallow'), false)
})

test('a press that does not qualify never touches the camera', () => {
  for (const [label, press, mutate] of [
    ['another mode owns the button', ptr(0, 0), w => { w.allowed = false }],
    ['nothing is draggable', ptr(0, 0), w => { w.draggable = [] }],
    ['draggable list missing', ptr(0, 0), w => { w.draggable = undefined }],
    ['pressed token is not offered', ptr(0, 0), w => { w.tokenAt = 'devimon' }],
    ['press missed every token', ptr(0, 0), w => { w.tokenAt = null }],
    ['right button', ptr(0, 0, { button: 2 }), () => {}],
    ['middle button', ptr(0, 0, { button: 1 }), () => {}],
    ['second finger', ptr(0, 0, { isPrimary: false }), () => {}],
  ]) {
    const { drag, world, log } = setup()
    mutate(world)
    drag.pointerDown(press)
    drag.pointerMove(ptr(80, 80))
    drag.pointerUp(ptr(80, 80))
    assert.deepEqual(log, [], label)
    assert.equal(drag.isPressed(), false, label)
  }
})

test('the offer is re-checked at the drop: a unit no longer draggable is not committed', () => {
  const { drag, world, count } = setup()
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(60, 0))
  world.draggable = []   // e.g. the phase moved on mid-drag
  drag.pointerUp(ptr(60, 0))
  assert.equal(count('commit'), 0)
  assert.equal(count('unlock'), 1)
})

test('a cancelled pointer (browser took over) restores the camera without committing or swallowing', () => {
  const { drag, log, count } = setup()
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(60, 0))
  drag.pointerCancel()
  assert.equal(count('unlock'), 1)
  assert.equal(count('commit'), 0)
  assert.equal(count('swallow'), 0, 'no click follows a cancelled pointer')
  const before = log.length
  drag.pointerUp(ptr(60, 0))
  assert.equal(log.length, before, 'a late release has nothing left to do')
})

test('stray pointer events outside any gesture do nothing', () => {
  const { drag, log } = setup()
  drag.pointerMove(ptr(10, 10))
  drag.pointerUp(ptr(10, 10))
  drag.pointerCancel()
  drag.dispose()
  assert.deepEqual(log, [])
})

test('tearing down mid-drag hands the camera back; tearing down while idle is a no-op', () => {
  const { drag, count } = setup()
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(60, 0))
  drag.dispose()
  assert.equal(count('unlock'), 1)
  assert.equal(drag.isPressed(), false)
  drag.dispose()
  assert.equal(count('unlock'), 1)
})

test('the controller is reusable: a new gesture starts clean after the last one ended', () => {
  const { drag, log, count } = setup()
  drag.pointerDown(ptr(0, 0))
  drag.pointerMove(ptr(60, 0))
  drag.pointerUp(ptr(60, 0))
  log.length = 0
  drag.pointerDown(ptr(200, 200))
  drag.pointerMove(ptr(202, 200))
  assert.equal(count('begin'), 0, 'the previous drag does not leak its "started" state')
  drag.pointerUp(ptr(202, 200))
  assert.equal(count('commit'), 0)
  assert.equal(count('swallow'), 0)
})
