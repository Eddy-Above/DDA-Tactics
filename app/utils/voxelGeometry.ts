import * as THREE from 'three'
import type { MapVoxel, WallFace } from '~/types'

/** Rotation from a north-ascending ramp to the requested uphill direction. */
export function rampRotationY(direction: WallFace = 'north'): number {
  switch (direction) {
    case 'east': return -Math.PI / 2
    case 'south': return Math.PI
    case 'west': return Math.PI / 2
    default: return 0
  }
}

/** A unit cube or closed ramp, centered on the origin with a one-cell footprint. */
export function createVoxelGeometry(voxel: Pick<MapVoxel, 'shape' | 'rampDirection'>): THREE.BufferGeometry {
  if (voxel.shape !== 'ramp') return new THREE.BoxGeometry(1, 1, 1)

  // North is -Z. The ramp rises from y=-0.5 at its south edge to y=0.5
  // at its north edge. Separate triangle vertices keep every face's normal flat.
  const a = [-0.5, -0.5, -0.5], b = [0.5, -0.5, -0.5]
  const c = [0.5, -0.5, 0.5], d = [-0.5, -0.5, 0.5]
  const e = [-0.5, 0.5, -0.5], f = [0.5, 0.5, -0.5]
  const triangles = [
    a, b, c, a, c, d, // bottom
    a, e, f, a, f, b, // north, full-height end
    a, d, e, // west triangular side
    b, f, c, // east triangular side
    e, d, c, e, c, f, // slope
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(), 3))
  geometry.computeVertexNormals()
  geometry.rotateY(rampRotationY(voxel.rampDirection))
  return geometry
}
