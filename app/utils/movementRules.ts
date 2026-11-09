import type { GameMap, Vec3, DigimonSize } from '~/types'
import { getVoxelMaterialId, mapVoxelAt as findMapVoxelAt, voxelBlocksMovement } from '~/utils/mapVoxels'
import { getMovementMapIndex } from '~/utils/movementMapIndex'
export { createMovementMapView } from '~/utils/movementMapIndex'
import { getNaturewalkElements, resolveNaturewalkEnvironment, type NaturewalkEnvironmentSettings } from '~/utils/naturewalk'
import type { ElementType } from '~/types'
import type { StatefulTraversal } from '~/utils/pathfinding'

export interface MovementCapabilities {
  canFly: boolean
  canJump: boolean
  jumpRange: number     // max jump distance in spaces
  jumpHeight: number    // max jump height in spaces
  canClimb: boolean
  canSwim: boolean
  canDig: boolean
  canJumpFromWater?: boolean
  naturewalkElements?: ElementType[]
  naturewalkEnvironment?: NaturewalkEnvironmentSettings
  movementSpeed?: number
  swimSpeed?: number
  digSpeed?: number
  climbSpeed?: number
  flySpeed?: number
  canClimbCeilings?: boolean
  canDigHardSurfaces?: boolean
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
  if (!map.walls?.length) return false

  const y = from.y  // walls are per-floor; horizontal moves stay on same floor
  const index = getMovementMapIndex(map)
  const walls = index
    ? [...(index.walls.get(key(from)) ?? []), ...(index.walls.get(`${to.x},${y},${to.z}`) ?? [])]
    : map.walls

