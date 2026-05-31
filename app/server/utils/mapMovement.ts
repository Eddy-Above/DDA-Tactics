import type { Vec3, GameMap, DigimonSize } from '../../types'
import { mapVoxelAt, mapVoxelBlocksMovement, voxelBlocksMovement } from '../../utils/mapVoxels'

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
): boolean {
  if (occupiedSet.has(key(pos))) return false
  if (map.groundTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if (map.spaceTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return true
  if (hasSolidVoxelSupport(map, pos)) return true
  if (hasSolidStairSupport(map, pos)) return true
  return false
}

export function isPositionInAir(pos: Vec3, map: GameMap): boolean {
  if (map.groundTiles.some(t => t.x === pos.x && t.y === pos.y && t.z === pos.z)) return false
  if (hasSolidVoxelSupport(map, pos)) return false
  if (hasSolidStairSupport(map, pos)) return false
  return true
}

export function getSizeFootprintDimension(
  size: DigimonSize,
  giganticDimensions?: { width: number; height: number; depth: number } | null,
): number {
  if (size === 'gigantic') return giganticDimensions?.width ?? 4
  if (size === 'huge') return 3
  if (size === 'large') return 2
  return 1
}

export function getFootprintCells(center: Vec3, dim: number): Vec3[] {
  const cells: Vec3[] = []
  for (let dx = 0; dx < dim; dx++)
    for (let dz = 0; dz < dim; dz++)
      cells.push({ x: center.x + dx, y: center.y, z: center.z + dz })
  return cells
}

export function isFootprintValid(
  center: Vec3,
  dim: number,
  map: GameMap,
  occupiedSet: Set<string>,
): boolean {
  return getFootprintCells(center, dim).every(cell => isValidLandingPosition(cell, map, occupiedSet))
}

// BFS from fromPos (skipping fromPos itself) respecting walls; returns the closest cell
// where the target's footprint (targetDim × targetDim) fits on valid, unoccupied tiles.
export function findClosestValidDisplacementPosition(
  fromPos: Vec3,
  map: GameMap,
  caps: MovementCapabilities,
  occupiedSet: Set<string>,
  targetDim: number = 1,
  maxRadius: number = 6,
): Vec3 | null {
  const visited = new Map<string, number>([[key(fromPos), 0]])
  const queue: Array<{ pos: Vec3; cost: number }> = [{ pos: fromPos, cost: 0 }]
  while (queue.length > 0) {
    const { pos, cost } = queue.shift()!
    if (cost > 0 && isFootprintValid(pos, targetDim, map, occupiedSet)) return pos
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
  interceptorDim: number,
  map: GameMap,
  occupiedSet: Set<string>,
): Vec3 | null {
  const lineCells = getCellsOnLine(attackerPos, targetPos)
  if (lineCells.length === 0) return null
  const sorted = [...lineCells].reverse() // closest to target first
  const reachable = getReachableCells(interceptorPos, budget, caps, map)
  for (const cell of sorted) {
    if (reachable.has(key(cell)) && isFootprintValid(cell, interceptorDim, map, occupiedSet)) return cell
  }
  return null
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
