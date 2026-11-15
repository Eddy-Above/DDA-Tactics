import type { GameMap, Vec3 } from '~/types'
import { canOccupyFootprint, canPassThrough, createMovementMapView, getFootprintCells, isFootprintAirborne,
  type FootprintDims, type MovementCapabilities } from './movementRules'

/** Grow around the existing body rather than moving it to an unrelated free square. */
export function findExpansionAnchor(
  origin: Vec3, previous: FootprintDims, next: FootprintDims, map: GameMap, caps: MovementCapabilities,
  occupied: Set<string> = new Set(),
  destroyed: Set<string> = new Set(),
): Vec3 {
  if (next.width <= previous.width && next.height <= previous.height && next.depth <= previous.depth) return origin
  map = createMovementMapView(map)
  // A body cannot straddle a wall/ceiling. Open doors are passable; growth does
  // not open a closed door. Flight here tests geometry without requiring headroom cells to be grounded.
  const structures = map.walls?.length || map.ceilings?.length
    ? createMovementMapView({ ...map, doors: (map.doors ?? []).filter(door => door.isOpen || destroyed.has(door.id)) }) : null
  const bodyCaps = { ...caps, footprint: undefined, canFly: true, canSwim: true }
  const clear = (pos: Vec3) => {
    if (!canOccupyFootprint(pos, next, caps, map)) return false
    for (const cell of getFootprintCells(pos, next)) {
      if (occupied.has(`${cell.x},${cell.y},${cell.z}`)) return false
      if (!structures) continue
      if (cell.x < pos.x + next.width - 1 && !canPassThrough(cell, { ...cell, x: cell.x + 1 }, bodyCaps, structures, destroyed)) return false
      if (cell.y < pos.y + next.height - 1 && !canPassThrough(cell, { ...cell, y: cell.y + 1 }, bodyCaps, structures, destroyed)) return false
      if (cell.z < pos.z + next.depth - 1 && !canPassThrough(cell, { ...cell, z: cell.z + 1 }, bodyCaps, structures, destroyed)) return false
    }
    return true
  }
  if (clear(origin)) return origin
  const min = { x: origin.x - Math.max(0, next.width - previous.width),
    y: origin.y - Math.max(0, next.height - previous.height), z: origin.z - Math.max(0, next.depth - previous.depth) }
  const max = { x: origin.x + Math.max(0, previous.width - next.width),
    y: origin.y + Math.max(0, previous.height - next.height), z: origin.z + Math.max(0, previous.depth - next.depth) }
  let best: Vec3 | null = null, shortestShift = Infinity
  const searchLevel = (y: number) => {
    for (let x = min.x; x <= max.x; x++) for (let z = min.z; z <= max.z; z++) {
      const shift = Math.abs(x - origin.x) + Math.abs(y - origin.y) + Math.abs(z - origin.z)
      if (shift >= shortestShift) continue
      const candidate = { x, y, z }
      if (!clear(candidate)) continue
      // Growing down in the air may reach a floor, but cannot extend through it.
      let crossesFloor = false
      for (let level = y + 1; level <= origin.y; level++) {
        if (!isFootprintAirborne({ x, y: level, z }, next, map)) { crossesFloor = true; break }
      }
      if (crossesFloor) continue
      best = candidate
      shortestShift = shift
    }
  }
  searchLevel(origin.y)
  if (best) return best
  if (isFootprintAirborne(origin, previous, map)) {
    for (let y = min.y; y <= max.y; y++) if (y !== origin.y) searchLevel(y)
  }
  // If every expansion is obstructed, retain the existing evolution behaviour.
  return best ?? origin
}
