import type { FootprintDims } from '~/utils/movementRules'
import { getFootprintCells } from '~/utils/movementRules'

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
 * Compute the full set of world-space integer cells covered by an area attack.
 *
 * Every shape enumerates its complete 3D volume (including empty-air cells) so the
 * map can ghost-highlight the whole area, and so coverage accounts for the attacker's
 * footprint as the origin region rather than a single anchor cell.
 *
 * @param shape        Area shape type
 * @param rangeType    'melee' | 'ranged'
 * @param attackerPos  Attacker footprint anchor (min-corner) cell
 * @param dir          3D aim direction (attacker edge → aim point). Ignored for burst/blast.
 * @param bit          Attacker BIT stat
 * @param ram          Attacker RAM stat
 * @param movement     Attacker movement in metres (pass)
 * @param attackerDims Attacker footprint dimensions (full 3D box: width x height x depth)
 * @param blastCenter  Free-aimed sphere centre (blast only)
 */
export function computeAreaCells(
  shape: AreaShape,
  rangeType: 'melee' | 'ranged',
  attackerPos: Vec3,
  dir: Vec3,
  bit: number,
  ram: number,
  movement: number,
  attackerDims: FootprintDims,
  blastCenter?: Vec3,
): Vec3[] {
  switch (shape) {
    case 'burst':
      return computeBurst(rangeType, attackerPos, bit, attackerDims)
    case 'blast':
      return computeBlast(bit, blastCenter)
    case 'close-blast':
      return computeCloseBlast(rangeType, attackerPos, dir, bit, attackerDims)
    case 'cone':
      return computeCone(rangeType, attackerPos, dir, bit, attackerDims)
    case 'line':
      return computeLine(rangeType, attackerPos, dir, bit, attackerDims)
    case 'pass':
      return computePass(attackerPos, dir, movement, ram, attackerDims)
  }
}

/**
 * Snapshot of every parameter used for a single `computeAreaCells` call, captured at
 * confirm-click time so the AoE can be recomputed later (e.g. by `intercede-claim.post.ts`
 * to derive `excludeCells` for a "Throw Ally Out of the Blast" landing-cell search).
 */
export interface AreaShapeData {
  shape: AreaShape
  rangeType: 'melee' | 'ranged'
  attackerPos: Vec3
  dir: Vec3
  bit: number
  ram: number
  movement: number
  attackerDims: FootprintDims
  blastCenter?: Vec3
}

/** Recompute the AoE cells from a stored `AreaShapeData` snapshot. */
export function computeAreaCellsFromData(data: AreaShapeData): Vec3[] {
  return computeAreaCells(
    data.shape,
    data.rangeType,
    data.attackerPos,
    data.dir,
    data.bit,
    data.ram,
    data.movement,
    data.attackerDims,
    data.blastCenter,
  )
}

// --- geometry helpers ---

function dist3d(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function normalize3(d: Vec3): Vec3 | null {
  const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)
  if (len < 1e-6) return null
  return { x: d.x / len, y: d.y / len, z: d.z / len }
}

/** All integer cells whose centre lies within `radius` of `center` (centre may be fractional). */
function sphereCells(center: Vec3, radius: number): Vec3[] {
  const r = Math.ceil(radius + 0.5)
  const cells: Vec3[] = []
  const cx = Math.round(center.x), cy = Math.round(center.y), cz = Math.round(center.z)
  for (let x = cx - r; x <= cx + r; x++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        if (dist3d({ x, y, z }, center) <= radius + 0.5) cells.push({ x, y, z })
      }
    }
  }
  return cells
}

/**
 * The attacker's body centre (vertically centred on its full height) pushed out to the
 * edge facing `dir` (XZ). For a 1x1x1 footprint this is the anchor cell raised to its
 * own centre; for larger footprints it lands on the centre of the leading edge, both
 * horizontally and vertically, so directional shapes emanate from the body, not a corner.
 */
function leadingEdgeOrigin(anchor: Vec3, dims: FootprintDims, dir: Vec3): Vec3 {
  const cx = (Math.max(1, Math.round(dims.width)) - 1) / 2
  const cy = (Math.max(1, Math.round(dims.height)) - 1) / 2
  const cz = (Math.max(1, Math.round(dims.depth)) - 1) / 2
  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z)
  const ux = len > 1e-6 ? dir.x / len : 0
  const uz = len > 1e-6 ? dir.z / len : 0
  return { x: anchor.x + cx + ux * cx, y: anchor.y + cy, z: anchor.z + cz + uz * cz }
}

/** Integer cells within a `totalWidth` x `totalHeight` pillar from `origin` along unit dir `nd`.
 *  Odd sizes are symmetric; even sizes extend one extra cell to the right of `nd` (XZ) and one
 *  extra cell above `nd` in the line's own pitched frame, so the height band stays perpendicular
 *  to the 3D line direction (rotates with pitch). `totalHeight` defaults to `totalWidth`,
 *  giving a square cross-section. */
