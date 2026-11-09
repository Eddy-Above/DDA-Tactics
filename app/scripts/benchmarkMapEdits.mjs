import { performance } from 'node:perf_hooks'
import { computed, ref, watch } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks } from '../tests/helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { getMapGeometryRevision } = mapEdits
const { useMapEditor } = loadTypeScriptWithMocks('composables/useMapEditor.ts', { '~/utils/mapEdits': mapEdits })
for (const size of [10000, 50000]) {
  const map = ref({ id: `benchmark-${size}`, groundTiles: [], spaceTiles: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [],
    voxels: Array.from({ length: size }, (_, x) => ({ x, y: 0, z: 1, materialId: 'void' })) })
  const editor = useMapEditor(map)
  const revision = computed(() => getMapGeometryRevision(map.value))
  let invalidations = 0
  const stop = watch(revision, () => { invalidations++ }, { flush: 'sync' })
  editor.drawMode.value = 'line'
  const duration = action => { const start = performance.now(); action(); return +(performance.now() - start).toFixed(2) }
  const drawMs = duration(() => editor.applyVoxelDraw({ x: 0, y: 0, z: 0 }, { x: 999, y: 0, z: 0 }, 'ramp'))
  const paintMs = duration(() => { editor.elementBrush.value = 'water'; editor.applyPaintElement({ x: 0, y: 0, z: 0 }, { x: 999, y: 0, z: 0 }) })
  const deleteMs = duration(() => editor.deleteAt({ x: 0, y: 0, z: 0 }, { x: 999, y: 0, z: 0 }))
  const undoMs = duration(() => editor.undo())
  stop()
  console.log(JSON.stringify({ existingVoxels: size, cellsPerStroke: 1000, drawMs, paintMs, deleteMs, undoMs, invalidations }))
}
