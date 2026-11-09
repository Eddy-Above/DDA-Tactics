import type { GameMap, Vec3 } from '~/types'
import type { FootprintDims } from '~/utils/movementRules'
import { getFootprintCells } from '~/utils/movementRules'
import { getMapVoxels, getVoxelMaterialId, voxelBlocksMovement, voxelBlocksTargeting } from '~/utils/mapVoxels'

// Rendered map geometry in world units (1 unit = 1 grid cell). MapCanvas builds its meshes from
// these, so line of sight always matches what is drawn.
const WALL_H = 1
const WINDOW_H = 0.6
const DOOR_W = 0.7
export const MAP_GEOMETRY = {
  TILE_H: 0.12,                           // floor slab thickness; units stand on its top
  WALL_H,
  WALL_D: 0.1,                            // wall thickness, centred on the cell face
  WINDOW_H,
  WINDOW_FRAME: (WALL_H - WINDOW_H) / 2,  // window sill / header height
  DOOR_H: WALL_H * 0.9,
  DOOR_W,
  PILLAR_W: (1 - DOOR_W) / 2,             // door jamb width
  CEILING_H: 0.1,
} as const

// Blocking boxes are stored grown by EPS so a line running exactly along the seam between two
// neighbouring boxes (wall segments, voxels, floor tiles) can't slip between them.
const EPS = 1e-4
// World units ignored at each end of a sight line (matches the old raycaster's near/far).
const END_TRIM = 0.1

interface LosBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; stamp: number }

export interface LosIndex {
  boxes: LosBox[]                  // every blocking box (grown by EPS)
  cells: Map<string, LosBox[]>     // "x,y,z" → boxes overlapping that grid cell
}

/**
 * Builds the line-of-sight blockers for a map: floors, ceilings, walls (window panes count as solid,
 * open doorways are clear) and every voxel except non-solid see-through ones (water, air).
 * Destroyed walls/windows/ceilings are skipped. Space tiles and stairs never block.
 */
export function buildLosIndex(map: GameMap, destroyedIds: Set<string> = new Set(), viewer?: { canSeeDarkness?: boolean }): LosIndex {
  const { TILE_H, WALL_H, WALL_D, WINDOW_H, WINDOW_FRAME, DOOR_H, PILLAR_W, CEILING_H } = MAP_GEOMETRY
  const index: LosIndex = { boxes: [], cells: new Map() }

  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const box: LosBox = { x0: x0 - EPS, y0: y0 - EPS, z0: z0 - EPS, x1: x1 + EPS, y1: y1 + EPS, z1: z1 + EPS, stamp: 0 }
    index.boxes.push(box)
    for (let x = Math.floor(box.x0); x < box.x1; x++)
      for (let y = Math.floor(box.y0); y < box.y1; y++)
        for (let z = Math.floor(box.z0); z < box.z1; z++) {
          const key = `${x},${y},${z}`
          const list = index.cells.get(key)
          if (list) list.push(box)
          else index.cells.set(key, [box])
        }
  }

  for (const t of map.groundTiles ?? []) add(t.x, t.y, t.z, t.x + 1, t.y + TILE_H, t.z + 1)
  for (const v of getMapVoxels(map)) {
    if (viewer?.canSeeDarkness && getVoxelMaterialId(v) === 'darkness' && !voxelBlocksMovement(v)) continue
    if (voxelBlocksTargeting(v)) add(v.x, v.y, v.z, v.x + 1, v.y + 1, v.z + 1)
  }
  for (const c of map.ceilings ?? []) {
    if (!destroyedIds.has(c.id)) add(c.x, c.y + 1, c.z, c.x + 1, c.y + 1 + CEILING_H, c.z + 1)
  }

  const windowByWall = new Map((map.windows ?? []).map(w => [w.wallId, w]))
  const doorByWall = new Map((map.doors ?? []).map(d => [d.wallId, d]))
  for (const wall of map.walls ?? []) {
    if (destroyedIds.has(wall.id)) continue
    // A wall part spanning u0..u1 along the wall's length and v0..v1 above its floor.
    const part = (u0: number, u1: number, v0: number, v1: number) => {
      const y0 = wall.y + v0
      const y1 = wall.y + v1
      if (wall.face === 'north' || wall.face === 'south') {
        const pz = wall.z + (wall.face === 'south' ? 1 : 0)
        add(wall.x + u0, y0, pz - WALL_D / 2, wall.x + u1, y1, pz + WALL_D / 2)
      } else {
        const px = wall.x + (wall.face === 'east' ? 1 : 0)
        add(px - WALL_D / 2, y0, wall.z + u0, px + WALL_D / 2, y1, wall.z + u1)
      }
    }
    // Mirrors MapCanvas: a window wall is a sill + header around a glass pane (solid until broken);
    // a door wall is two jambs + a header around the door panel (blocks only while closed).
    const win = windowByWall.get(wall.id)
    const door = doorByWall.get(wall.id)
    if (win) {
      part(0, 1, 0, WINDOW_FRAME)
      part(0, 1, WINDOW_FRAME + WINDOW_H, WALL_H)
      if (!destroyedIds.has(win.id)) part(0, 1, WINDOW_FRAME, WINDOW_FRAME + WINDOW_H)
    } else if (door) {
      part(0, PILLAR_W, 0, WALL_H)
      part(1 - PILLAR_W, 1, 0, WALL_H)
      part(PILLAR_W, 1 - PILLAR_W, DOOR_H, WALL_H)
      if (!door.isOpen) part(PILLAR_W, 1 - PILLAR_W, 0, DOOR_H)
    } else {
      part(0, 1, 0, WALL_H)
    }
  }

  return index
}

