import type { Vec3, GameMap } from '../../types'
import { getMapVoxels, voxelBlocksSight } from '../../utils/mapVoxels'

// Chebyshev distance — "king's move" in 3D grid
export function chebyshev(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

// Ray-march LoS check: returns true if the path from `from` to `to` is unobstructed
export function hasLineOfSight(from: Vec3, to: Vec3, map: GameMap): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dist < 0.001) return true

  // Check wall intersections using AABB ray test
  const ox = from.x + 0.5, oy = from.y + 1, oz = from.z + 0.5
  const ndx = dx / dist, ndy = dy / dist, ndz = dz / dist

  for (const wall of map.walls) {
    const hasOpenDoor = map.doors.some(d => d.wallId === wall.id && d.isOpen)
    if (hasOpenDoor) continue
    const THICK = 0.1
    let bMinX: number, bMaxX: number, bMinY: number, bMaxY: number, bMinZ: number, bMaxZ: number
    if (wall.face === 'north' || wall.face === 'south') {
      const zOff = wall.face === 'south' ? 1 : 0
      bMinX = wall.x; bMaxX = wall.x + 1
      bMinY = wall.y; bMaxY = wall.y + 2.2
      bMinZ = wall.z + zOff - THICK; bMaxZ = wall.z + zOff + THICK
    } else {
      const xOff = wall.face === 'east' ? 1 : 0
      bMinX = wall.x + xOff - THICK; bMaxX = wall.x + xOff + THICK
      bMinY = wall.y; bMaxY = wall.y + 2.2
      bMinZ = wall.z; bMaxZ = wall.z + 1
    }
    const t = rayAABB(ox, oy, oz, ndx, ndy, ndz, bMinX, bMaxX, bMinY, bMaxY, bMinZ, bMaxZ)
    if (t !== null && t < dist) return false
  }

  for (const ceiling of map.ceilings) {
    const t = rayAABB(ox, oy, oz, ndx, ndy, ndz, ceiling.x, ceiling.x + 1, ceiling.y + 0.9, ceiling.y + 1.1, ceiling.z, ceiling.z + 1)
    if (t !== null && t < dist) return false
  }

  for (const voxel of getMapVoxels(map)) {
    if (!voxelBlocksSight(voxel)) continue
    const t = rayAABB(ox, oy, oz, ndx, ndy, ndz, voxel.x, voxel.x + 1, voxel.y, voxel.y + 1, voxel.z, voxel.z + 1)
    if (t !== null && t > 0.01 && t < dist) return false
  }

  return true
}

function rayAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
): number | null {
  let tMin = -Infinity, tMax = Infinity

  const check = (o: number, d: number, min: number, max: number) => {
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return false
    } else {
      const t1 = (min - o) / d, t2 = (max - o) / d
      tMin = Math.max(tMin, Math.min(t1, t2))
      tMax = Math.min(tMax, Math.max(t1, t2))
      if (tMax < tMin) return false
    }
    return true
  }

  if (!check(ox, dx, minX, maxX)) return null
  if (!check(oy, dy, minY, maxY)) return null
  if (!check(oz, dz, minZ, maxZ)) return null
  if (tMax < 0) return null
  return tMin >= 0 ? tMin : tMax
}
