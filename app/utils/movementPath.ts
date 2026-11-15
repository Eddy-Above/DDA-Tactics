import type { GameMap, Vec3 } from '~/types'
import {
  canLandOn, canPassThrough, createJumpTraversal, getFootprintCells, getMovementCostProfile,
  type FootprintDims, type MovementCapabilities,
} from './movementRules'

// Movement uses adjacent king steps, including simultaneous horizontal/vertical changes.
// Raycast cell traversal splits those diagonals into extra axis steps and is not a movement path.
export function straightMovementPath(from: Vec3, to: Vec3): Vec3[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z))
  if (!steps) return [from]
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: Math.round(from.x + (to.x - from.x) * i / steps),
    y: Math.round(from.y + (to.y - from.y) * i / steps),
    z: Math.round(from.z + (to.z - from.z) * i / steps),
  }))
}

export function passMovementCapabilities(caps: MovementCapabilities, movement: number, ram: number): MovementCapabilities {
  const extra = Math.max(0, ram)
  return {
    ...caps, movementSpeed: movement + extra,
    swimSpeed: caps.canSwim ? (caps.swimSpeed ?? 0) + extra : 0,
    digSpeed: caps.canDig ? (caps.digSpeed ?? 0) + extra : 0,
    climbSpeed: caps.canClimb ? (caps.climbSpeed ?? 0) + extra : 0,
    flySpeed: caps.canFly ? (caps.flySpeed ?? 0) + extra : 0,
  }
}

/** Check a complete declared route, preserving the launch state through every jump step. */
export function movementPathError(
  path: Vec3[], caps: MovementCapabilities, budget: number, map: GameMap, dims: FootprintDims,
  blocked: Set<string> = new Set(), occupied: Set<string> = blocked, destroyed: Set<string> = new Set(),
): string | null {
  caps = { ...caps, footprint: dims }
  const origin = path[0], destination = path.at(-1)
  if (!origin || !destination) return 'The movement path is invalid'
  const footprintBlocked = (pos: Vec3) => getFootprintCells(pos, dims).some(cell => blocked.has(`${cell.x},${cell.y},${cell.z}`))
  const costs = getMovementCostProfile(caps, budget, destroyed, origin)
  const jump = costs && caps.canJump ? createJumpTraversal(origin, caps, map, costs, destroyed, footprintBlocked) : null
  let state = jump?.initial ?? null, spent = 0
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i]
    if (Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)) !== 1) return 'Movement paths require adjacent cells'
    const edge = jump?.step(from, to, spent, state)
    if (jump ? !edge : footprintBlocked(to) || !canPassThrough(from, to, caps, map, destroyed, origin)) return 'The movement path is blocked'
    spent += edge?.cost ?? costs?.stepCost(from, to, map, spent) ?? 1
    if (jump) state = edge!.state
    if (!Number.isFinite(spent) || spent > (costs?.budget ?? budget)) return 'The movement exceeds this character’s speed'
  }
  if (getFootprintCells(destination, dims).some(cell => occupied.has(`${cell.x},${cell.y},${cell.z}`))
    || !canLandOn(destination, jump && !state ? { ...caps, canJump: false } : caps, map, occupied, jump ? state ?? undefined : origin, destroyed)) {
    return 'The character cannot finish movement there'
  }
  return null
}
