import type { Vec3, GameMap } from '../../types'
import type { FootprintDims, MovementCapabilities } from '../../utils/movementRules'
import {
  getFootprintDimensions,
  getFootprintCells,
  isWithinMapFootprint,
  canPassThrough,
  hasSolidVoxelSupport,
  hasSolidStairSupport,
  isPositionInAir,
  computeFallDamage,
  isFootprintAirborne,
  settleFootprintY,
  detectCapabilities,
  PROJECTILE_CAPS,
} from '../../utils/movementRules'

// This module is the server's spatial/pathfinding layer. All pure map geometry (canPassThrough,
// capabilities, fall/airborne helpers) now lives in `app/utils/movementRules.ts` — the single source
// of truth shared with the client. We re-export the pieces below so existing `from './mapMovement'`
// server imports keep working unchanged.
export type { FootprintDims, MovementCapabilities }
export {
  getFootprintDimensions,
  getFootprintCells,
  isPositionInAir,
  computeFallDamage,
  isFootprintAirborne,
  settleFootprintY,
}
export { detectCapabilities as detectCapabilitiesFromQualities }

function key(v: Vec3) { return `${v.x},${v.y},${v.z}` }

function neighbours(v: Vec3): Vec3[] {
  const result: Vec3[] = []
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        result.push({ x: v.x + dx, y: v.y + dy, z: v.z + dz })
      }
  return result
}

export function getReachableCells(
  origin: Vec3,
  budget: number,
  caps: MovementCapabilities,
  map: GameMap,
  destroyed: Set<string> = new Set(),
): Set<string> {
  const visited = new Map<string, number>([[key(origin), 0]])
  const queue: Array<{ pos: Vec3; cost: number }> = [{ pos: origin, cost: 0 }]
  while (queue.length > 0) {
    const { pos, cost } = queue.shift()!
    if (cost >= budget) continue
    for (const nb of neighbours(pos)) {
      const k = key(nb)
      if (visited.has(k)) continue
      if (!canPassThrough(pos, nb, caps, map, destroyed)) continue
      visited.set(k, cost + 1)
      queue.push({ pos: nb, cost: cost + 1 })
    }
  }
  return new Set(visited.keys())
}

