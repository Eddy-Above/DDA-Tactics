import * as THREE from 'three'
import { performance } from 'node:perf_hooks'
import { loadTypeScript, loadTypeScriptWithMocks } from '../tests/helpers/loadTypeScript.mjs'

const edits = loadTypeScript('utils/mapEdits.ts')
const { createMapTerrainChunks } = loadTypeScriptWithMocks('utils/mapTerrainChunks.ts', { '~/utils/mapEdits': edits })
const point = (x, y, z) => ({ x, y, z })
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]

for (const count of [10000, 50000]) {
  const scene = new THREE.Scene()
  const terrain = createMapTerrainChunks({ scene, tileHeight: 0.12 })
  const groundTiles = Array.from({ length: count }, (_, i) => ({ ...point(i % 100, 0, Math.floor(i / 100)), element: 'void', terrain: 'normal' }))
  const map = { id: 'benchmark', groundTiles, spaceTiles: [], voxels: [] }
  const heapBefore = process.memoryUsage().heapUsed
  const started = performance.now()
  terrain.sync(map, { clipY: 20 })
  const buildMs = performance.now() - started
  const initial = terrain.stats()
  const samples = []
  for (let i = 0; i < 100; i++) {
    const ray = new THREE.Raycaster(new THREE.Vector3((i % 90) + 0.5, 10, (i % Math.floor(count / 100)) + 0.5), new THREE.Vector3(0, -1, 0))
    const start = performance.now()
    terrain.pick(ray)
    samples.push(performance.now() - start)
  }
  const changed = groundTiles.map((tile, i) => i === 1010 ? { ...tile, element: 'earth' } : tile)
  const next = edits.recordMapEdit(map, { ...map, groundTiles: changed }, ['groundTiles'], [point(10, 0, 10)])
  const editStarted = performance.now()
  terrain.sync(next)
  const editMs = performance.now() - editStarted
  console.log(JSON.stringify({ cells: count, buildMs: +buildMs.toFixed(2), pickP95Ms: +percentile(samples, 0.95).toFixed(2),
    singleCellUpdateMs: +editMs.toFixed(2), rebuiltChunks: terrain.stats().lastRebuiltChunkKeys.length,
    oldTerrainObjects: count * 2, terrainObjects: initial.objects, terrainDrawBatches: initial.drawCalls,
    retainedHeapMiB: +((process.memoryUsage().heapUsed - heapBefore) / 1048576).toFixed(2),
    note: 'CPU/scene benchmark; GPU frame times and WEBGL_multi_draw fallback require a browser profile.' }))
  terrain.dispose()
}
