import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { fitRadialArc, radialPoint, radialSectorPath, wrapRadialLabel } = loadTypeScript('utils/radialMenu.ts')

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
