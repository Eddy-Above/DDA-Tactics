import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { fitRadialArc, radialDetailRows, radialPoint, radialSectorPath, wrapRadialLabel, wrapRadialTags } = loadTypeScript('utils/radialMenu.ts')

test('action fans fit inside every viewport edge and corner without moving their token anchor', () => {
  const bounds = { width: 1000, height: 700 }
  const radius = 200
  const centers = [
    { x: 500, y: 350 }, { x: 35, y: 350 }, { x: 965, y: 350 },
    { x: 500, y: 35 }, { x: 500, y: 665 },
    { x: 35, y: 35 }, { x: 965, y: 35 }, { x: 35, y: 665 }, { x: 965, y: 665 },
  ]
  for (const center of centers) {
    const original = { ...center }
    const arc = fitRadialArc(center, bounds, radius)
    assert.ok(arc.sweep >= 80, `fan remains usable at ${JSON.stringify(center)}`)
    for (let angle = arc.start; angle <= arc.start + arc.sweep; angle += 0.5) {
      const p = radialPoint(radius, angle)
      assert.ok(center.x + p.x >= 9.999 && center.x + p.x <= bounds.width - 9.999)
      assert.ok(center.y + p.y >= 9.999 && center.y + p.y <= bounds.height - 9.999)
    }
    assert.deepEqual(center, original)
  }
})

test('fan fitting handles a narrow mobile viewport and keeps its angles finite', () => {
  for (const center of [{ x: 160, y: 200 }, { x: 20, y: 35 }, { x: 300, y: 440 }]) {
    const arc = fitRadialArc(center, { width: 320, height: 480 }, 200)
    assert.ok(Number.isFinite(arc.start))
    assert.ok(arc.sweep >= 36 && arc.sweep <= 300)
    for (let angle = arc.start; angle <= arc.start + arc.sweep; angle++) {
      const p = radialPoint(200, angle)
      assert.ok(center.x + p.x >= 9.999 && center.x + p.x <= 310.001)
      assert.ok(center.y + p.y >= 9.999 && center.y + p.y <= 470.001)
    }
  }
})

test('annular sectors have closed curved boundaries and work across the angle seam', () => {
  const path = radialSectorPath(45, 115, 350, 410)
  assert.ok(path.startsWith('M '))
  assert.ok(path.endsWith(' Z'))
  assert.equal((path.match(/ A /g) || []).length, 2)
  assert.ok(!path.includes('NaN'))
  assert.match(radialSectorPath(45, 115, -200, 50), /A 115 115 0 1 1/)
})

test('attack names wrap by words, with bounded visible lines and safe long-word handling', () => {
  assert.deepEqual(wrapRadialLabel('Pepper Breath', 15), ['Pepper Breath'])
  assert.deepEqual(wrapRadialLabel('Supreme Transcendent Dragon Fire Attack', 13, 3), ['Supreme', 'Transcendent', 'Dragon Fire…'])
  const long = wrapRadialLabel('Supercalifragilisticexpialidocious', 13, 3)
  assert.ok(long.length <= 3)
  assert.ok(long.every(line => line.length <= 13))
})

test('tags pack whole tags per line and end in an ellipsis when some are dropped', () => {
  assert.deepEqual(wrapRadialTags(['Weapon II', 'Charge Attack'], 17, 2), ['Weapon II', 'Charge Attack'])
  assert.deepEqual(wrapRadialTags(['AP I', 'Weapon I'], 17, 2), ['AP I · Weapon I'])
  const many = wrapRadialTags(['Weapon II', 'Charge Attack', 'Certain Strike I', 'Armor Piercing III'], 17, 2)
  assert.equal(many.length, 2)
  assert.ok(many.every(line => line.length <= 17))
  assert.ok(many[1].endsWith('…'))
  assert.deepEqual(wrapRadialTags([], 17, 2), [])
  assert.equal(wrapRadialTags(['Supercalifragilistic Tag'], 17, 2)[0].length, 17)
})

test('plain choices keep the label-only layout and attack choices stack range, AoE, effect and tags', () => {
  assert.equal(radialDetailRows({ label: 'Neutral', active: true }), null)
  assert.equal(radialDetailRows({ label: 'Plain', tags: [] }), null)

  const rows = radialDetailRows({
    label: 'Pepper Breath', range: 'Ranged', aoe: 'Burst', effect: 'Paralysis', tags: ['Weapon II', 'Charge Attack'],
  })
  assert.deepEqual(rows.map(row => [row.kind, row.text]), [
    ['label', 'Pepper Breath'], ['meta', 'Ranged · Burst'], ['effect', 'Paralysis'], ['tags', 'Weapon II…'],
  ])
  assert.ok(rows.every((row, index) => Number.isFinite(row.y) && (index === 0 || row.y > rows[index - 1].y)))
  // Centred block that fits the 80px ring.
  assert.ok(rows[0].y > -40 && rows.at(-1).y < 40)
})

