import type { Vec3, GameMap } from '~/types'

export function vec3Key(v: Vec3) { return `${v.x},${v.y},${v.z}` }
export function parseVec3Key(k: string): Vec3 { const [x, y, z] = k.split(',').map(Number); return { x, y, z } }

// Project a 3D world position to 2D screen coordinates using a camera matrix
// Returns { x, y } in normalized device coordinates (−1..1), or pixel coords if canvas size provided
export function worldToScreen(
  worldPos: Vec3,
  camera: { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } },
  width: number,
  height: number,
): { x: number; y: number } {
  // This is a simplified version; the actual implementation will use THREE.Vector3.project()
  // This function is a placeholder for the pattern used in MapCanvas.vue
  return { x: 0, y: 0 }
}

// Get neighbours of a ground tile (same y level, orthogonal only)
export function groundNeighbours(pos: Vec3): Vec3[] {
  return [
    { x: pos.x + 1, y: pos.y, z: pos.z },
    { x: pos.x - 1, y: pos.y, z: pos.z },
    { x: pos.x, y: pos.y, z: pos.z + 1 },
    { x: pos.x, y: pos.y, z: pos.z - 1 },
  ]
}

// Check if a 3D ray from a to b intersects a wall face
// Returns t (0..1) of intersection or null
function rayBoxIntersect(
  origin: Vec3, dir: Vec3,
  boxMin: Vec3, boxMax: Vec3,
): number | null {
  let tMin = -Infinity, tMax = Infinity
  const axes = ['x', 'y', 'z'] as const
  for (const axis of axes) {
    const d = dir[axis]
    if (Math.abs(d) < 1e-8) {
      if (origin[axis] < boxMin[axis] || origin[axis] > boxMax[axis]) return null
    } else {
      const t1 = (boxMin[axis] - origin[axis]) / d
      const t2 = (boxMax[axis] - origin[axis]) / d
      tMin = Math.max(tMin, Math.min(t1, t2))
      tMax = Math.min(tMax, Math.max(t1, t2))
    }
  }
  if (tMax < tMin || tMax < 0) return null
  return tMin >= 0 ? tMin : tMax
}

// Line-of-sight check between two Vec3 positions through the map
// Returns true if the ray is unobstructed
export function hasLineOfSight(
  from: Vec3, to: Vec3, map: GameMap, destroyedStructures: Set<string> = new Set(),
): boolean {
  const dir: Vec3 = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const dist = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2)
  if (dist < 0.001) return true
  dir.x /= dist; dir.y /= dist; dir.z /= dist

  for (const wall of map.walls) {
    if (destroyedStructures.has(wall.id)) continue
    // Check window/door that override the wall (open door or window = allows LoS)
    const hasOpenDoor = map.doors.some(d => d.wallId === wall.id && d.isOpen)
    if (hasOpenDoor) continue
    // Build wall AABB
    const THICKNESS = 0.1
    let boxMin: Vec3, boxMax: Vec3
    if (wall.face === 'north' || wall.face === 'south') {
      const zOffset = wall.face === 'north' ? 0 : 1
      boxMin = { x: wall.x, y: wall.y, z: wall.z + zOffset - THICKNESS }
      boxMax = { x: wall.x + 1, y: wall.y + 2, z: wall.z + zOffset + THICKNESS }
    } else {
      const xOffset = wall.face === 'west' ? 0 : 1
      boxMin = { x: wall.x + xOffset - THICKNESS, y: wall.y, z: wall.z }
      boxMax = { x: wall.x + xOffset + THICKNESS, y: wall.y + 2, z: wall.z + 1 }
    }
    const t = rayBoxIntersect(
      { x: from.x + 0.5, y: from.y + 1, z: from.z + 0.5 },
      dir, boxMin, boxMax,
    )
    if (t !== null && t < dist) return false
  }

  // Check ceilings
  for (const ceiling of map.ceilings) {
    if (destroyedStructures.has(ceiling.id)) continue
    const boxMin = { x: ceiling.x, y: ceiling.y + 1 - 0.1, z: ceiling.z }
    const boxMax = { x: ceiling.x + 1, y: ceiling.y + 1 + 0.1, z: ceiling.z + 1 }
    const t = rayBoxIntersect({ x: from.x + 0.5, y: from.y + 1, z: from.z + 0.5 }, dir, boxMin, boxMax)
    if (t !== null && t < dist) return false
  }

  return true
}
