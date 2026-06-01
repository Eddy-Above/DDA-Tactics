import type { Vec3, GameMap } from '../../types'
import { chebyshev } from './gridDistance'

function euclidean(a: Vec3, b: Vec3) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

// All cells within sphere radius centred on origin
function sphereCells(center: Vec3, radius: number): Vec3[] {
  const r = Math.ceil(radius)
  const cells: Vec3[] = []
  for (let x = center.x - r; x <= center.x + r; x++) {
    for (let y = center.y - r; y <= center.y + r; y++) {
      for (let z = center.z - r; z <= center.z + r; z++) {
        if (euclidean({ x, y, z }, center) <= radius) {
          cells.push({ x, y, z })
        }
      }
    }
  }
  return cells
}

// [Blast] — sphere centred on `center`, diameter 3 + BIT (radius = ceil((3+BIT)/2))
export function computeBlastCells(center: Vec3, bit: number): Vec3[] {
  const radius = Math.ceil((3 + bit) / 2)
  return sphereCells(center, radius)
}

// [Burst] — sphere outward from `origin`, radius 1 + BIT + 1, user excluded
export function computeBurstCells(origin: Vec3, bit: number): Vec3[] {
  const radius = 1 + bit + 1
  return sphereCells(origin, radius).filter(c =>
    !(c.x === origin.x && c.y === origin.y && c.z === origin.z)
  )
}

// [Close Blast] — sphere of radius 2 + BIT centred on adjacentCenter (must be adjacent to user)
export function computeCloseBlastCells(adjacentCenter: Vec3, bit: number): Vec3[] {
  const radius = 2 + bit
  return sphereCells(adjacentCenter, radius)
}

// [Cone] — 60° arc of cells up to (3 + BIT) from origin in the given direction
export function computeConeCells(origin: Vec3, direction: Vec3, bit: number): Vec3[] {
  const maxLen = 3 + bit
  const dLen = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2)
  if (dLen < 0.001) return []
  const nd = { x: direction.x / dLen, y: direction.y / dLen, z: direction.z / dLen }

  const cells: Vec3[] = []
  const r = Math.ceil(maxLen)
  for (let x = origin.x - r; x <= origin.x + r; x++) {
    for (let y = origin.y - r; y <= origin.y + r; y++) {
      for (let z = origin.z - r; z <= origin.z + r; z++) {
        const dx = x - origin.x, dy = y - origin.y, dz = z - origin.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < 0.001 || dist > maxLen) continue
        const dot = (dx / dist) * nd.x + (dy / dist) * nd.y + (dz / dist) * nd.z
        // 60° half-angle → cos(30°) ≈ 0.866
        if (dot >= 0.866) cells.push({ x, y, z })
      }
    }
  }
  return cells
}

// [Line] — pillar from adjacent to origin, length 5 + 2*BIT, width 1, bounces off solid walls
export function computeLineCells(origin: Vec3, direction: Vec3, bit: number, sizeAboveLarge: number, map: GameMap): Vec3[] {
  const maxLen = 5 + 2 * bit
  const width = 1 + sizeAboveLarge  // 1 for Large and below
  const dLen = Math.sqrt(direction.x ** 2 + direction.z ** 2)
  if (dLen < 0.001) return []
  const ndx = direction.x / dLen, ndz = direction.z / dLen

  const cells = new Set<string>()
  const addCell = (x: number, y: number, z: number) => cells.add(`${Math.round(x)},${y},${Math.round(z)}`)

  let cx = origin.x + 0.5, cz = origin.z + 0.5
  let vx = ndx, vz = ndz
  let remaining = maxLen

  while (remaining > 0) {
    const nx = Math.floor(cx + vx), nz = Math.floor(cz + vz)
    // Check if wall blocks this cell transition
    const wallBlocksX = map.walls.some(w =>
      w.x === Math.floor(cx) && w.z === Math.floor(cz) &&
      ((vx > 0 && w.face === 'east') || (vx < 0 && w.face === 'west'))
    )
    const wallBlocksZ = map.walls.some(w =>
      w.x === Math.floor(cx) && w.z === Math.floor(cz) &&
      ((vz > 0 && w.face === 'south') || (vz < 0 && w.face === 'north'))
    )
    if (wallBlocksX) vx = -vx
    if (wallBlocksZ) vz = -vz
    cx += vx; cz += vz

    const cell = { x: Math.floor(cx), y: origin.y, z: Math.floor(cz) }
    for (let w = 0; w < width; w++) {
      addCell(cell.x + w * ndz, cell.y, cell.z + w * ndx)
    }
    remaining--
    if (remaining <= 0) break
  }

  return Array.from(cells).map(k => {
    const [x, y, z] = k.split(',').map(Number)
    return { x, y, z }
  })
}

// [Pass] — straight line of cells in direction, up to movement + RAM additional
export function computePassCells(origin: Vec3, direction: Vec3, movement: number, ram: number): Vec3[] {
  const maxLen = movement + ram
  const dLen = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2)
  if (dLen < 0.001) return []
  const nd = { x: Math.round(direction.x / dLen), y: Math.round(direction.y / dLen), z: Math.round(direction.z / dLen) }

  const cells: Vec3[] = []
  for (let i = 1; i <= maxLen; i++) {
    cells.push({ x: origin.x + nd.x * i, y: origin.y + nd.y * i, z: origin.z + nd.z * i })
  }
  return cells
}