  for (const wall of walls) {
    if (destroyed.has(wall.id)) continue
    if ((wall.y ?? 0) !== y) continue
    if (index ? index.doors.has(wall.id) : map.doors.some(d => d.wallId === wall.id)) continue  // door makes this face passable

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
  if (!map.ceilings?.length) return false
  const index = getMovementMapIndex(map)
  for (const ceiling of (index ? index.ceilings.get(key(from)) ?? [] : map.ceilings)) {
    if (destroyed.has(ceiling.id)) continue
    if (ceiling.x === from.x && ceiling.y === from.y && ceiling.z === from.z) return true
  }
  return false
}

function getGroundTile(map: GameMap, pos: Vec3) {
  const index = getMovementMapIndex(map)
  if (index) return index.ground.get(key(pos)) ?? null
  return (map.groundTiles ?? []).find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
}

function getSpaceTile(map: GameMap, pos: Vec3) {
  const index = getMovementMapIndex(map)
  if (index) return index.space.get(key(pos)) ?? null
  return (map.spaceTiles ?? []).find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
}

function mapVoxelAt(map: GameMap, pos: Vec3) {
  const index = getMovementMapIndex(map)
  return index ? index.voxels.get(key(pos)) ?? null : findMapVoxelAt(map, pos)
}

function mapVoxelBlocksMovement(map: GameMap, pos: Vec3): boolean {
  const voxel = mapVoxelAt(map, pos)
  return Boolean(voxel && voxelBlocksMovement(voxel))
}

// Water can be stored in either legacy tile layer or as a material volume. An explicit solid
// voxel still occupies its cell, even when a water tile is also painted there.
export function isWaterCell(map: GameMap, pos: Vec3): boolean {
  const voxel = mapVoxelAt(map, pos)
  if (voxel && voxelBlocksMovement(voxel)) return false
  return getGroundTile(map, pos)?.terrain === 'water'
    || getSpaceTile(map, pos)?.spaceType === 'water'
    || Boolean(voxel && getVoxelMaterialId(voxel) === 'water')
}

function isWaterVolumeCell(map: GameMap, pos: Vec3): boolean {
  const voxel = mapVoxelAt(map, pos)
  if (voxel && voxelBlocksMovement(voxel)) return false
  return getSpaceTile(map, pos)?.spaceType === 'water'
    || Boolean(voxel && getVoxelMaterialId(voxel) === 'water')
}

// A swimmer can occupy water or its upper volume surface, including when surfacing from depth.
// Ground-water tiles already represent their surface at their saved Y.
export function isSwimmingCell(map: GameMap, pos: Vec3): boolean {
  if (mapVoxelBlocksMovement(map, pos) || hasStairAt(map, pos)) return false
  if (isWaterCell(map, pos)) return true
  if (getGroundTile(map, pos)) return false
  return isWaterVolumeCell(map, { x: pos.x, y: pos.y - 1, z: pos.z })
}

// Zero marks ordinary terrain; a positive multiplier marks a cell occupied by burrow terrain.
// Steel and elemental energy remain barriers even to Advanced Digger.
export function getDigTerrainMultiplier(
  map: GameMap,
  pos: Vec3,
  caps: Pick<MovementCapabilities, 'canDig' | 'canDigHardSurfaces'>,
): number {
  const voxel = mapVoxelAt(map, pos)
  if (voxel && voxelBlocksMovement(voxel)) {
    if (!caps.canDig) return Infinity
    const material = voxel.feature === 'window' ? 'glass' : getVoxelMaterialId(voxel)
    if (['fire', 'thunder', 'light', 'darkness', 'water', 'wind'].includes(material)) return Infinity
    if (material === 'steel') return Infinity
    const softMetal = material === 'soft-metal' || voxel.tags?.includes('soft-metal')
    if (softMetal) return caps.canDigHardSurfaces ? 2 : Infinity
    if (['earth', 'sand', 'snow'].includes(material) || voxel.tags?.includes('diggable')) return 1
    if (['void', 'wood', 'ice', 'glass'].includes(material)) return caps.canDigHardSurfaces ? 1 : Infinity
    return Infinity
  }
  if (hasStairAt(map, pos)) return caps.canDig && caps.canDigHardSurfaces ? 1 : Infinity
  if (getGroundTile(map, pos)?.terrain === 'earth' || getSpaceTile(map, pos)?.spaceType === 'earth') {
    return caps.canDig ? 1 : Infinity
  }
  return 0
}

// Vertical wall faces and neighbouring solid voxels provide footholds. Advanced climbers also
// cling beneath a ceiling or a voxel above; none of these supports permits crossing that solid.
export function hasClimbSupport(
  map: GameMap,
  pos: Vec3,
  caps: Pick<MovementCapabilities, 'canClimb' | 'canClimbCeilings'>,
  destroyed: Set<string> = new Set(),
): boolean {
  if (!caps.canClimb || mapVoxelBlocksMovement(map, pos) || hasStairAt(map, pos)) return false
  const index = getMovementMapIndex(map)
  const walls = index ? [pos, { ...pos, x: pos.x - 1 }, { ...pos, x: pos.x + 1 },
    { ...pos, z: pos.z - 1 }, { ...pos, z: pos.z + 1 }].flatMap(cell => index.walls.get(key(cell)) ?? []) : map.walls ?? []
  const touchesWall = walls.some(wall => {
    if (destroyed.has(wall.id) || (wall.y ?? 0) !== pos.y) return false
    const door = index ? index.doors.get(wall.id) : (map.doors ?? []).find(candidate => candidate.wallId === wall.id)
    if (door && (door.isOpen || destroyed.has(door.id))) return false
    if (wall.x === pos.x && wall.z === pos.z) return true
    return (wall.x === pos.x - 1 && wall.z === pos.z && wall.face === 'east')
      || (wall.x === pos.x + 1 && wall.z === pos.z && wall.face === 'west')
      || (wall.z === pos.z - 1 && wall.x === pos.x && wall.face === 'south')
      || (wall.z === pos.z + 1 && wall.x === pos.x && wall.face === 'north')
  })
  if (touchesWall) return true
  if (([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).some(([dx, dz]) =>
    mapVoxelBlocksMovement(map, { x: pos.x + dx, y: pos.y, z: pos.z + dz }))) return true
  if (!caps.canClimbCeilings) return false
  return (index ? index.ceilings.get(key(pos)) ?? [] : map.ceilings ?? []).some(ceiling => !destroyed.has(ceiling.id)
    && ceiling.x === pos.x && ceiling.y === pos.y && ceiling.z === pos.z)
    || mapVoxelBlocksMovement(map, { x: pos.x, y: pos.y + 1, z: pos.z })
}

// Every mode counts the distance already travelled against its own full movement speed.
// Legacy/projectile capability objects without numeric mode speeds keep uniform-cost paths.
export function getMovementCostProfile(
  caps: MovementCapabilities,
  landBudget = caps.movementSpeed ?? 0,
  destroyedStructures: Set<string> = new Set(),
  origin?: Vec3,
): { budget: number; stepCost: (from: Vec3, to: Vec3, map: GameMap, spent?: number, launchOrigin?: Vec3 | null) => number } | null {
  if ([caps.swimSpeed, caps.digSpeed, caps.climbSpeed, caps.flySpeed].every(speed => speed === undefined)) return null
  const landSpeed = Math.max(0, landBudget)
  const swimSpeed = caps.canSwim ? Math.max(0, caps.swimSpeed ?? landSpeed) : 0
  const digSpeed = caps.canDig ? Math.max(0, caps.digSpeed ?? landSpeed) : 0
  const climbSpeed = caps.canClimb ? Math.max(0, caps.climbSpeed ?? landSpeed) : 0
  const flySpeed = caps.canFly ? Math.max(0, caps.flySpeed ?? landSpeed) : 0
  const jumpSpeed = caps.canJump ? Math.max(0, caps.jumpRange, caps.jumpHeight) : 0
  const budget = Math.max(landSpeed, swimSpeed, digSpeed, climbSpeed, flySpeed, jumpSpeed)
  // A profile is a snapshot for one synchronous search. Cache only the cells
  // that search visits; the next search creates a new profile after map edits.
  let cachedMap: GameMap | undefined
  type TerrainCell = { water: boolean; swimming: boolean; dig?: number; climb?: boolean; walk?: boolean }
  const cells = new Map<string, TerrainCell>()
  const cellAt = (pos: Vec3, map: GameMap) => {
    if (cachedMap !== map) {
      cachedMap = map
      cells.clear()
    }
    const cellKey = key(pos)
    const cached = cells.get(cellKey)
    if (cached) return cached
    const water = isWaterCell(map, pos)
    const cell: TerrainCell = { water, swimming: water || isSwimmingCell(map, pos) }
    cells.set(cellKey, cell)
    return cell
  }
  const withinSpeed = (speed: number, spent: number, cost = 1): number =>
    speed > 0 && Number.isFinite(cost) && spent + cost <= speed + 1e-9 ? cost : Infinity
  return {
    budget,
    stepCost: (from, to, map, spent = 0, launchOrigin) => {
      const destination = cellAt(to, map)
      if (destination.water) return withinSpeed(swimSpeed, spent)
      if (destination.swimming) return withinSpeed(Math.max(swimSpeed, flySpeed), spent)
      destination.dig ??= getDigTerrainMultiplier(map, to, caps)
      if (destination.dig > 0) {
        const environment = caps.naturewalkElements?.length
          ? resolveNaturewalkEnvironment(map, to, caps.naturewalkEnvironment ?? { elements: [], useMapTerrain: true }) : []
        const ignoresPenalty = Number.isFinite(destination.dig) && caps.naturewalkElements?.some(element => environment.includes(element))
        return withinSpeed(digSpeed, spent, ignoresPenalty ? 1 : destination.dig)
      }
      destination.walk ??= Boolean(getGroundTile(map, to)) || hasSolidVoxelSupport(map, to) || hasSolidStairSupport(map, to)
      const walking = destination.walk && !(to.y > from.y && to.x === from.x && to.z === from.z)
      let speed = Math.max(walking ? landSpeed : 0, flySpeed)
      if (caps.canClimb) {
        destination.climb ??= hasClimbSupport(map, to, caps, destroyedStructures)
        if (destination.climb) speed = Math.max(speed, climbSpeed)
      }
      const jumpOrigin = launchOrigin === undefined ? origin ?? from : launchOrigin ?? undefined
      let jumpTransition = !walking
      if (walking && caps.canJump) {
        const source = cellAt(from, map)
        source.walk ??= Boolean(getGroundTile(map, from)) || hasSolidVoxelSupport(map, from) || hasSolidStairSupport(map, from)
        source.dig ??= getDigTerrainMultiplier(map, from, caps)
        // Reaching a platform can finish a legal jump. Subsequent supported steps
        // use walking speed, counting the distance already spent on that jump.
        jumpTransition = !source.walk && !source.swimming && source.dig === 0
      }
      if (jumpTransition && canJumpTo(to, jumpOrigin, caps, map)) {
        const horizontal = Math.max(Math.abs(to.x - jumpOrigin!.x), Math.abs(to.z - jumpOrigin!.z))
        const vertical = Math.abs(to.y - jumpOrigin!.y)
        speed = Math.max(speed, vertical > horizontal ? caps.jumpHeight : caps.jumpRange)
      }
      return withinSpeed(speed, spent)
    },
  }
}

/** A jump keeps its launch point until landing; other modes cannot restart it in mid-air. */
export function createJumpTraversal(
  origin: Vec3,
  caps: MovementCapabilities,
  map: GameMap,
  costProfile: NonNullable<ReturnType<typeof getMovementCostProfile>>,
  destroyed: Set<string> = new Set(),
  blocked: (position: Vec3) => boolean = () => false,
): StatefulTraversal<Vec3 | null> {
  const noJump = { ...caps, canJump: false }
  const supported = (pos: Vec3) => canStartJump(pos, map, caps)
  return {
    initial: supported(origin) ? origin : null,
    // When height and length match, total distance already bounds horizontal
    // range. Launches at the same height then have identical continuations.
    key: state => state ? caps.jumpHeight === caps.jumpRange ? String(state.y) : key(state) : '',
    step: (from, to, spent, state) => {
      if (blocked(to)) return null
      // Water, burrowing and climbing end an earlier jump. Only solid footing or
      // the Swimmer quality authorises a new launch from the current cell.
      const launch = supported(from) ? from : state
      const activeCaps = launch ? caps : noJump
      if (!canPassThrough(from, to, activeCaps, map, destroyed, launch ?? from)) return null
      const cost = costProfile.stepCost(from, to, map, spent, launch)
      if (!Number.isFinite(cost)) return null
      const landed = supported(to) || isSwimmingCell(map, to) || getDigTerrainMultiplier(map, to, caps) > 0 || hasClimbSupport(map, to, caps, destroyed)
      return { cost, state: landed ? null : launch }
    },
  }
}

export function hasSolidVoxelSupport(map: GameMap, pos: Vec3): boolean {
  const below = mapVoxelAt(map, { x: pos.x, y: pos.y - 1, z: pos.z })
  return Boolean(below && voxelBlocksMovement(below))
}

function canMoveOntoSupportedVoxelTop(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap, jumpAllowed = caps.canJump): boolean {
  if (!hasSolidVoxelSupport(map, to)) return false
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  if (dy > 0) {
    if (caps.canFly) return true
    if (jumpAllowed && dy <= caps.jumpHeight) return true
    if (dy === 1 && (dx !== 0 || dz !== 0)) return true
    return false
  }
  return true
}

function hasStairAt(map: GameMap, pos: Vec3): boolean {
  const index = getMovementMapIndex(map)
  if (index) return index.stairs.has(key(pos))
  return map.stairs.some(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)
}

export function hasSolidStairSupport(map: GameMap, pos: Vec3): boolean {
  const index = getMovementMapIndex(map)
  if (index) return index.stairs.has(`${pos.x},${pos.y - 1},${pos.z}`)
  return map.stairs.some(s => s.x === pos.x && s.y === pos.y - 1 && s.z === pos.z)
}

function canMoveOntoSupportedStairTop(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap, jumpAllowed = caps.canJump): boolean {
  if (!hasSolidStairSupport(map, to)) return false
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  if (dy > 0) {
    if (caps.canFly) return true
    if (jumpAllowed && dy <= caps.jumpHeight) return true
    if (dy === 1 && (dx !== 0 || dz !== 0)) return true
    return false
  }
  return true
}

// Returns whether a unit with the given capabilities can move from `from` to `to`.
// A search origin bounds airborne jumps across the complete move instead of each local step.
export function canPassThrough(
  from: Vec3,
  to: Vec3,
  caps: MovementCapabilities,
  map: GameMap,
  destroyedStructures: Set<string> = new Set(),
  origin?: Vec3,
): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const jumpAllowed = caps.canJump && (!origin || canStartJump(origin, map, caps))

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

  // Burrowing never skips walls or ceilings, and only the appropriate Digger can enter solids.
  const digMultiplier = getDigTerrainMultiplier(map, to, caps)
  if (digMultiplier > 0) return Number.isFinite(digMultiplier)
  // Actual water requires swimming; its upper surface also permits ordinary flight/jumps.
  if (isWaterCell(map, to)) return caps.canSwim
  if (caps.canSwim && isSwimmingCell(map, to)) return true
  if (hasClimbSupport(map, to, caps, destroyedStructures)) return true

  const groundTile = getGroundTile(map, to)
  const spaceTile = getSpaceTile(map, to)

  if (groundTile) {
    // Water terrain requires a positive swim speed.
    if (groundTile.terrain === 'water' && !caps.canSwim) return false
    // Earth terrain requires digger
    if (groundTile.terrain === 'earth' && !caps.canDig) return false
    if (dy > 0) {
      if (caps.canFly) return true
      if (jumpAllowed && dy <= caps.jumpHeight) return true
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
      if (origin ? canJumpTo(to, origin, caps, map) : caps.canJump && to.y - from.y <= caps.jumpHeight) return true
      return false
    }
    if (to.y < from.y) {
      // Searches keep descending jumps within their horizontal range; omitted origins retain
      // legacy unrestricted descent for displacement/gravity callers.
      return !origin || caps.canFly || canJumpTo(to, origin, caps, map)
    }
    // Moving laterally through air
    if (caps.canFly) return true
    // Can move laterally at same air-level if jumping (horizontal jump)
    if (caps.canJump) return !origin || canJumpTo(to, origin, caps, map)
    return false
  }

  // No tile at destination: allow standing/moving on top of solid voxels or stairs.
  if (canMoveOntoSupportedVoxelTop(from, to, caps, map, jumpAllowed)) return true
  if (canMoveOntoSupportedStairTop(from, to, caps, map, jumpAllowed)) return true
  if (caps.canFly && isWithinMapFootprint(map, to)) return true  // fliers traverse open (unpainted) air
  if ((origin ? canJumpTo(to, origin, caps, map) : caps.canJump && dy <= caps.jumpHeight) && isWithinMapFootprint(map, to)) return true
  return false
}

// Airborne jump landings are measured from the move's origin in both height and horizontal range.
// Descending is unrestricted vertically; omitting the origin keeps the stricter fliers-only rule.
export function canStartJump(origin: Vec3, map: GameMap, caps: MovementCapabilities): boolean {
  if (isSwimmingCell(map, origin)) return caps.canJumpFromWater === true
  if (mapVoxelBlocksMovement(map, origin) || hasStairAt(map, origin)) return false
  return Boolean(getGroundTile(map, origin)) || hasSolidVoxelSupport(map, origin) || hasSolidStairSupport(map, origin)
}

function canJumpTo(pos: Vec3, origin: Vec3 | undefined, caps: MovementCapabilities, map: GameMap): boolean {
  return !!origin && caps.canJump
    && canStartJump(origin, map, caps)
    && (pos.y - origin.y) <= caps.jumpHeight
    && Math.max(Math.abs(pos.x - origin.x), Math.abs(pos.z - origin.z)) <= caps.jumpRange
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
  destroyedStructures: Set<string> = new Set(),
): boolean {
  if (occupiedPositions.has(key(pos))) return false
  const digMultiplier = getDigTerrainMultiplier(map, pos, caps)
  if (digMultiplier > 0) return Number.isFinite(digMultiplier)
  if (isWaterCell(map, pos)) return caps.canSwim
  if (caps.canSwim && isSwimmingCell(map, pos)) return true
  if (hasClimbSupport(map, pos, caps, destroyedStructures)) return true

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
    return caps.canFly || canJumpTo(pos, origin, caps, map)
  }