export function isValidLandingPosition(
  pos: Vec3,
  map: GameMap,
  occupiedSet: Set<string>,
  caps?: MovementCapabilities,
): boolean {
  if (occupiedSet.has(key(pos))) return false
  if ((map.groundTiles ?? []).some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if ((map.spaceTiles ?? []).some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if (hasSolidVoxelSupport(map, pos)) return true
  if (hasSolidStairSupport(map, pos)) return true
  if (caps?.canFly && isWithinMapFootprint(map, pos)) return true
  return false
}

export function isFootprintValid(
  center: Vec3,
  dims: FootprintDims,
  map: GameMap,
  occupiedSet: Set<string>,
  caps?: MovementCapabilities,
): boolean {
  if (!isValidLandingPosition(center, map, occupiedSet, caps)) return false
  return getFootprintCells(center, dims).every(cell => !occupiedSet.has(key(cell)))
}

// BFS from fromPos (skipping fromPos itself) respecting walls; returns the closest cell
// where the target's footprint fits on valid, unoccupied tiles.
export function findClosestValidDisplacementPosition(
  fromPos: Vec3,
  map: GameMap,
  caps: MovementCapabilities,
  occupiedSet: Set<string>,
  targetDims: FootprintDims = { width: 1, height: 1, depth: 1 },
  maxRadius: number = 6,
  destroyed: Set<string> = new Set(),
): Vec3 | null {
  const visited = new Map<string, number>([[key(fromPos), 0]])
  const queue: Array<{ pos: Vec3; cost: number }> = [{ pos: fromPos, cost: 0 }]
  while (queue.length > 0) {
    const { pos, cost } = queue.shift()!
    if (cost > 0 && isFootprintValid(pos, targetDims, map, occupiedSet, caps)) return pos
    if (cost >= maxRadius) continue
    for (const nb of neighbours(pos)) {
      const k = key(nb)
      if (visited.has(k)) continue
      if (!canPassThrough(pos, nb, caps, map, destroyed)) continue
      visited.set(k, cost + 1)
      queue.push({ pos: nb, cost: cost + 1 })
    }
  }
  return null
}

// Returns intermediate cells (excluding endpoints) along the straight line from `from` to `to`.
export function getCellsOnLine(from: Vec3, to: Vec3): Vec3[] {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
  if (steps <= 1) return []
  const cells: Vec3[] = []
  const seen = new Set<string>()
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const cell: Vec3 = {
      x: Math.round(from.x + dx * t),
      y: Math.round(from.y + dy * t),
      z: Math.round(from.z + dz * t),
    }
    const k = key(cell)
    if (!seen.has(k)) { seen.add(k); cells.push(cell) }
  }
  return cells
}

// For ranged intercede: finds the cell on the line from attackerPos → targetPos that is
// closest to the target, reachable by the interceptor within budget, and fits their footprint.
export function findRangedIntercedPosition(
  attackerPos: Vec3,
  targetPos: Vec3,
  interceptorPos: Vec3,
  budget: number,
  caps: MovementCapabilities,
  interceptorDims: FootprintDims,
  map: GameMap,
  occupiedSet: Set<string>,
  destroyed: Set<string> = new Set(),
): Vec3 | null {
  const lineCells = getCellsOnLine(attackerPos, targetPos)
  if (lineCells.length === 0) return null
  const sorted = [...lineCells].reverse() // closest to target first
  const reachable = getReachableCells(interceptorPos, budget, caps, map, destroyed)
  for (const cell of sorted) {
    if (reachable.has(key(cell)) && isFootprintValid(cell, interceptorDims, map, occupiedSet, caps)) return cell
  }
  return null
}

// Validates a player-aimed throw landing cell server-side: must be within maxDistance of
// originPos (the thrown unit's current position), have a valid footprint, and (optionally)
// not overlap excludeCells (e.g. an Area Attack's cells, for Intercede "Throw Ally Out of AoE").
export function findThrowLandingCell(
  originPos: Vec3,
  landingPos: Vec3,
  maxDistance: number,
  targetDims: FootprintDims,
  map: GameMap,
  occupiedSet: Set<string>,
  excludeCells?: Set<string>,
  destroyed: Set<string> = new Set(),
): Vec3 | null {
  const reachable = getReachableCells(originPos, maxDistance, PROJECTILE_CAPS, map, destroyed)
  if (!reachable.has(key(landingPos))) return null
  if (!isFootprintValid(landingPos, targetDims, map, occupiedSet, PROJECTILE_CAPS)) return null
  if (excludeCells) {
    const cells = getFootprintCells(landingPos, targetDims)
    if (cells.some(cell => excludeCells.has(key(cell)))) return null
  }
  return landingPos
}

// Center of a footprint box anchored (min-corner) at `anchor`.
function footprintCenter(anchor: Vec3, dims: FootprintDims): Vec3 {
  return {
    x: anchor.x + (dims.width - 1) / 2,
    y: anchor.y + (dims.height - 1) / 2,
    z: anchor.z + (dims.depth - 1) / 2,
  }
}

// Solid footing = ground/voxel/stair support below, treating water & wind as non-solid
// (they never block movement, so a unit resting on them can be pushed down through them).
function hasSolidFootingBelow(pos: Vec3, map: GameMap): boolean {
  const g = map.groundTiles.find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)
  if (g && g.terrain !== 'water') return true      // water ground isn't solid footing
  if (hasSolidVoxelSupport(map, pos)) return true  // voxelBlocksMovement already excludes water/wind
  if (hasSolidStairSupport(map, pos)) return true
  return false
}

