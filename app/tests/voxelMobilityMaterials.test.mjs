import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { ELEMENT_COLORS } = loadTypeScript('types/index.ts')
const { MAP_VOXEL_MATERIALS, getVoxelMaterialElement, getVoxelMaterialId,
  getVoxelMaterialDefinition, voxelBlocksMovement, voxelBlocksSight } = loadTypeScript('utils/mapVoxels.ts')

test('diggable material choices retain distinct saved materials and valid elemental affinities', () => {
  for (const [materialId, affinity] of [['sand', 'earth'], ['snow', 'ice'], ['soft-metal', 'steel']]) {
    assert.ok(MAP_VOXEL_MATERIALS.some(material => material.id === materialId))
    const voxel = JSON.parse(JSON.stringify({ x: 1, y: 2, z: 3, materialId, element: getVoxelMaterialElement(materialId) }))
    assert.equal(getVoxelMaterialId(voxel), materialId)
    assert.equal(voxel.element, affinity)
    assert.equal(getVoxelMaterialDefinition(voxel).id, materialId)
    assert.equal(voxelBlocksMovement(voxel), true)
    assert.equal(voxelBlocksSight(voxel), true)
  }
})

test('existing elemental materials preserve their affinity and unknown materials use neutral affinity', () => {
  for (const element of Object.keys(ELEMENT_COLORS)) assert.equal(getVoxelMaterialElement(element), element)
  assert.equal(getVoxelMaterialElement('glass'), 'void')
  assert.equal(getVoxelMaterialElement('future-material'), 'void')
})