  // Empty cell directly above a solid voxel or stair is a valid landing surface.
  if (hasSolidVoxelSupport(map, pos)) return true
  if (hasSolidStairSupport(map, pos)) return true

  // Open (unpainted) air — fliers hover/land within the map footprint; jumpers may finish here
  // up to their jump height (they fall to the ground at end of turn, taking no damage).
  if ((caps.canFly || canJumpTo(pos, origin, caps, map)) && isWithinMapFootprint(map, pos)) return true

  return false
}

// Occupied-square exceptions work in both directions and do not depend on faction.
// Tamers use 'medium': Tiny can share with anyone; Small can pass but not share.
export function sizeInteraction(moverSize: DigimonSize, blockerSize: DigimonSize): 'blocked' | 'passable-only' | 'shared' {
  if (moverSize === 'tiny' || blockerSize === 'tiny') return 'shared'
  if (moverSize === 'small' || blockerSize === 'small') return 'passable-only'
  return 'blocked'
}

export interface OccupyingUnit {
  pos: Vec3
  size: DigimonSize
  giganticDimensions?: FootprintDims | null
}

// Separate passage and landing restrictions over every cell of each unit's body.
export function getMovementOccupancy(moverSize: DigimonSize, units: Iterable<OccupyingUnit>) {
  const blockedPositions = new Set<string>()
  const landingBlockedPositions = new Set<string>()
  for (const unit of units) {
    const interaction = sizeInteraction(moverSize, unit.size)
    if (interaction === 'shared') continue
    const dims = getFootprintDimensions(unit.size, unit.giganticDimensions)
    for (const cell of getFootprintCells(unit.pos, dims)) {
      const k = key(cell)
      landingBlockedPositions.add(k)
      if (interaction === 'blocked') blockedPositions.add(k)
    }
  }
  return { blockedPositions, landingBlockedPositions }
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

// Swimmer uses total Movement; ordinary swimming uses Basic Movement before Speedy bonuses.
export function calculateSwimSpeed(
  qualities: ReadonlyArray<{ id: string; choiceId?: string; ranks?: number }>,
  movement: number,
  ram: number,
  basicMovement = movement,
): number {
  const speed = Math.max(0, movement)
  const hasSwimmer = qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'swimmer')
  const base = hasSwimmer ? speed : Math.floor(Math.max(0, basicMovement) / 2)
  const hasAdvSwimmer = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-swimmer')
  return base + (hasAdvSwimmer ? Math.max(0, ram) : 0)
}

