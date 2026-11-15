import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { computePassBeam, normalize3 } = loadTypeScript('utils/areaShapes.ts')

// Exhaustive geometry oracle: the original cube scan, independent of slice bounds.
function exhaustiveBeam(anchor, dir, length, dims) {
  const nd = normalize3(dir)
  const cx = (dims.width - 1) / 2, cy = (dims.height - 1) / 2, cz = (dims.depth - 1) / 2
  const horizontal = Math.sqrt(dir.x * dir.x + dir.z * dir.z)
  const origin = { x: anchor.x + cx + (horizontal > 1e-6 ? dir.x / horizontal * cx : 0),
    y: anchor.y + cy, z: anchor.z + cz + (horizontal > 1e-6 ? dir.z / horizontal * cz : 0) }
  const halfN = Math.floor((dims.width - 1) / 2), halfP = dims.width - 1 - halfN
  const halfUpN = Math.floor((dims.height - 1) / 2), halfUpP = dims.height - 1 - halfUpN
  const pLen = Math.sqrt(nd.x * nd.x + nd.z * nd.z)
  const pdx = pLen > 1e-6 ? nd.z / pLen : 0, pdz = pLen > 1e-6 ? -nd.x / pLen : 0
  const vdx = nd.y * pdz, vdy = nd.z * pdx - nd.x * pdz, vdz = -nd.y * pdx
  const r = Math.ceil(length + Math.max(halfP, halfUpP) + 1), cells = []
  for (let x = Math.round(origin.x) - r; x <= Math.round(origin.x) + r; x++)
    for (let y = Math.round(origin.y) - r; y <= Math.round(origin.y) + r; y++)
      for (let z = Math.round(origin.z) - r; z <= Math.round(origin.z) + r; z++) {
        const px = x - origin.x, py = y - origin.y, pz = z - origin.z
        const along = px * nd.x + py * nd.y + pz * nd.z
        if (along < 0 || along > length + 0.5) continue
        const signedPerp = (px - along * nd.x) * pdx + (pz - along * nd.z) * pdz
        if (signedPerp < -halfN - 0.5 || signedPerp > halfP + 0.5) continue
        const signedUp = px * vdx + py * vdy + pz * vdz
        if (signedUp < -halfUpN - 0.5 || signedUp > halfUpP + 0.5) continue
        cells.push({ x, y, z })
      }
  return cells
}

test('sliced Pass beams preserve exhaustive coverage and order across directions and body sizes', () => {
  const directions = [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 },
    { x: 1, y: 1, z: 1 }, { x: -3, y: 2, z: 1 }, { x: 1, y: -4, z: -2 },
    { x: 0, y: 1, z: 0 }, { x: 1e-8, y: -1, z: 0 }, { x: 1e-5, y: 1, z: 0 },
  ]
  for (let i = 1; i <= 20; i++) directions.push({ x: Math.sin(i) * 4, y: Math.cos(i * 2), z: Math.cos(i) * 3 })
  for (const dir of directions) for (const dims of [
    { width: 1, height: 1, depth: 1 }, { width: 2, height: 3, depth: 2 }, { width: 4, height: 2, depth: 5 },
  ]) for (const length of [0, 3.5, 12]) {
    const anchor = { x: -3, y: 2, z: 5 }
    assert.deepEqual(computePassBeam(anchor, dir, length, dims), exhaustiveBeam(anchor, dir, length, dims),
      JSON.stringify({ dir, dims, length }))
  }
})

test('long Pass beam matches exhaustive geometry with less generation work', t => {
  const anchor = { x: 0, y: 0, z: 0 }, dir = { x: 3, y: 2, z: 1 }
  const dims = { width: 3, height: 4, depth: 3 }
  const start = performance.now()
  const expected = exhaustiveBeam(anchor, dir, 100, dims)
  const exhaustiveMs = performance.now() - start
  const slicedStart = performance.now()
  const actual = computePassBeam(anchor, dir, 100, dims)
  const slicedMs = performance.now() - slicedStart
  assert.deepEqual(actual, expected)
  t.diagnostic(`100m beam: exhaustive ${exhaustiveMs.toFixed(1)}ms; sliced ${slicedMs.toFixed(1)}ms; ${actual.length} cells`)
})
