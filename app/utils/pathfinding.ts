import type { Vec3 } from '~/types'

function key(v: Vec3) { return `${v.x},${v.y},${v.z}` }

function reconstructPath(goalKey: string, cameFrom: Map<string, string>): Vec3[] {
  const path: Vec3[] = []
  let current: string | undefined = goalKey
  while (current) {
    const [x, y, z] = current.split(',').map(Number)
    path.push({ x, y, z })
    current = cameFrom.get(current)
  }
  return path.reverse()
}

// Chebyshev distance (3D "king's move")
export function chebyshev(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

// All 26 neighbours in a 3D grid
function neighbours(v: Vec3): Vec3[] {
  const result: Vec3[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        result.push({ x: v.x + dx, y: v.y + dy, z: v.z + dz })
      }
    }
  }
  return result
}

// A* pathfinding on a 3D grid
// canPass: returns true if the unit can enter the neighbour cell
// Returns path from start to goal (inclusive), or null if unreachable
export function findPath(
  start: Vec3,
  goal: Vec3,
  canPass: (from: Vec3, to: Vec3) => boolean,
  maxSteps = 200,
): Vec3[] | null {
  const startKey = key(start)
  const goalKey = key(goal)
  if (startKey === goalKey) return [start]

  type Node = { pos: Vec3; g: number; f: number; verticalSteps: number }
  const open = new Map<string, Node>([[startKey, { pos: start, g: 0, f: chebyshev(start, goal), verticalSteps: 0 }]])
  const cameFrom = new Map<string, string>()
  const scores = new Map<string, { g: number; verticalSteps: number }>([[startKey, { g: 0, verticalSteps: 0 }]])

  let steps = 0
  while (open.size > 0 && steps++ < maxSteps) {
    // Keep shortest movement cost first; equal-cost routes avoid unnecessary
    // elevation changes that can hide flying/digging previews below the floor.
    let currentKey = ''
    let currentNode: Node | null = null
    for (const [k, n] of open) {
      if (!currentNode || n.f < currentNode.f || (n.f === currentNode.f && n.verticalSteps < currentNode.verticalSteps)) {
        currentKey = k; currentNode = n
      }
    }
    if (!currentNode) break
    if (currentKey === goalKey) {
      return reconstructPath(goalKey, cameFrom)
    }
    open.delete(currentKey)
    for (const nb of neighbours(currentNode.pos)) {
      if (!canPass(currentNode.pos, nb)) continue
      const nbKey = key(nb)
      const tentativeG = currentNode.g + 1
      const verticalSteps = currentNode.verticalSteps + Math.abs(nb.y - currentNode.pos.y)
      const previous = scores.get(nbKey)
      if (!previous || tentativeG < previous.g || (tentativeG === previous.g && verticalSteps < previous.verticalSteps)) {
        cameFrom.set(nbKey, currentKey)
        scores.set(nbKey, { g: tentativeG, verticalSteps })
        open.set(nbKey, { pos: nb, g: tentativeG, f: tentativeG + chebyshev(nb, goal), verticalSteps })
      }
    }
  }
  return null
}

export interface ReachableSearch {
  cells: Set<string>
  pathTo: (goal: Vec3) => Vec3[] | null
}

// Retain the shortest-path tree so movement previews need no second search.
export function searchReachable(
  origin: Vec3,
  budget: number,
  canPass: (from: Vec3, to: Vec3) => boolean,
): ReachableSearch {
  const visited = new Map<string, { cost: number; verticalSteps: number }>([[key(origin), { cost: 0, verticalSteps: 0 }]])
  const cameFrom = new Map<string, string>()
  const queue: Array<{ pos: Vec3; cost: number }> = [{ pos: origin, cost: 0 }]
  for (let head = 0; head < queue.length; head++) {
    const { pos, cost } = queue[head]
    if (cost >= budget) continue
    const verticalSteps = visited.get(key(pos))!.verticalSteps
    for (const nb of neighbours(pos)) {
      const k = key(nb)
      const previous = visited.get(k)
      const nextVerticalSteps = verticalSteps + Math.abs(nb.y - pos.y)
      if (previous && (previous.cost < cost + 1 || (previous.cost === cost + 1 && previous.verticalSteps <= nextVerticalSteps))) continue
      if (!canPass(pos, nb)) continue
      visited.set(k, { cost: cost + 1, verticalSteps: nextVerticalSteps })
      cameFrom.set(k, key(pos))
      // All parents at this depth run before the next depth. Improve an equal-cost
      // predecessor before that cell is processed, without traversing it twice.
      if (!previous) queue.push({ pos: nb, cost: cost + 1 })
    }
  }
  const cells = new Set(visited.keys())
  return {
    cells,
    pathTo: goal => cells.has(key(goal)) ? reconstructPath(key(goal), cameFrom) : null,
  }
}

// Kept for callers that only need the reachable cells.
export function bfsReachable(
  origin: Vec3,
  budget: number,
  canPass: (from: Vec3, to: Vec3) => boolean,
): Set<string> {
  return searchReachable(origin, budget, canPass).cells
}
