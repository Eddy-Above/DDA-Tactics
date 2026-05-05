import type { Vec3, GameMap } from '../../types'

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

function canPassThrough(from: Vec3, to: Vec3, caps: MovementCapabilities, map: GameMap): boolean {
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
      const hasStair = map.stairs.some(s => s.x === from.x && s.y === from.y && s.z === from.z)
      if (hasStair) return true
      if (caps.canJump && to.y - from.y <= caps.jumpHeight) return true
      return false
    }
    return caps.canFly || caps.canJump
  }

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
