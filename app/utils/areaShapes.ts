export type AreaShape = 'blast' | 'burst' | 'close-blast' | 'cone' | 'line' | 'pass'

export interface Vec3 { x: number; y: number; z: number }

/** Returns the area shape type from attack tags, or null if not an area attack. */
export function getAreaShape(tags: string[]): AreaShape | null {
  for (const tag of tags) {
    const slug = tag.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (slug.includes('area-attack-blast') || slug === 'blast') return 'blast'
    if (slug.includes('area-attack-burst') || slug === 'burst') return 'burst'
    if (slug.includes('area-attack-close-blast') || slug === 'close-blast') return 'close-blast'
    if (slug.includes('area-attack-cone') || slug === 'cone') return 'cone'
    if (slug.includes('area-attack-line') || slug === 'line') return 'line'
    if (slug.includes('area-attack-pass') || slug === 'pass') return 'pass'
  }
  return null
}

/**
 * Compute the set of world-space cells covered by an area attack.
 *
 * @param shape         Area shape type
 * @param rangeType     'melee' | 'ranged'
 * @param attackerPos   World position of the attacker
 * @param dirVec        Normalized direction from attacker toward mouse (XZ plane). Ignored for burst.
 * @param bit           Attacker BIT stat
 * @param ram           Attacker RAM stat
 * @param movement      Attacker movement in meters
 * @param sizeAboveLarge Number of size classes above Large (0 = Large or smaller)
 * @param cellSize      Size of one grid cell in world units (typically 1)
 * @param allPositions  All participant/cell positions to test for inclusion
 */
export function computeAreaCells(
  shape: AreaShape,
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  dirVec: { x: number; z: number },
  bit: number,
  ram: number,
  movement: number,
  sizeAboveLarge: number,
  cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  switch (shape) {
    case 'burst':
      return computeBurst(rangeType, attackerPos, bit, cellSize, allPositions)
    case 'blast':
      return computeBlast(attackerPos, dirVec, bit, cellSize, allPositions)
    case 'close-blast':
      return computeCloseBlast(rangeType, attackerPos, dirVec, bit, cellSize, allPositions)
    case 'cone':
      return computeCone(rangeType, attackerPos, dirVec, bit, cellSize, allPositions)
    case 'line':
      return computeLine(rangeType, attackerPos, dirVec, bit, sizeAboveLarge, cellSize, allPositions)
    case 'pass':
      return computePass(attackerPos, movement, ram, cellSize, allPositions)
  }
}

// --- helpers ---

function dist2d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Project world pos onto unit direction, returning signed distance along dir and perpendicular offset. */
function projectOnDir(pos: Vec3, origin: Vec3, dir: { x: number; z: number }): { along: number; perp: number } {
  const dx = pos.x - origin.x
  const dz = pos.z - origin.z
  const along = dx * dir.x + dz * dir.z
  const perp = Math.abs(-dx * dir.z + dz * dir.x)
  return { along, perp }
}

function burst(rangeType: 'melee' | 'ranged', bit: number): number {
  return rangeType === 'ranged' ? 1 + bit : 1
}

function computeBurst(
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  bit: number,
  _cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  const radius = burst(rangeType, bit)
  return allPositions.filter(p => dist2d(p, attackerPos) <= radius + 0.5)
}

function computeBlast(
  attackerPos: Vec3,
  dirVec: { x: number; z: number },
  bit: number,
  _cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  // blast: radius = (3 + bit) / 2, centered on mouse world pos (approximated as attacker + dirVec * radius)
  const radius = (3 + bit) / 2
  const center: Vec3 = {
    x: attackerPos.x + dirVec.x * radius,
    y: attackerPos.y,
    z: attackerPos.z + dirVec.z * radius,
  }
  return allPositions.filter(p => dist2d(p, center) <= radius + 0.5)
}

function computeCloseBlast(
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  dirVec: { x: number; z: number },
  bit: number,
  cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  // radius = 2 (melee) or 2 + bit (ranged)
  // edge of circle touches the adjacent cell toward mouse → center = attacker + dirVec * (radius + cellSize)
  const radius = rangeType === 'ranged' ? 2 + bit : 2
  const center: Vec3 = {
    x: attackerPos.x + dirVec.x * (radius + cellSize),
    y: attackerPos.y,
    z: attackerPos.z + dirVec.z * (radius + cellSize),
  }
  return allPositions.filter(p => dist2d(p, center) <= radius + 0.5)
}

function computeCone(
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  dirVec: { x: number; z: number },
  bit: number,
  _cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  const length = rangeType === 'ranged' ? 3 + bit : 3
  const halfAngle = Math.PI / 4 // 45° → 90° total arc
  return allPositions.filter(p => {
    const d = dist2d(p, attackerPos)
    if (d > length + 0.5) return false
    if (d < 0.01) return false
    const dx = p.x - attackerPos.x
    const dz = p.z - attackerPos.z
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * dirVec.x + dz * dirVec.z) / d)))
    return angle <= halfAngle
  })
}

function computeLine(
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  dirVec: { x: number; z: number },
  bit: number,
  sizeAboveLarge: number,
  _cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  const length = rangeType === 'ranged' ? 5 + bit * 2 : 5
  const halfWidth = (1 + sizeAboveLarge) / 2
  return allPositions.filter(p => {
    const { along, perp } = projectOnDir(p, attackerPos, dirVec)
    return along >= 0 && along <= length + 0.5 && perp <= halfWidth + 0.5
  })
}

function computePass(
  attackerPos: Vec3,
  movement: number,
  ram: number,
  _cellSize: number,
  allPositions: Vec3[],
): Vec3[] {
  const radius = movement + ram
  return allPositions.filter(p => dist2d(p, attackerPos) <= radius + 0.5)
}