// Every cell of the footprint anchored at `cur` can traverse by `delta` (walls / voxels / ceilings).
function footprintCanStep(cur: Vec3, delta: Vec3, dims: FootprintDims, map: GameMap, destroyed: Set<string>): boolean {
  return getFootprintCells(cur, dims).every(cell =>
    canPassThrough(cell, { x: cell.x + delta.x, y: cell.y + delta.y, z: cell.z + delta.z }, PROJECTILE_CAPS, map, destroyed),
  )
}

// Push (Knockback) / Pull displacement: walk the target step-by-step in 3D away from or toward
// the attacker, stopping at the first blocked step. Direction is taken from the footprint
// centers so a large attacker/target displaces along the correct line; walls, solid voxels and
// ceilings block every body cell (water/wind never block); a grounded target can't be pushed
// down through the floor. Returns the furthest valid landing cell, or null if immediately blocked.
export function findPushPullLandingCell(
  targetPos: Vec3,
  attackerPos: Vec3,
  direction: 'push' | 'pull',
  distance: number,
  targetDims: FootprintDims,
  attackerDims: FootprintDims,
  map: GameMap,
  occupiedSet: Set<string>,
  destroyed: Set<string> = new Set(),
): Vec3 | null {
  const tc = footprintCenter(targetPos, targetDims)
  const ac = footprintCenter(attackerPos, attackerDims)
  let dx = Math.sign(tc.x - ac.x)
  let dy = Math.sign(tc.y - ac.y)
  let dz = Math.sign(tc.z - ac.z)
  if (direction === 'pull') { dx = -dx; dy = -dy; dz = -dz }
  if (dx === 0 && dy === 0 && dz === 0) return null
  let best: Vec3 | null = null
  let cur = { ...targetPos }
  for (let i = 0; i < distance; i++) {
    const stepY = (dy < 0 && hasSolidFootingBelow(cur, map)) ? 0 : dy   // don't shove through a floor
    const delta = { x: dx, y: stepY, z: dz }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) break
    const next: Vec3 = { x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z }
    if (!footprintCanStep(cur, delta, targetDims, map, destroyed)) break                // walls/voxels/ceilings, full body
    if (!isFootprintValid(next, targetDims, map, occupiedSet, PROJECTILE_CAPS)) break    // support + full-footprint occupancy
    best = next
    cur = next
  }
  return best
}

// Determines HOW a destination is reachable: by walking alone, jumping, or flying.
// Runs up to 3 BFS passes to classify without caching assumptions.
export function classifyReachability(
  interceptorPos: Vec3,
  targetPos: Vec3,
  budget: number,
  caps: MovementCapabilities,
  map: GameMap,
  destroyed: Set<string> = new Set(),
): { canWalk: boolean; canJump: boolean; canFly: boolean } {
  const targetKey = key(targetPos)
  const walkCaps: MovementCapabilities = { ...caps, canJump: false, canFly: false }
  if (getReachableCells(interceptorPos, budget, walkCaps, map, destroyed).has(targetKey))
    return { canWalk: true, canJump: false, canFly: false }
  const canFly = caps.canFly
    ? getReachableCells(interceptorPos, budget, { ...caps, canJump: false }, map, destroyed).has(targetKey)
    : false
  const canJump = caps.canJump
    ? getReachableCells(interceptorPos, budget, { ...caps, canFly: false }, map, destroyed).has(targetKey)
    : false
  return { canWalk: false, canJump, canFly }
}

// Resolves a participant's footprint dimensions: 1x1x1 for tamers, size-derived for digimon.
export function getFootprintDimsForParticipant(
  participant: { type: 'tamer' | 'digimon'; entityId: string },
  digimonById: Map<string, { size: string; giganticDimensions?: any }>,
): FootprintDims {
  if (participant.type !== 'digimon') return { width: 1, height: 1, depth: 1 }
  const rec = digimonById.get(participant.entityId)
  if (!rec) return { width: 1, height: 1, depth: 1 }
  return getFootprintDimensions(rec.size as any, rec.giganticDimensions)
}

