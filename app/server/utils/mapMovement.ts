import type { Vec3, GameMap } from '../../types'
import { mapVoxelAt, mapVoxelBlocksMovement, voxelBlocksMovement } from '../../utils/mapVoxels'
import type { FootprintDims } from '../../utils/movementRules'
import { getFootprintDimensions, getFootprintCells, isWithinMapFootprint } from '../../utils/movementRules'

export type { FootprintDims }
export { getFootprintDimensions, getFootprintCells }

export interface MovementCapabilities {
  canFly: boolean
  canJump: boolean
  jumpRange: number
  jumpHeight: number
  canClimb: boolean
  canSwim: boolean
  canDig: boolean
}

function key(v: Vec3) { return `${v.x},${v.y},${v.z}` }

function isSolidWall(map: GameMap, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x, dz = to.z - from.z
  return map.walls.some(w => {
    if (w.x !== from.x || w.z !== from.z) return false
    if (w.face === 'north' && dz === -1 && dx === 0) return true
    if (w.face === 'south' && dz === 1  && dx === 0) return true
    if (w.face === 'east'  && dx === 1  && dz === 0) return true
    if (w.face === 'west'  && dx === -1 && dz === 0) return true
    return false
  })
}

function isBlockedByCeiling(map: GameMap, from: Vec3, to: Vec3): boolean {
  if (to.y <= from.y) return false
  return map.ceilings.some(c => c.x === from.x && c.y === from.y && c.z === from.z)
}

function hasSolidVoxelSupport(map: GameMap, pos: Vec3): boolean {
  const below = mapVoxelAt(map, { x: pos.x, y: pos.y - 1, z: pos.z })
  return Boolean(below && voxelBlocksMovement(below))
}

function canMoveOntoSupportedVoxelTop(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap): boolean {
  if (!hasSolidVoxelSupport(map, to)) return false
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  if (dy > 0) {
    if (caps.canFly) return true
    if (caps.canJump && dy <= caps.jumpHeight) return true
    if (dy === 1 && (dx !== 0 || dz !== 0)) return true
    return false
  }
  return true
}

function hasStairAt(map: GameMap, pos: Vec3): boolean {
  return map.stairs.some(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)
}

function hasSolidStairSupport(map: GameMap, pos: Vec3): boolean {
  return map.stairs.some(s => s.x === pos.x && s.y === pos.y - 1 && s.z === pos.z)
}

function canMoveOntoSupportedStairTop(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap): boolean {
  if (!hasSolidStairSupport(map, to)) return false
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  if (dy > 0) {
    if (caps.canFly) return true
    if (caps.canJump && dy <= caps.jumpHeight) return true
    if (dy === 1 && (dx !== 0 || dz !== 0)) return true
    return false
  }
  return true
}

