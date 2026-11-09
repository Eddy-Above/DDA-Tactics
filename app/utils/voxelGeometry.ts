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

/** Legacy saved stair faces used reversed east/west rotations; this mapping is its own inverse. */
export function stairDirectionForFace(face: WallFace): WallFace {
  if (face === 'east') return 'west'
  if (face === 'west') return 'east'
  return face
}

/** Three solid treads, centered on a unit cell and ascending in the given direction. */
export function createStairGeometry(direction: WallFace = 'north'): THREE.BufferGeometry {
  const positions: number[] = []
  const triangle = (a: number[], b: number[], c: number[], normal: number[]) => {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    if (ab.cross(ac).dot(new THREE.Vector3(normal[0], normal[1], normal[2])) < 0) positions.push(...a, ...c, ...b)
    else positions.push(...a, ...b, ...c)
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], normal: number[]) => {
    triangle(a, b, c, normal)
    triangle(a, c, d, normal)
  }

  // Bottom, high north end, and low south end. Risers face downhill (+Z).
  quad([-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, -1, 0])
  quad([-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [0, 0, -1])
  quad([-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -1 / 6, 0.5], [-0.5, -1 / 6, 0.5], [0, 0, 1])
  for (let step = 0; step < 3; step++) {
    const front = 0.5 - step / 3, back = 0.5 - (step + 1) / 3
    const top = -0.5 + (step + 1) / 3
    quad([-0.5, top, front], [0.5, top, front], [0.5, top, back], [-0.5, top, back], [0, 1, 0])
    if (step < 2) {
      const nextTop = -0.5 + (step + 2) / 3
      quad([-0.5, top, back], [0.5, top, back], [0.5, nextTop, back], [-0.5, nextTop, back], [0, 0, 1])
    }
  }

  // Triangulate the stepped side profile, avoiding internal faces between treads.
  const profile = [
    new THREE.Vector2(-0.5, 0.5), new THREE.Vector2(-1 / 6, 0.5),
    new THREE.Vector2(-1 / 6, 1 / 6), new THREE.Vector2(1 / 6, 1 / 6),
    new THREE.Vector2(1 / 6, -1 / 6), new THREE.Vector2(0.5, -1 / 6),
    new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, -0.5),
  ]
  const sideTriangles = THREE.ShapeUtils.triangulateShape(profile, [])
  for (const x of [-0.5, 0.5]) for (const indices of sideTriangles) {
    const [a, b, c] = indices.map(index => [x, profile[index]!.x, profile[index]!.y])
    triangle(a!, b!, c!, [Math.sign(x), 0, 0])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.rotateY(rampRotationY(direction))
  return geometry
}
