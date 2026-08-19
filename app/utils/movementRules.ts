import type { GameMap, Vec3, DigimonSize } from '~/types'
import { mapVoxelAt, mapVoxelBlocksMovement, voxelBlocksMovement } from '~/utils/mapVoxels'

export interface MovementCapabilities {
  canFly: boolean
  canJump: boolean
  jumpRange: number     // max jump distance in spaces
  jumpHeight: number    // max jump height in spaces
  canClimb: boolean
  canSwim: boolean
  canDig: boolean
}

export interface FootprintDims { width: number; height: number; depth: number }

// Full 3D box dimensions a unit occupies, based on size class (and gigantic's custom dimensions).
export function getFootprintDimensions(
  size: DigimonSize,
  giganticDimensions?: { width: number; height: number; depth: number } | null,
): FootprintDims {
  if (size === 'gigantic') {
    return {
      width: giganticDimensions?.width ?? 4,
      height: giganticDimensions?.height ?? 4,
      depth: giganticDimensions?.depth ?? 4,
    }
  }
  if (size === 'huge') return { width: 3, height: 3, depth: 3 }
  if (size === 'large') return { width: 2, height: 2, depth: 2 }
  return { width: 1, height: 1, depth: 1 }
}

// All cells of the 3D box anchored at `anchor` (min corner), extending +x, +y, +z.
export function getFootprintCells(anchor: Vec3, dims: FootprintDims): Vec3[] {
  const cells: Vec3[] = []
  for (let dx = 0; dx < dims.width; dx++)
    for (let dy = 0; dy < dims.height; dy++)
      for (let dz = 0; dz < dims.depth; dz++)
        cells.push({ x: anchor.x + dx, y: anchor.y + dy, z: anchor.z + dz })
  return cells
}

function key(v: Vec3) { return `${v.x},${v.y},${v.z}` }

// Maps are endless: the `dimensions` field only seeds the starting floor + camera centering and no
// longer bounds movement. Open-air flight/knockback is limited by move budget / distance instead.
// (Kept as a function so the `canFly && isWithinMapFootprint(...)` call sites stay unchanged.)
export function isWithinMapFootprint(_map: GameMap, _pos: Vec3): boolean {
  return true
}

// True if a wall (without a door) blocks the cardinal move from→to.
// Only call for cardinal moves (exactly one of dx/dz is non-zero, dy=0).
// A wall on the boundary between two tiles is stored at EITHER tile with the
// appropriate face, so we check both tiles.
function isSolidWall(map: GameMap, from: Vec3, to: Vec3, destroyed: Set<string>): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  // This function only handles cardinal horizontal moves
  if (dx === 0 && dz === 0) return false
  if (dx !== 0 && dz !== 0) return false  // diagonal — handled separately

  const y = from.y  // walls are per-floor; horizontal moves stay on same floor

  for (const wall of (map.walls ?? [])) {
    if (destroyed.has(wall.id)) continue
    if ((wall.y ?? 0) !== y) continue
    if (map.doors.some(d => d.wallId === wall.id)) continue  // door makes this face passable

    const atFrom = wall.x === from.x && wall.z === from.z
    const atTo   = wall.x === to.x   && wall.z === to.z

    let blocked = false
    if (dx === 1) {  // moving east
      if (atFrom && wall.face === 'east')  blocked = true
      if (atTo   && wall.face === 'west')  blocked = true
    }
    if (dx === -1) {  // moving west
      if (atFrom && wall.face === 'west')  blocked = true
      if (atTo   && wall.face === 'east')  blocked = true
    }
    if (dz === -1) {  // moving north (z decreases)
      if (atFrom && wall.face === 'north') blocked = true
      if (atTo   && wall.face === 'south') blocked = true
    }
    if (dz === 1) {  // moving south (z increases)
      if (atFrom && wall.face === 'south') blocked = true
      if (atTo   && wall.face === 'north') blocked = true
    }
    if (blocked) return true
  }
  return false
}

function isBlockedByCeiling(map: GameMap, from: Vec3, to: Vec3, destroyed: Set<string>): boolean {
  if (to.y <= from.y) return false // only blocks upward movement
  for (const ceiling of (map.ceilings ?? [])) {
    if (destroyed.has(ceiling.id)) continue
    if (ceiling.x === from.x && ceiling.y === from.y && ceiling.z === from.z) return true
  }
  return false
}