// Jump distances use Basic Movement unless Jumper upgrades them to total Movement. Advanced
// Mobility adds its CPU bonuses even when the form has no Extra Movement: Jumper selection.
export function calculateJumpProfile(
  qualities: ReadonlyArray<{ id: string; choiceId?: string; ranks?: number }>,
  movement: number,
  cpu: number,
  basicMovement = movement,
): { jumpRange: number; jumpHeight: number } {
  const hasJumper = qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'jumper')
  const hasAdvJumper = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
  const base = hasJumper ? Math.max(0, movement) : Math.floor(Math.max(0, basicMovement) / 2)
  const bonus = hasAdvJumper ? Math.max(0, cpu) : 0
  return {
    jumpRange: base + bonus,
    jumpHeight: base + bonus * 5,
  }
}

export function calculateSpecialMovementSpeeds(
  qualities: ReadonlyArray<{ id: string; choiceId?: string; ranks?: number }>,
  movement: number,
  ram: number,
): { digSpeed: number; climbSpeed: number; flySpeed: number } {
  const speed = (choice: string, advancedChoice: string): number => {
    if (!qualities.some(q => q.id === 'extra-movement' && q.choiceId === choice)) return 0
    const advanced = qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === advancedChoice)
    return Math.max(0, movement) + (advanced ? Math.max(0, ram) : 0)
  }
  return {
    digSpeed: speed('digger', 'adv-digger'),
    climbSpeed: speed('wallclimber', 'adv-wallclimber'),
    flySpeed: speed('flight', 'adv-flight'),
  }
}