test('a wide range and AoE pair splits across rows rather than clipping the AoE type', () => {
  const rows = radialDetailRows({ label: 'Blaze Wave', range: 'Ranged', aoe: 'Close Blast', effect: 'Poison 3', tags: ['Weapon I', 'AP I', 'Signature Move'] })
  assert.deepEqual(rows.filter(row => row.kind === 'meta').map(row => row.text), ['Ranged', 'Close Blast'])
  const tall = radialDetailRows({ label: 'Supreme Transcendent Dragon Fire Attack', range: 'Ranged', aoe: 'Close Blast', effect: 'Paralysis', tags: ['A', 'B', 'C', 'D', 'E', 'F'] })
  assert.ok(tall.filter(row => row.kind === 'label').length <= 2)
  assert.ok(tall.at(-1).y - tall[0].y < 70, 'tallest stack stays inside the 80px ring')
  assert.deepEqual(radialDetailRows({ label: 'Claw', range: 'Melee' }).map(row => row.text), ['Claw', 'Melee'])
})

// Deterministic font boxes include descenders and line height, rather than assuming
// that the label baseline is the edge of its painted text.
const textSizes = {
  current: { advance: 3.8, ascent: 7, descent: 2 },
  label: { advance: 5.33, ascent: 10, descent: 3 },
  meta: { advance: 4.4, ascent: 8, descent: 3 },
  effect: { advance: 4.8, ascent: 9, descent: 3 },
  tags: { advance: 4.1, ascent: 8, descent: 2 },
}
const measureText = (text, kind) => ({ ...textSizes[kind], width: text.length * textSizes[kind].advance })

function assertRowsInsideSector(rows, geometry) {
  assert.ok(rows.some(row => row.kind === 'label' && row.text), 'an attack always retains a visible name')
  const center = radialPoint((geometry.inner + geometry.outer) / 2, (geometry.start + geometry.end) / 2)
  const start = radialPoint(1, geometry.start)
  const end = radialPoint(1, geometry.end)
  for (const row of rows) {
    assert.ok(Number.isFinite(row.x) && Number.isFinite(row.y))
    const metrics = measureText(row.text, row.kind)
    const left = center.x + row.x - metrics.width / 2
    const right = center.x + row.x + metrics.width / 2
    const top = center.y + row.y - metrics.ascent
    const bottom = center.y + row.y + metrics.descent
    const context = JSON.stringify({ row, geometry })
    for (const x of [left, right]) for (const y of [top, bottom]) {
      assert.ok(Math.hypot(x, y) <= geometry.outer - 3 + 1e-7, `outer arc: ${context}`)
      assert.ok(start.x * y - start.y * x >= 3 - 1e-7, `start edge: ${context}`)
      assert.ok(x * end.y - y * end.x >= 3 - 1e-7, `end edge: ${context}`)
    }
    const nearestX = Math.max(left, Math.min(right, 0))
    const nearestY = Math.max(top, Math.min(bottom, 0))
    assert.ok(Math.hypot(nearestX, nearestY) >= geometry.inner + 3 - 1e-7, `inner arc: ${context}`)
  }
}

test('the diagonal Electro Shocker detail block stays within its painted attack sector', () => {
  const item = { label: 'Electro Shocker', range: 'Ranged', effect: 'Stun', tags: ['Weapon II'] }
  const geometry = { inner: 118, outer: 198, start: -163.9, end: -128.6 }
  const originalRows = radialDetailRows(item)
  const center = radialPoint(158, -146.25)
  const label = originalRows.find(row => row.kind === 'label')
  const metrics = measureText(label.text, label.kind)
  assert.ok(Math.hypot(center.x - metrics.width / 2, center.y + label.y - metrics.ascent) > 198,
    'the former y-only layout really paints outside the outer circle')
  const fitted = radialDetailRows(item, geometry, measureText)
  assertRowsInsideSector(fitted, geometry)
  assert.ok(fitted.some(row => row.x !== 0 || row.text.endsWith('…')), 'fit changes actual placement or text')
})

test('measured detail boxes fit all sector orientations, including narrow edge fans', () => {
  const items = [
    { label: 'Electro Shocker', range: 'Ranged', effect: 'Stun', tags: ['Weapon II'] },
    { label: 'Supreme Transcendent Dragon Fire Attack', range: 'Ranged', aoe: 'Close Blast', effect: 'Paralysis', tags: ['Armor Piercing III', 'Charge Attack', 'Certain Strike I'] },
    { label: 'Hand of Fate', range: 'Ranged', tags: ['Weapon II', 'Armor Piercing II', 'Signature Move'] },
  ]
  for (let angle = -360; angle <= 360; angle += 15) {
    for (const width of [21.8, 35.3, 57.8]) {
      const geometry = { inner: 118, outer: 198, start: angle - width / 2, end: angle + width / 2 }
      for (const item of items) assertRowsInsideSector(radialDetailRows(item, geometry, measureText), geometry)
    }
  }
})

test('a narrow fan drops optional rows before losing the attack name, without shrinking text', () => {
  const item = {
    label: 'Supreme Transcendent Dragon Fire Attack', range: 'Ranged', aoe: 'Close Blast',
    effect: 'Paralysis', tags: ['Armor Piercing III', 'Charge Attack', 'Certain Strike I'],
  }
  const geometry = { inner: 118, outer: 198, start: -10.9, end: 10.9 }
  const rows = radialDetailRows(item, geometry, measureText)
  assert.ok(rows.length < radialDetailRows(item).length)
  assertRowsInsideSector(rows, geometry)
  assert.ok(rows.some(row => row.kind === 'label' && row.text !== '…'), 'the choice remains identifiable')
  assert.ok(!rows.some(row => row.kind === 'tags'), 'tags yield space before the name or core metadata')
})
