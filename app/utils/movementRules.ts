import type { GameMap, Vec3, DigimonSize } from '~/types'

export interface MovementCapabilities {
  canFly: boolean
  canJump: boolean
  jumpRange: number     // max jump distance in spaces
  jumpHeight: number    // max jump height in spaces
  canClimb: boolean
  canSwim: boolean
  canDig: boolean
}

function key(v: Vec3) { return `${v.x},${v.y},${v.z}` }

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

  for (const wall of map.walls) {
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
  for (const ceiling of map.ceilings) {
    if (destroyed.has(ceiling.id)) continue
    if (ceiling.x === from.x && ceiling.y === from.y && ceiling.z === from.z) return true
  }
  return false
}

function getGroundTile(map: GameMap, pos: Vec3) {
  return map.groundTiles.find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
}

function getSpaceTile(map: GameMap, pos: Vec3) {
  return map.spaceTiles.find(t => t.x === pos.x && t.y === pos.y && t.z === pos.z) ?? null
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

  // Stair entities block lateral movement through them — they are Y-transition tiles only.
  // You can enter from below (dy>0 step-up) or descend through (dy<0), but not walk through sideways.
  if (dy === 0 && map.stairs.some(s => s.x === to.x && s.y === to.y && s.z === to.z)) return false

  // Stair at the FROM column (any Y level) — checked early so it bypasses ceiling restrictions.
  // Stairs only enable upward movement; horizontal walls are still checked separately.
  const hasStairAt = (x: number, z: number) => map.stairs.some(s => s.x === x && s.z === z)
  if (dy > 0 && hasStairAt(from.x, from.z)) {
    // Stair allows vertical ascent — skip ceiling/wall checks for the climb.
    // Still validate the destination tile exists and terrain is passable.
    const groundTile = getGroundTile(map, to)
    if (groundTile) {
      if (groundTile.terrain === 'water' && !caps.canSwim) return false
      if (groundTile.terrain === 'earth' && !caps.canDig) return false
      return true
    }
    const spaceTile = getSpaceTile(map, to)
    if (spaceTile) {
      if (spaceTile.spaceType === 'water') return caps.canSwim
      if (spaceTile.spaceType === 'earth') return caps.canDig
      return true
    }
    return false
  }

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
        const hasClimbable = map.walls.some(w =>
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

  // No tile at destination — solid/empty space
  if (caps.canDig) return true  // diggers can go through solid cells too
  return false
}

// Can a unit land (end its turn) at `pos`?
export function canLandOn(
  pos: Vec3,
  caps: MovementCapabilities,
  map: GameMap,
  occupiedPositions: Set<string>,  // positions already occupied by units that block
): boolean {
  if (occupiedPositions.has(key(pos))) return false

  // Stair entities are transition points — units pass through them but can't stop on them
  if (map.stairs.some(s => s.x === pos.x && s.y === pos.y && s.z === pos.z)) return false

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
    // Air tile — can land if flying or hovering
    return caps.canFly
  }

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