function lineCells(origin: Vec3, nd: Vec3, length: number, totalWidth: number, totalHeight: number = totalWidth): Vec3[] {
  const halfN = Math.floor((totalWidth - 1) / 2)
  const halfP = totalWidth - 1 - halfN
  const halfUpN = Math.floor((totalHeight - 1) / 2)
  const halfUpP = totalHeight - 1 - halfUpN
  const pLen = Math.sqrt(nd.x * nd.x + nd.z * nd.z)
  const pdx = pLen > 1e-6 ? nd.z / pLen : 0
  const pdz = pLen > 1e-6 ? -nd.x / pLen : 0
  // "Up" perpendicular in the line's own frame: nd x perpDir (unit, since nd is perpendicular to perpDir).
  const vdx = nd.y * pdz
  const vdy = nd.z * pdx - nd.x * pdz
  const vdz = -nd.y * pdx
  const cells: Vec3[] = []
  const r = Math.ceil(length + Math.max(halfP, halfUpP) + 1)
  const ox = Math.round(origin.x), oy = Math.round(origin.y), oz = Math.round(origin.z)
  for (let x = ox - r; x <= ox + r; x++) {
    for (let y = oy - r; y <= oy + r; y++) {
      for (let z = oz - r; z <= oz + r; z++) {
        const px = x - origin.x, py = y - origin.y, pz = z - origin.z
        const along = px * nd.x + py * nd.y + pz * nd.z
        if (along < 0 || along > length + 0.5) continue
        const ex = px - along * nd.x, ez = pz - along * nd.z
        const signedPerp = ex * pdx + ez * pdz
        if (signedPerp < -halfN - 0.5 || signedPerp > halfP + 0.5) continue
        const signedUp = px * vdx + py * vdy + pz * vdz
        if (signedUp < -halfUpN - 0.5 || signedUp > halfUpP + 0.5) continue
        cells.push({ x, y, z })
      }
    }
  }
  return cells
}

// --- shapes ---

function burst(rangeType: 'melee' | 'ranged', bit: number): number {
  return rangeType === 'ranged' ? 1 + bit : 1
}

// [Burst] — omnidirectional sphere from the attacker's whole body (every 3D footprint cell).
function computeBurst(rangeType: 'melee' | 'ranged', attackerPos: Vec3, bit: number, attackerDims: FootprintDims): Vec3[] {
  const radius = burst(rangeType, bit)
  const seen = new Set<string>()
  const out: Vec3[] = []
  for (const origin of getFootprintCells(attackerPos, attackerDims)) {
    for (const c of sphereCells(origin, radius)) {
      const k = `${c.x},${c.y},${c.z}`
      if (!seen.has(k)) { seen.add(k); out.push(c) }
    }
  }
  return out
}

// [Blast] — sphere centred on the free-aimed `blastCenter`, diameter 3 + BIT.
function computeBlast(bit: number, blastCenter?: Vec3): Vec3[] {
  if (!blastCenter) return []
  const radius = Math.ceil((3 + bit) / 2)
  return sphereCells(blastCenter, radius)
}

// [Close Blast] — sphere of radius 2 (melee) / 2 + BIT (ranged), placed adjacent to the
// attacker's leading edge in the aim direction.
function computeCloseBlast(rangeType: 'melee' | 'ranged', attackerPos: Vec3, dir: Vec3, bit: number, attackerDims: FootprintDims): Vec3[] {
  const radius = rangeType === 'ranged' ? 2 + bit : 2
  const nd = normalize3(dir)
  if (!nd) return []
  const origin = leadingEdgeOrigin(attackerPos, attackerDims, dir)
  const center: Vec3 = {
    x: origin.x + nd.x * (radius + 1),
    y: origin.y + nd.y * (radius + 1),
    z: origin.z + nd.z * (radius + 1),
  }
  return sphereCells(center, radius)
}

// [Cone] — 90° arc (45° half-angle) up to (3 / 3 + BIT) from the leading edge in `dir`.
function computeCone(rangeType: 'melee' | 'ranged', attackerPos: Vec3, dir: Vec3, bit: number, attackerDims: FootprintDims): Vec3[] {
  const length = rangeType === 'ranged' ? 3 + bit : 3
  const nd = normalize3(dir)
  if (!nd) return []
  const apex = leadingEdgeOrigin(attackerPos, attackerDims, dir)
  const cosHalf = Math.cos(Math.PI / 4)
  const r = Math.ceil(length + 1)
  const ax = Math.round(apex.x), ay = Math.round(apex.y), az = Math.round(apex.z)
  const cells: Vec3[] = []
  for (let x = ax - r; x <= ax + r; x++) {
    for (let y = ay - r; y <= ay + r; y++) {
      for (let z = az - r; z <= az + r; z++) {
        const dx = x - apex.x, dy = y - apex.y, dz = z - apex.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < 0.01 || d > length + 0.5) continue
        const dot = (dx * nd.x + dy * nd.y + dz * nd.z) / d
        if (dot >= cosHalf) cells.push({ x, y, z })
      }
    }
  }
  return cells
}

// [Line] — pillar from the leading edge along `dir`, length 5 / 5 + 2*BIT, square cross-section
// (width == height = 1 + size classes above Large). Scroll-wheel pitch raises/lowers the
// endpoint and the cross-section tilts with it.
function computeLine(rangeType: 'melee' | 'ranged', attackerPos: Vec3, dir: Vec3, bit: number, attackerDims: FootprintDims): Vec3[] {
  const length = rangeType === 'ranged' ? 5 + bit * 2 : 5
  const nd = normalize3(dir)
  if (!nd) return []
  const origin = leadingEdgeOrigin(attackerPos, attackerDims, dir)
  return lineCells(origin, nd, length, Math.max(1, attackerDims.width - 1))
}

// [Pass] — directional 3D beam from the leading edge along `dir`, length movement + RAM,
// cross-section sized to the attacker's own body (width x height). Scroll-wheel pitch
// raises/lowers the endpoint and the beam tilts with it.
function computePass(attackerPos: Vec3, dir: Vec3, movement: number, ram: number, attackerDims: FootprintDims): Vec3[] {
  const length = movement + ram
  const nd = normalize3(dir)
  if (!nd) return []
  const origin = leadingEdgeOrigin(attackerPos, attackerDims, dir)
  return lineCells(origin, nd, length, attackerDims.width, attackerDims.height)
}