/** World point at the centre of a cell's standing volume (fractional cells allowed, e.g. a footprint centre). */
export function losCellPoint(cell: Vec3): Vec3 {
  return { x: cell.x + 0.5, y: cell.y + MAP_GEOMETRY.TILE_H + 0.5, z: cell.z + 0.5 }
}

// Visits, in order, every grid cell the segment p0→p1 passes through (Amanatides–Woo). `visit`
// gets the cell and the parametric t (0..1) where the segment enters it; returning true stops.
function walkCells(p0: Vec3, p1: Vec3, visit: (x: number, y: number, z: number, tEnter: number) => boolean | void) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z
  let x = Math.floor(p0.x), y = Math.floor(p0.y), z = Math.floor(p0.z)
  const ex = Math.floor(p1.x), ey = Math.floor(p1.y), ez = Math.floor(p1.z)
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz)
  const tdx = sx ? Math.abs(1 / dx) : Infinity
  const tdy = sy ? Math.abs(1 / dy) : Infinity
  const tdz = sz ? Math.abs(1 / dz) : Infinity
  let tmx = sx ? ((sx > 0 ? x + 1 : x) - p0.x) / dx : Infinity
  let tmy = sy ? ((sy > 0 ? y + 1 : y) - p0.y) / dy : Infinity
  let tmz = sz ? ((sz > 0 ? z + 1 : z) - p0.z) / dz : Infinity
  let t = 0
  const maxSteps = Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z)
  for (let i = 0; i <= maxSteps; i++) {
    if (visit(x, y, z, t)) return
    if (tmx <= tmy && tmx <= tmz) {
      if (tmx > 1) return
      x += sx; t = tmx; tmx += tdx
    } else if (tmy <= tmz) {
      if (tmy > 1) return
      y += sy; t = tmy; tmy += tdy
    } else {
      if (tmz > 1) return
      z += sz; t = tmz; tmz += tdz
    }
  }
}

// Slab-test interval, kept module-level so the hot per-box test allocates nothing.
let slabLo = 0
let slabHi = 0

// Narrows [slabLo, slabHi] to where o + t·d lies strictly inside (lo, hi); false once it's empty.
function clipSlab(o: number, d: number, lo: number, hi: number): boolean {
  if (d === 0) return o > lo && o < hi
  let ta = (lo - o) / d
  let tb = (hi - o) / d
  if (ta > tb) { const s = ta; ta = tb; tb = s }
  if (ta > slabLo) slabLo = ta
  if (tb < slabHi) slabHi = tb
  return slabLo < slabHi
}

