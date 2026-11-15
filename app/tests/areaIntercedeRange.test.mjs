import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { findAreaIntercedePosition } = loadTypeScript('server/utils/mapMovement.ts')
const { detectCapabilities } = loadTypeScript('utils/movementRules.ts')
const dims = { width: 1, height: 1, depth: 1 }
const point = x => ({ x, y: 0, z: 0 })
const key = p => `${p.x},${p.y},${p.z}`
const empty = () => new Set()

for (const shape of ['blast', 'burst', 'close-blast', 'cone', 'line', 'pass']) {
  test(`${shape} intercede eligibility targets nearby routes and stops at a valid throw escape`, () => {
    const rules = loadTypeScript('utils/movementRules.ts')
    const { computeAreaCells } = loadTypeScript('utils/areaShapes.ts')
    let jumpEdges = 0, throwEdges = 0
    const spatial = loadTypeScriptWithMocks('server/utils/mapMovement.ts', {
      '../../utils/movementRules': { ...rules,
        createJumpTraversal: (...args) => {
          const traversal = rules.createJumpTraversal(...args)
          return { ...traversal, step: (...edge) => {
            assert.ok(++jumpEdges < 1000, 'a nearby intercept must not expand the complete jump volume')
            return traversal.step(...edge)
          } }
        },
        canPassThrough: (...args) => {
          assert.ok(++throwEdges < 100000, 'throw eligibility must stop once a legal escape is found')
          return rules.canPassThrough(...args)
        },
      },
    })
    const cells = computeAreaCells(shape, 'ranged', point(0), point(1), 2, 0, 8, dims, point(3))
    const area = new Set(cells.map(key))
    const target = cells.filter(p => p.y === 0 && p.z === 0 && p.x >= 1).sort((a, b) => a.x - b.x)[0]
    assert.ok(target)
    const map = { groundTiles: [], walls: [], doors: [], voxels: [], stairs: [], ceilings: [] }
    for (let x = -8; x <= 15; x++) for (let z = -4; z <= 4; z++) map.groundTiles.push({ x, y: 0, z })
    const caps = rules.detectCapabilities([
      { id: 'extra-movement', choiceId: 'jumper' }, { id: 'extra-movement', choiceId: 'swimmer' },
      { id: 'advanced-mobility', choiceId: 'adv-jumper' },
    ], 6, 1, 1)
    const landing = spatial.findAreaIntercedePosition(target, dims, point(-2), 6, caps, dims, map, empty(), area)
    assert.ok(landing)
    assert.ok(area.has(key(landing)))
    assert.notEqual(key(landing), key(target))
    assert.equal(spatial.hasValidThrowOutOfAreaCell(target, 25, dims, map, empty(), area), true)
    assert.ok(jumpEdges > 0)
    assert.ok(throwEdges > 0)
  })
}

test('out-of-range area interceders skip terrain indexing and movement search', () => {
  const map = new Proxy({}, { get() { throw new Error('An unreachable interceder must not search terrain') } })
  const caps = detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 8, 1, 1)
  assert.equal(findAreaIntercedePosition(point(40), dims, point(0), 8, caps, dims, map, empty(), new Set([key(point(39))])), null)
  assert.equal(findAreaIntercedePosition(point(1), dims, point(0), 8, caps, dims, map, empty(), empty()), null)
})

test('area intercede retains valid nearby landing and respects flight speed above walking budget', () => {
  const map = { groundTiles: Array.from({ length: 10 }, (_, x) => point(x)), walls: [], doors: [], voxels: [], stairs: [], ceilings: [] }
  const caps = detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 4, 1, 1)
  caps.flySpeed = 6
  const area = new Set([key(point(5))])
  assert.deepEqual(findAreaIntercedePosition(point(6), dims, point(0), 1, caps, dims, map, empty(), area), point(5))
  const occupied = new Set([key(point(5))])
  assert.equal(findAreaIntercedePosition(point(6), dims, point(0), 1, caps, dims, map, occupied, area), null)
})

test('targeted intercede uses the actual lower jump launch after stepping down', () => {
  const pos = (x, y) => ({ x, y, z: 0 })
  const map = { groundTiles: [pos(0, 2), pos(1, 1), pos(5, 1)], walls: [], doors: [], voxels: [], stairs: [], ceilings: [] }
  const caps = detectCapabilities([{ id: 'extra-movement', choiceId: 'jumper' }], 4, 0, 0)
  assert.deepEqual(findAreaIntercedePosition(pos(5, 1), dims, pos(0, 2), 4, caps, dims, map, empty(), new Set([key(pos(4, 1))])), pos(4, 1))
})