// Builds a set of occupied cell keys covering every participant's FULL footprint
// (not just their anchor cell), excluding the given participant ids.
export function buildFootprintOccupiedSet(
  participantPositions: Record<string, Vec3>,
  participants: Array<{ id: string; type: 'tamer' | 'digimon'; entityId: string }>,
  digimonById: Map<string, { size: string; giganticDimensions?: any }>,
  excludeIds: Set<string>,
): Set<string> {
  const occupied = new Set<string>()
  for (const p of participants) {
    if (excludeIds.has(p.id)) continue
    const pos = participantPositions[p.id]
    if (!pos) continue
    const dims = getFootprintDimsForParticipant(p, digimonById)
    for (const cell of getFootprintCells(pos, dims)) occupied.add(key(cell))
  }
  return occupied
}

// For area-attack intercede: finds a cell adjacent to the target's footprint that is
// itself part of the Area Attack (the interceder throws themselves into the blast),
// reachable by the interceptor within budget, and fits their footprint. Returns the
// candidate closest to interceptorPos, or null if none exists.
export function findAreaIntercedePosition(
  targetPos: Vec3,
  targetDims: FootprintDims,
  interceptorPos: Vec3,
  budget: number,
  caps: MovementCapabilities,
  interceptorDims: FootprintDims,
  map: GameMap,
  occupied: Set<string>,
  areaCells: Set<string>,
  destroyed: Set<string> = new Set(),
): Vec3 | null {
  const footprintCells = getFootprintCells(targetPos, targetDims)
  const footprintKeys = new Set(footprintCells.map(key))

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const c of footprintCells) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z)
  }

  const reachable = getReachableCells(interceptorPos, budget, caps, map, destroyed)

  let best: Vec3 | null = null
  let bestDist = Infinity
  for (let x = minX - 1; x <= maxX + 1; x++) {
    for (let y = minY - 1; y <= maxY + 1; y++) {
      for (let z = minZ - 1; z <= maxZ + 1; z++) {
        const cell = { x, y, z }
        const k = key(cell)
        if (footprintKeys.has(k)) continue
        if (!areaCells.has(k)) continue
        if (!reachable.has(k)) continue
        if (!isFootprintValid(cell, interceptorDims, map, occupied, caps)) continue
        const dist = Math.abs(cell.x - interceptorPos.x) + Math.abs(cell.y - interceptorPos.y) + Math.abs(cell.z - interceptorPos.z)
        if (dist < bestDist) {
          bestDist = dist
          best = cell
        }
      }
    }
  }
  return best
}

// Rule 3 / throw-out-of-blast existence check: from `targetPos` (the protected ally's
// current position, matching EncounterMap.vue's throwCaps — throw range is anchored to
// the thrown unit's current position, not the interceptor's), is there at least one cell
// reachable within `maxDistance` (the interceding actor's Body stat) using the same
// PROJECTILE_CAPS as findThrowLandingCell, that fits `targetDims`, doesn't overlap
// `occupied`, and lies entirely outside `areaCells`?
export function hasValidThrowOutOfAreaCell(
  targetPos: Vec3,
  maxDistance: number,
  targetDims: FootprintDims,
  map: GameMap,
  occupied: Set<string>,
  areaCells: Set<string>,
  destroyed: Set<string> = new Set(),
): boolean {
  const reachable = getReachableCells(targetPos, maxDistance, PROJECTILE_CAPS, map, destroyed)
  for (const k of reachable) {
    const [x, y, z] = k.split(',').map(Number)
    const cell = { x, y, z }
    if (!isFootprintValid(cell, targetDims, map, occupied, PROJECTILE_CAPS)) continue
    if (getFootprintCells(cell, targetDims).some(c => areaCells.has(key(c)))) continue
    return true
  }
  return false
}