// The first t in (tLo, tHi) where p0 + t·d is inside box b, or null.
function segmentEntersBox(p0: Vec3, dx: number, dy: number, dz: number, b: LosBox, tLo: number, tHi: number): number | null {
  slabLo = tLo
  slabHi = tHi
  if (!clipSlab(p0.x, dx, b.x0, b.x1) || !clipSlab(p0.y, dy, b.y0, b.y1) || !clipSlab(p0.z, dz, b.z0, b.z1)) return null
  return slabLo
}

let stampCounter = 0

// Parametric t (0..1) of the first point on p0→p1 inside a blocking box, or null if the line is
// clear. The END_TRIM at each end is ignored; a line that starts or ends inside a blocker is
// blocked from its trimmed start, so a unit inside a sight-blocking voxel can neither see out nor
// be seen. With `any`, returns as soon as any hit is found (not necessarily the first).
function firstHitT(index: LosIndex, p0: Vec3, p1: Vec3, any: boolean): number | null {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z
  const len = Math.hypot(dx, dy, dz)
  if (len <= 2 * END_TRIM) return null
  const tLo = END_TRIM / len
  const tHi = 1 - END_TRIM / len
  const stamp = ++stampCounter
  let best: number | null = null
  walkCells(p0, p1, (x, y, z, tEnter) => {
    // Boxes are bucketed into every cell they touch, so nothing in a later cell can be hit earlier.
    if (tEnter >= tHi || (best !== null && tEnter > best)) return true
    const boxes = index.cells.get(`${x},${y},${z}`)
    if (!boxes) return
    for (const b of boxes) {
      if (b.stamp === stamp) continue
      b.stamp = stamp
      const t = segmentEntersBox(p0, dx, dy, dz, b, tLo, tHi)
      if (t !== null && (best === null || t < best)) {
        best = t
        if (any) return true
      }
    }
  })
  return best
}

/** True if nothing blocks the line between two cells' centres. */
export function losClear(index: LosIndex, fromCell: Vec3, toCell: Vec3): boolean {
  return firstHitT(index, losCellPoint(fromCell), losCellPoint(toCell), true) === null
}

/** The cell where the line from→to first hits a blocker (the open cell just before it), or `toCell` if clear. */
export function losClip(index: LosIndex, fromCell: Vec3, toCell: Vec3): Vec3 {
  const p0 = losCellPoint(fromCell)
  const p1 = losCellPoint(toCell)
  const t = firstHitT(index, p0, p1, false)
  if (t === null) return toCell
  return {
    x: Math.floor(p0.x + (p1.x - p0.x) * t),
    y: Math.floor(p0.y + (p1.y - p0.y) * t - MAP_GEOMETRY.TILE_H),
    z: Math.floor(p0.z + (p1.z - p0.z) * t),
  }
}

function footprintCentre(anchor: Vec3, dims: FootprintDims): Vec3 {
  return {
    x: anchor.x + (dims.width - 1) / 2,
    y: anchor.y + (dims.height - 1) / 2,
    z: anchor.z + (dims.depth - 1) / 2,
  }
}

/**
 * Whether any part of a target is in view from the attacker: a clear line from the attacker's
 * footprint centre to the target's footprint centre or to any one of its cells.
 */
export function canSeeFootprint(
  index: LosIndex,
  attackerAnchor: Vec3, attackerDims: FootprintDims,
  targetAnchor: Vec3, targetDims: FootprintDims,
): boolean {
  const eye = losCellPoint(footprintCentre(attackerAnchor, attackerDims))
  const clear = (cell: Vec3) => firstHitT(index, eye, losCellPoint(cell), true) === null
  if (clear(footprintCentre(targetAnchor, targetDims))) return true
  if (targetDims.width * targetDims.height * targetDims.depth === 1) return false
  return getFootprintCells(targetAnchor, targetDims).some(clear)
}

/** The grid cells, in order, that the straight line between two cells' centres passes through (one axis step at a time). */
export function segmentCells(fromCell: Vec3, toCell: Vec3): Vec3[] {
  const cells: Vec3[] = []
  walkCells(losCellPoint(fromCell), losCellPoint(toCell), (x, y, z) => { cells.push({ x, y, z }) })
  return cells
}