// Derives a unit's MovementCapabilities from its qualities + derived stats.
export function detectCapabilities(
  qualities: Array<{ id: string; choiceId?: string; ranks?: number }>,
  movement: number,
  ram: number,
  cpu: number,
  swimSpeedOverride?: number,
  basicMovement = movement,
): MovementCapabilities {
  const jump = calculateJumpProfile(qualities, movement, cpu, basicMovement)
  const specialSpeeds = calculateSpecialMovementSpeeds(qualities, movement, ram)
  const swimSpeed = swimSpeedOverride ?? calculateSwimSpeed(qualities, movement, ram, basicMovement)
  return {
    canFly: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'flight'),
    canJump: jump.jumpRange > 0 || jump.jumpHeight > 0,
    canJumpFromWater: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'swimmer'),
    naturewalkElements: getNaturewalkElements(qualities),
    ...jump,
    canClimb: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'wallclimber'),
    canClimbCeilings: qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-wallclimber'),
    canSwim: swimSpeed > 0,
    canDig: qualities.some(q => q.id === 'extra-movement' && q.choiceId === 'digger'),
    canDigHardSurfaces: qualities.some(q => q.id === 'advanced-mobility' && q.choiceId === 'adv-digger'),
    movementSpeed: Math.max(0, movement),
    swimSpeed: Math.max(0, swimSpeed),
    ...specialSpeeds,
  }
}

