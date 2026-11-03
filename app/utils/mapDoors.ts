import type { GameMap, MapDoor, MapWall, Vec3 } from '~/types'
import type { FootprintDims } from '~/utils/movementRules'
import { getFootprintCells } from '~/utils/movementRules'

// Wall faces are keyed by the cell-boundary plane they sit on, so a wall stored on either of the
// two tiles it separates gets the same key: 'X' planes are x = const (west/east walls), 'Z' planes
// are z = const (north/south walls); the other two coordinates locate the cell row on that floor.
const xFace = (x: number, y: number, z: number) => `X:${x},${y},${z}`
const zFace = (x: number, y: number, z: number) => `Z:${x},${y},${z}`

export function wallFaceKey(wall: Pick<MapWall, 'x' | 'y' | 'z' | 'face'>): string {
  switch (wall.face) {
    case 'west':  return xFace(wall.x, wall.y, wall.z)
    case 'east':  return xFace(wall.x + 1, wall.y, wall.z)
    case 'north': return zFace(wall.x, wall.y, wall.z)
    case 'south': return zFace(wall.x, wall.y, wall.z + 1)
  }
}

// Doors keyed by their wall's face; a door on a destroyed wall is gone with it.
function doorsByFace(map: GameMap, destroyed: Set<string>): Map<string, MapDoor> {
  const wallById = new Map((map.walls ?? []).map(w => [w.id, w]))
  const byFace = new Map<string, MapDoor>()
  for (const door of map.doors ?? []) {
    const wall = wallById.get(door.wallId)
    if (!wall || destroyed.has(wall.id)) continue
    byFace.set(wallFaceKey(wall), door)
  }
  return byFace
}

/**
 * Doors a unit stands beside: the door's wall face is a side of one of its footprint cells, on
 * that cell's floor — i.e. the unit is in one of the two cells the door separates.
 */
export function doorsAdjacentTo(map: GameMap, anchor: Vec3, dims: FootprintDims, destroyed: Set<string> = new Set()): MapDoor[] {
  const byFace = doorsByFace(map, destroyed)
  if (byFace.size === 0) return []
  const found = new Map<string, MapDoor>()
  for (const c of getFootprintCells(anchor, dims)) {
    for (const key of [xFace(c.x, c.y, c.z), xFace(c.x + 1, c.y, c.z), zFace(c.x, c.y, c.z), zFace(c.x, c.y, c.z + 1)]) {
      const door = byFace.get(key)
      if (door) found.set(door.id, door)
    }
  }
  return [...found.values()]
}

// Faces one path step crosses, on the from-cell's floor (walls are per-floor, matching
// canPassThrough). A diagonal step can squeeze through either L-route, so it counts both.
function stepFaceKeys(a: Vec3, b: Vec3): string[] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return []
  const fx = Math.max(a.x, b.x)
  const fz = Math.max(a.z, b.z)
  if (dx !== 0 && dz !== 0) return [xFace(fx, a.y, a.z), zFace(b.x, a.y, fz), zFace(a.x, a.y, fz), xFace(fx, a.y, b.z)]
  if (dx !== 0) return [xFace(fx, a.y, a.z)]
  if (dz !== 0) return [zFace(a.x, a.y, fz)]
  return []
}

/**
 * Closed doors a unit with this footprint moves through along `path` (consecutive anchor cells,
 * start first). Moving through a closed door opens it.
 */
export function closedDoorsCrossedByPath(map: GameMap, path: Vec3[], dims: FootprintDims, destroyed: Set<string> = new Set()): string[] {
  const byFace = doorsByFace(map, destroyed)
  if (byFace.size === 0) return []
  const offsets = getFootprintCells({ x: 0, y: 0, z: 0 }, dims)
  const ids = new Set<string>()
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    for (const o of offsets) {
      const from = { x: a.x + o.x, y: a.y + o.y, z: a.z + o.z }
      const to = { x: b.x + o.x, y: b.y + o.y, z: b.z + o.z }
      for (const key of stepFaceKeys(from, to)) {
        const door = byFace.get(key)
        if (door && !door.isOpen) ids.add(door.id)
      }
    }
  }
  return [...ids]
}
