import type { Vec3 } from '~/types'

// Face order matches Three.js BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
const FACE_OFFSETS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
]

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/** Exposed faces and crease edges of a union of unit voxels. Flat face seams are omitted. */
export function buildVoxelSurface(cells: readonly Vec3[]): {
  exposedFaces: Map<string, number[]>
  outlinePositions: number[]
} {
  const occupied = new Map(cells.map(cell => [cellKey(cell.x, cell.y, cell.z), cell]))
  const exposedFaces = new Map<string, number[]>()
  const outlinePositions: number[] = []
  const visitedEdges = new Set<string>()

  for (const [key, cell] of occupied) {
    const faces: number[] = []
    FACE_OFFSETS.forEach((offset, face) => {
      if (!occupied.has(cellKey(cell.x + offset.x, cell.y + offset.y, cell.z + offset.z))) {
        faces.push(face)
      }
    })
    exposedFaces.set(key, faces)

    // Four cells meet around each grid edge. One or three occupied quadrants make
    // a convex/concave crease; two adjacent quadrants are just a flat face seam.
    // Two diagonal quadrants touch along the edge and still need their boundary.
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3
      const v = (axis + 2) % 3
      for (let du = 0; du <= 1; du++) {
        for (let dv = 0; dv <= 1; dv++) {
          const start = [cell.x, cell.y, cell.z]
          start[u] += du
          start[v] += dv
          const edgeKey = `${axis}:${start.join(',')}`
          if (visitedEdges.has(edgeKey)) continue
          visitedEdges.add(edgeKey)

          let mask = 0
          const quadrants = [[-1, -1], [0, -1], [0, 0], [-1, 0]]
          quadrants.forEach(([qu, qv], quadrant) => {
            const neighbor = [...start]
            neighbor[u] += qu
            neighbor[v] += qv
            if (occupied.has(cellKey(neighbor[0], neighbor[1], neighbor[2]))) mask |= 1 << quadrant
          })
          const count = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
          if (count !== 1 && count !== 3 && mask !== 5 && mask !== 10) continue

          const end = [...start]
          end[axis]++
          outlinePositions.push(...start, ...end)
        }
      }
    }
  }

  return { exposedFaces, outlinePositions }
}