function getGroundTile(map: GameMap, pos: Vec3) {
  return (map.groundTiles ?? []).find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
}

function getSpaceTile(map: GameMap, pos: Vec3) {
  return (map.spaceTiles ?? []).find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
}

export function hasSolidVoxelSupport(map: GameMap, pos: Vec3): boolean {
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

export function hasSolidStairSupport(map: GameMap, pos: Vec3): boolean {
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

// Returns whether a unit with the given capabilities can move from `from` to `to`
export function canPassThrough(
  from: Vec3,
  to: Vec3,
  caps: MovementCapabilities,
  map: GameMap,
  destroyedStructures: Set<string> = new Set(),
): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z

  // Solid voxels and stairs occupy their grid cell — units stand on top, not inside.
  if (mapVoxelBlocksMovement(map, to)) return caps.canDig
  if (hasStairAt(map, to)) return caps.canDig

  // Diagonal horizontal moves must not cut through walls on either cardinal axis.
  // Applies regardless of Y change so 3D diagonal moves can't bypass y=0 walls.
  if (dx !== 0 && dz !== 0) {
    if (isSolidWall(map, from, { x: to.x, y: from.y, z: from.z }, destroyedStructures)) return false
    if (isSolidWall(map, from, { x: from.x, y: from.y, z: to.z }, destroyedStructures)) return false
    if (isSolidWall(map, { x: to.x, y: from.y, z: from.z }, to, destroyedStructures)) return false
    if (isSolidWall(map, { x: from.x, y: from.y, z: to.z }, to, destroyedStructures)) return false
  }

  // Ceiling check — blocks all upward movement
  if (isBlockedByCeiling(map, from, to, destroyedStructures)) return false
  // Wall check — blocks horizontal movement
  if (isSolidWall(map, from, to, destroyedStructures)) return false

  const groundTile = getGroundTile(map, to)
  const spaceTile = getSpaceTile(map, to)

  if (groundTile) {
    // Water terrain requires swimmer
    if (groundTile.terrain === 'water' && !caps.canSwim) return false
    // Earth terrain requires digger
    if (groundTile.terrain === 'earth' && !caps.canDig) return false
    if (dy > 0) {
      if (caps.canFly) return true
      if (caps.canJump && dy <= caps.jumpHeight) return true
      // Natural step-up: walking up one level while also moving laterally (like climbing a stair step).
      // This is already gated by ceiling checks above (ceilings inside rooms prevent it) and by wall
      // checks (a wall in the lateral direction blocks the step-up too).
      // Straight-up (dx=0, dz=0) without a stair entity is still blocked — that path is the wall bypass.
      if (dy === 1 && (dx !== 0 || dz !== 0)) return true
      return false
    }
    return true
  }

  if (spaceTile) {
    if (spaceTile.spaceType === 'water') return caps.canSwim
    if (spaceTile.spaceType === 'earth') return caps.canDig
    // Air tile — requires flight, jump, or climb
    if (to.y > from.y) {
      // Going up in air
      if (caps.canFly) return true
      if (caps.canJump && to.y - from.y <= caps.jumpHeight) return true
      if (caps.canClimb) {
        // Check for climbable wall face on adjacent wall
        const hasClimbable = (map.walls ?? []).some(w =>
          !destroyedStructures.has(w.id) &&
          w.x === to.x && w.y === to.y && w.z === to.z
        )
        return hasClimbable
      }
      return false
    }
    if (to.y < from.y) {
      // Falling / descending — always allowed (gravity)
      return true
    }
    // Moving laterally through air
    if (caps.canFly) return true
    // Can move laterally at same air-level if jumping (horizontal jump)
    if (caps.canJump) return true
    return false
  }

  // No tile at destination: allow standing/moving on top of solid voxels or stairs.
  if (canMoveOntoSupportedVoxelTop(from, to, caps, map)) return true
  if (canMoveOntoSupportedStairTop(from, to, caps, map)) return true
  if (caps.canFly && isWithinMapFootprint(map, to)) return true  // fliers traverse open (unpainted) air
  if (caps.canDig) return true  // diggers can go through solid cells too
  return false
}

// Whether a jumper can reach `pos` in the air from `origin`. Descending and level jumps pass
// trivially (dy <= 0); climbing is capped at jumpHeight. Without an `origin` there is nothing to
// measure against, so jumping is not considered.
function canJumpTo(pos: Vec3, origin: Vec3 | undefined, caps: MovementCapabilities): boolean {
  return !!origin && caps.canJump && (pos.y - origin.y) <= caps.jumpHeight
}

// Can a unit land (end its turn) at `pos`? Pass `origin` (the cell the unit is moving/jumping
// from) to let jumpers finish in mid-air within their jump height — omitting it keeps the
// stricter fliers-only behaviour.
export function canLandOn(
  pos: Vec3,
  caps: MovementCapabilities,
  map: GameMap,
  occupiedPositions: Set<string>,  // positions already occupied by units that block
  origin?: Vec3,
): boolean {
  if (occupiedPositions.has(key(pos))) return false
  if (mapVoxelBlocksMovement(map, pos)) return false
  if (hasStairAt(map, pos)) return false

  const groundTile = getGroundTile(map, pos)
  if (groundTile) {
    if (groundTile.terrain === 'water') return caps.canSwim
    if (groundTile.terrain === 'earth') return caps.canDig
    return true
  }

  const spaceTile = getSpaceTile(map, pos)
  if (spaceTile) {
    if (spaceTile.spaceType === 'water') return caps.canSwim
    if (spaceTile.spaceType === 'earth') return caps.canDig
    // Air tile — can land if flying/hovering, or jumping up to jump height
    return caps.canFly || canJumpTo(pos, origin, caps)
  }

  // Empty cell directly above a solid voxel or stair is a valid landing surface.
  if (hasSolidVoxelSupport(map, pos)) return true
  if (hasSolidStairSupport(map, pos)) return true

  // Open (unpainted) air — fliers hover/land within the map footprint; jumpers may finish here
  // up to their jump height (they fall to the ground at end of turn, taking no damage).
  if ((caps.canFly || canJumpTo(pos, origin, caps)) && isWithinMapFootprint(map, pos)) return true

  return false
}

// Return whether the size difference between two units means the mover ignores the blocker as an obstacle
// Units 2+ sizes different: mover can pass through but can't end there
export function sizeInteraction(moverSize: DigimonSize, blockerSize: DigimonSize): 'blocked' | 'passable-only' {
  const order: DigimonSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gigantic']
  const moverIdx = order.indexOf(moverSize)
  const blockerIdx = order.indexOf(blockerSize)
  if (Math.abs(moverIdx - blockerIdx) >= 2) return 'passable-only'
  return 'blocked'
}

// ---------------------------------------------------------------------------
// Capabilities, fall & airborne helpers — the single source of truth shared by
// the client (useMapMovement, MapCanvas) and the server (mapMovement, gravity).
// ---------------------------------------------------------------------------

// Movement capabilities for a thrown body in flight (Clash Throw / Intercede Throw / Push-Pull).
export const PROJECTILE_CAPS: MovementCapabilities = {
  canFly: true,
  canJump: true,
  jumpHeight: 99,
  jumpRange: 99,
  canClimb: false,
  canSwim: true,
  canDig: false,
}

// Derives a unit's MovementCapabilities from its qualities + derived stats.
export function detectCapabilities(
  qualities: Array<{ id: string; choiceId?: string; ranks?: number }>,
  movement: number,
  ram: number,
  cpu: number,
): MovementCapabilities {
  const hasJumper = qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'jumper')
  const hasAdvJumper = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
  return {
    canFly: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'flight'),
    canJump: hasJumper,
    jumpRange: hasJumper ? (hasAdvJumper ? movement + cpu : movement) : 0,
    jumpHeight: hasJumper ? (hasAdvJumper ? movement + cpu * 5 : movement) : 0,
    canClimb: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'wallclimber'),
    canSwim: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'swimmer'),
    canDig: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'digger'),
  }
}