// True if `pos` has no support (ground tile at it, or a movement-blocking voxel/stair below).
// Extra Movement: Swimmer may also stay suspended within water at the current depth.
// Wind voxels aren't movement-blocking and ground terrain is only normal/water/earth, so wind never
// counts as support.
export function isPositionInAir(pos: Vec3, map: GameMap, waterSupports = false): boolean {
  const ground = getGroundTile(map, pos)
  if (ground && ground.terrain !== 'water') return false
  if (waterSupports && isSwimmingCell(map, pos)) return false
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
export function isFootprintAirborne(anchor: Vec3, dims: FootprintDims, map: GameMap, waterSupports = false): boolean {
  for (let dx = 0; dx < dims.width; dx++)
    for (let dz = 0; dz < dims.depth; dz++)
      if (!isPositionInAir({ x: anchor.x + dx, y: anchor.y, z: anchor.z + dz }, map, waterSupports)) return false
  return true
}

// Lowest Y worth scanning down to when settling a fall — the map's lowest ground/water/voxel/stair (so a
// unit can fall onto a floor below the base level), or the unit's own level if the map has none.
function lowestStructureY(map: GameMap): number {
  let min = Infinity
  for (const t of (map.groundTiles ?? [])) if (t.y < min) min = t.y
  for (const t of (map.spaceTiles ?? [])) if (t.spaceType === 'water' && t.y < min) min = t.y
  for (const v of (map.voxels ?? [])) if (v.y < min) min = v.y
  for (const s of (map.stairs ?? [])) if (s.y < min) min = s.y
  return min === Infinity ? 0 : min
}

// Settle an airborne footprint straight down: rests on the highest support at or below its current Y
// (including floors below the base level). If the whole column below is open (no floor/voxel), the
// unit stays where it is rather than falling into infinite void.
export function settleFootprintY(anchor: Vec3, dims: FootprintDims, map: GameMap, waterSupports = false): number {
  if (!isFootprintAirborne(anchor, dims, map, waterSupports)) return anchor.y
  const minY = lowestStructureY(map)
  for (let y = anchor.y - 1; y >= minY; y--) {
    if (!isFootprintAirborne({ x: anchor.x, y, z: anchor.z }, dims, map, waterSupports)) return y
  }
  return anchor.y
}

// Everything `resolveFall` needs about the faller. Flyers hover and Extra Swimmers float in water;
// airborneByJump units fall without damage. Ordinary jumps land safely within safeJumpHeight;
// Tumbler/adv-jumper adjust longer falls and cpu/ram feed the fall formula.
export interface FallerProfile {
  cpu: number
  ram: number
  hasTumbler: boolean
  hasAdvJumper: boolean
  canFly: boolean
  canClimb?: boolean
  canClimbCeilings?: boolean
  canDig?: boolean
  canDigHardSurfaces?: boolean
  floatsOnWater?: boolean
  destroyedStructures?: Set<string>
  airborneByJump?: boolean
  safeJumpHeight?: number
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
  const digMultiplier = profile.canDig ? getDigTerrainMultiplier(map, startPos, {
    canDig: true, canDigHardSurfaces: profile.canDigHardSurfaces,
  }) : 0
  if (digMultiplier > 0 && Number.isFinite(digMultiplier)) return { landingPos: startPos, fallHeight: 0, damage: 0 }
  if (profile.canFly || hasClimbSupport(map, startPos, {
    canClimb: profile.canClimb ?? false, canClimbCeilings: profile.canClimbCeilings,
  }, profile.destroyedStructures)) return { landingPos: startPos, fallHeight: 0, damage: 0 }
  const landingY = settleFootprintY(startPos, dims, map, profile.floatsOnWater)
  const landingPos = { x: startPos.x, y: landingY, z: startPos.z }
  const fallHeight = startPos.y - landingY
  if (fallHeight <= 0) return { landingPos, fallHeight: 0, damage: 0 }
  const damage = profile.airborneByJump || fallHeight <= Math.max(0, profile.safeJumpHeight ?? 0)
    ? 0
    : computeFallDamage(fallHeight, profile.cpu, profile.hasTumbler, profile.hasAdvJumper, profile.ram)
  return { landingPos, fallHeight, damage }
}