function canPassThrough(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap): boolean {
  if (mapVoxelBlocksMovement(map, to)) return caps.canDig
  if (hasStairAt(map, to)) return caps.canDig
  if (isBlockedByCeiling(map, from, to)) return false
  if (isSolidWall(map, from, to)) return false

  const groundTile = map.groundTiles.find(t => t.x === to.x && t.y === to.y && t.z === to.z)
  if (groundTile) {
    if (groundTile.terrain === 'water' && !caps.canSwim) return false
    if (groundTile.terrain === 'earth' && !caps.canDig) return false
    return true
  }

  const spaceTile = map.spaceTiles.find(t => t.x === to.x && t.y === to.y && t.z === to.z)
  if (spaceTile) {
    if (spaceTile.spaceType === 'water') return caps.canSwim
    if (spaceTile.spaceType === 'earth') return caps.canDig
    if (to.y > from.y) {
      if (caps.canFly) return true
      if (caps.canJump && to.y - from.y <= caps.jumpHeight) return true
      return false
    }
    return caps.canFly || caps.canJump
  }

  if (canMoveOntoSupportedVoxelTop(from, to, caps, map)) return true
  if (canMoveOntoSupportedStairTop(from, to, caps, map)) return true
  if (caps.canFly && isWithinMapFootprint(map, to)) return true // fliers traverse open (unpainted) air
  return caps.canDig
}

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
): Set<string> {
  const visited = new Map<string, number>([[key(origin), 0]])
  const queue: Array<{ pos: Vec3; cost: number }> = [{ pos: origin, cost: 0 }]
  while (queue.length > 0) {
    const { pos, cost } = queue.shift()!
    if (cost >= budget) continue
    for (const nb of neighbours(pos)) {
      const k = key(nb)
      if (visited.has(k)) continue
      if (!canPassThrough(pos, nb, caps, map)) continue
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
  if (map.groundTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if (map.spaceTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if (hasSolidVoxelSupport(map, pos)) return true
  if (hasSolidStairSupport(map, pos)) return true
  if (caps?.canFly && isWithinMapFootprint(map, pos)) return true
  return false
}

export function isPositionInAir(pos: Vec3, map: GameMap): boolean {
  if (map.groundTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return false
  if (hasSolidVoxelSupport(map, pos)) return false
  if (hasSolidStairSupport(map, pos)) return false
  return true
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
      if (!canPassThrough(pos, nb, caps, map)) continue
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
): Vec3 | null {
  const lineCells = getCellsOnLine(attackerPos, targetPos)
  if (lineCells.length === 0) return null
  const sorted = [...lineCells].reverse() // closest to target first
  const reachable = getReachableCells(interceptorPos, budget, caps, map)
  for (const cell of sorted) {
    if (reachable.has(key(cell)) && isFootprintValid(cell, interceptorDims, map, occupiedSet, caps)) return cell
  }
  return null
}

// Movement capabilities for a thrown body in flight (Clash Throw / Intercede Throw).
const PROJECTILE_CAPS: MovementCapabilities = {
  canFly: true,
  canJump: true,
  jumpHeight: 99,
  jumpRange: 99,
  canClimb: false,
  canSwim: true,
  canDig: false,
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
): Vec3 | null {
  const reachable = getReachableCells(originPos, maxDistance, PROJECTILE_CAPS, map)
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
function footprintCanStep(cur: Vec3, delta: Vec3, dims: FootprintDims, map: GameMap): boolean {
  return getFootprintCells(cur, dims).every(cell =>
    canPassThrough(cell, { x: cell.x + delta.x, y: cell.y + delta.y, z: cell.z + delta.z }, PROJECTILE_CAPS, map),
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
    if (!footprintCanStep(cur, delta, targetDims, map)) break                          // walls/voxels/ceilings, full body
    if (!isFootprintValid(next, targetDims, map, occupiedSet, PROJECTILE_CAPS)) break   // support + full-footprint occupancy
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
): { canWalk: boolean; canJump: boolean; canFly: boolean } {
  const targetKey = key(targetPos)
  const walkCaps: MovementCapabilities = { ...caps, canJump: false, canFly: false }
  if (getReachableCells(interceptorPos, budget, walkCaps, map).has(targetKey))
    return { canWalk: true, canJump: false, canFly: false }
  const canFly = caps.canFly
    ? getReachableCells(interceptorPos, budget, { ...caps, canJump: false }, map).has(targetKey)
    : false
  const canJump = caps.canJump
    ? getReachableCells(interceptorPos, budget, { ...caps, canFly: false }, map).has(targetKey)
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
): Vec3 | null {
  const footprintCells = getFootprintCells(targetPos, targetDims)
  const footprintKeys = new Set(footprintCells.map(key))

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const c of footprintCells) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x)
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y)
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z)
  }

  const reachable = getReachableCells(interceptorPos, budget, caps, map)

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
): boolean {
  const reachable = getReachableCells(targetPos, maxDistance, PROJECTILE_CAPS, map)
  for (const k of reachable) {
    const [x, y, z] = k.split(',').map(Number)
    const cell = { x, y, z }
    if (!isFootprintValid(cell, targetDims, map, occupied, PROJECTILE_CAPS)) continue
    if (getFootprintCells(cell, targetDims).some(c => areaCells.has(key(c)))) continue
    return true
  }
  return false
}

export function detectCapabilitiesFromQualities(qualities: Array<{ id: string; choiceId?: string; ranks?: number }>, movement: number, ram: number, cpu: number): MovementCapabilities {
  const hasFlight = qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'flight')
  const hasAdvFlight = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-flight')
  const hasJumper = qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'jumper')
  const hasAdvJumper = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
  return {
    canFly: hasFlight,
    canJump: hasJumper,
    jumpRange: hasJumper ? (hasAdvJumper ? movement + cpu : movement) : 0,
    jumpHeight: hasJumper ? (hasAdvJumper ? movement + cpu * 5 : movement) : 0,
    canClimb: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'wallclimber'),
    canSwim: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'swimmer'),
    canDig: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'digger'),
  }
}