// True if `pos` has no solid support (ground tile at it, or a movement-blocking voxel/stair below).
// Wind voxels aren't movement-blocking and ground terrain is only normal/water/earth, so wind never
// counts as support.
export function isPositionInAir(pos: Vec3, map: GameMap): boolean {
  if (getGroundTile(map, pos)) return false
  if (hasSolidVoxelSupport(map, pos)) return false
  if (hasSolidStairSupport(map, pos)) return false
  return true
}

// Fall damage: meters fallen past the first 5, reduced by the faller's CPU (floored at 1 for any
// qualifying fall). Tumbler adds an extra RAM×2 reduction (can reach 0); Advanced Mobility: Jumper
// negates fall damage entirely. Falls of 5m or less deal nothing.
export function computeFallDamage(
  fallHeight: number,
  cpu: number,
  hasTumbler: boolean,
  hasAdvJumper: boolean,
  ram: number,
): number {
  const pastFive = fallHeight - 5
  if (pastFive <= 0) return 0
  let dmg = Math.max(1, pastFive - cpu)
  if (hasTumbler) {
    if (hasAdvJumper) return 0
    dmg = Math.max(0, dmg - ram * 2)
  }
  return dmg
}

// A footprint is airborne when every cell of its base (bottom) layer sits in air (no support below).
export function isFootprintAirborne(anchor: Vec3, dims: FootprintDims, map: GameMap): boolean {
  for (let dx = 0; dx < dims.width; dx++)
    for (let dz = 0; dz < dims.depth; dz++)
      if (!isPositionInAir({ x: anchor.x + dx, y: anchor.y, z: anchor.z + dz }, map)) return false
  return true
}

// Lowest Y worth scanning down to when settling a fall — the map's lowest ground/voxel/stair (so a
// unit can fall onto a floor below the base level), or the unit's own level if the map has none.
function lowestStructureY(map: GameMap): number {
  let min = Infinity
  for (const t of (map.groundTiles ?? [])) if (t.y < min) min = t.y
  for (const v of (map.voxels ?? [])) if (v.y < min) min = v.y
  for (const s of (map.stairs ?? [])) if (s.y < min) min = s.y
  return min === Infinity ? 0 : min
}

// Settle an airborne footprint straight down: rests on the highest support at or below its current Y
// (including floors below the base level). If the whole column below is open (no floor/voxel), the
// unit stays where it is rather than falling into infinite void.
export function settleFootprintY(anchor: Vec3, dims: FootprintDims, map: GameMap): number {
  if (!isFootprintAirborne(anchor, dims, map)) return anchor.y
  const minY = lowestStructureY(map)
  for (let y = anchor.y - 1; y >= minY; y--) {
    if (!isFootprintAirborne({ x: anchor.x, y, z: anchor.z }, dims, map)) return y
  }
  return anchor.y
}

// Everything `resolveFall` needs about the faller. Flyers hover; airborneByJump units still fall but
// take no damage; Tumbler/adv-jumper adjust the damage; cpu/ram feed the fall formula.
export interface FallerProfile {
  cpu: number
  ram: number
  hasTumbler: boolean
  hasAdvJumper: boolean
  canFly: boolean
  airborneByJump?: boolean
}

// Resolves a unit falling from `startPos`: settles its footprint straight down to the surface and
// computes fall damage. Flyers hover in place (no fall); a unit that jumped into the air still falls
// but takes 0 damage. Single source used by push/pull, Clash Throw, thrown-ally and end-of-turn gravity.
export function resolveFall(
  startPos: Vec3,
  dims: FootprintDims,
  map: GameMap,
  profile: FallerProfile,
): { landingPos: Vec3; fallHeight: number; damage: number } {
  if (profile.canFly) return { landingPos: startPos, fallHeight: 0, damage: 0 }
  const landingY = settleFootprintY(startPos, dims, map)
  const landingPos = { x: startPos.x, y: landingY, z: startPos.z }
  const fallHeight = startPos.y - landingY
  if (fallHeight <= 0) return { landingPos, fallHeight: 0, damage: 0 }
  const damage = profile.airborneByJump
    ? 0
    : computeFallDamage(fallHeight, profile.cpu, profile.hasTumbler, profile.hasAdvJumper, profile.ram)
  return { landingPos, fallHeight, damage }
}
