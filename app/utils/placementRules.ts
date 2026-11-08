// Pure rules for putting characters onto the map, shared by EncounterMap (who may be placed or
// dragged, and where a drop is routed) and MapCanvas (surface/footprint validation and the drag
// gesture). Free of Three.js, Vue and server imports so it can be unit-tested directly.
import type { Vec3, DigimonSize } from '~/types'
import { sizeInteraction } from '~/utils/movementRules'

export type EncounterPhase = 'setup' | 'initiative' | 'combat' | 'ended'

/** Setup and initiative are the placement phases: anyone deployed can be (re)placed freely. */
export function isSetupPhase(phase: string | null | undefined): boolean {
  return phase === 'setup' || phase === 'initiative'
}

interface PlacementParticipant { id: string; inReserve?: boolean }

interface PlacementContext {
  participants: PlacementParticipant[]
  positions: Record<string, unknown>
  isDm: boolean
  phase: string | null | undefined
  myParticipantIds?: string[]
}

/**
 * Who the HUD offers for placement (click to arm, or drag a card onto the map).
 * During setup everyone deployed is listed, so a placed unit can be moved again. Once combat is
 * underway only units without a map position are offered: moving a placed one is what GM
 * free-move and the radial Move are for. Reserve units are never offered. A player gets only
 * their own characters; the GM gets everyone.
 */
export function getPlaceableParticipantIds(ctx: PlacementContext): string[] {
  const mine = ctx.myParticipantIds ?? []
  const setup = isSetupPhase(ctx.phase)
  return ctx.participants
    .filter(p => {
      if (p.inReserve) return false
      if (!ctx.isDm && !mine.includes(p.id)) return false
      return setup || !ctx.positions[p.id]
    })
    .map(p => p.id)
}

/**
 * Which tokens already on the map may be dragged to a new cell.
 * - GM: any placed, deployed character during setup/initiative.
 * - Player: only their own, and only during setup/initiative. Dragging mid-combat would sidestep
 *   movement rules and action cost, so mid-combat movement stays on the radial Move.
 */
export function getDraggableParticipantIds(ctx: PlacementContext): string[] {
  if (!isSetupPhase(ctx.phase)) return []
  const mine = ctx.myParticipantIds ?? []
  return ctx.participants
    .filter(p => {
      if (p.inReserve) return false
      if (!ctx.positions[p.id]) return false
      return ctx.isDm || mine.includes(p.id)
    })
    .map(p => p.id)
}

export type DropRoute = 'place' | 'gm-move'

/**
 * How a dropped character is committed. Placing (setup, or any unit with no position yet) and the
 * GM's free-move both write the position and send one `unit-moved`; they differ only in that the
 * GM path also ends an in-progress free-move aim.
 */
export function dropRoute(phase: string | null | undefined, isPlaced: boolean): DropRoute {
  return !isPlaced || isSetupPhase(phase) ? 'place' : 'gm-move'
}

// ── Surface and footprint validation ────────────────────────────────────────

export interface PlacementSurfaceHit {
  /** What the ray hit: a floor tile, open space above a tile, or the top of a voxel. */
  type: 'ground' | 'space' | 'voxel'
  tile?: { y: number; isSpawnPoint?: boolean }
  voxel?: { x: number; y: number; z: number; isSpawnPoint?: boolean }
  /** World-space hit point (only x and z are used). */
  point: { x: number; z: number }
}

/**
 * Players may only drop onto spawn points (the green squares); the GM may drop anywhere. This is
 * the single boundary rule for click placement and for both kinds of drag.
 */
export function surfaceAllowsPlacement(isDm: boolean, hit: PlacementSurfaceHit): boolean {
  if (isDm) return true
  if (hit.type === 'voxel') return !!hit.voxel?.isSpawnPoint
  return !!hit.tile?.isSpawnPoint
}

/** The anchor cell a hit resolves to: on top of a voxel, otherwise the tile under the hit point. */
export function placementCellFromHit(hit: PlacementSurfaceHit): Vec3 {
  if (hit.type === 'voxel' && hit.voxel) return { x: hit.voxel.x, y: hit.voxel.y + 1, z: hit.voxel.z }
  return { x: Math.floor(hit.point.x), y: hit.tile?.y ?? 0, z: Math.floor(hit.point.z) }
}

/** How many cells a unit covers along x (`width`) and z (`depth`) on the floor it stands on. */
export interface PlacementFootprint { width: number; depth: number }

/** Overlap on the XZ plane of two footprints anchored (at their min corner) at `a` and `b`. */
export function footprintsOverlapXZ(a: Vec3, aSize: PlacementFootprint, b: Vec3, bSize: PlacementFootprint): boolean {
  return a.x < b.x + bSize.width && a.x + aSize.width > b.x &&
         a.z < b.z + bSize.depth && a.z + aSize.depth > b.z
}

/**
 * Builds the "may a player stand here?" test from the map's spawn flags. A cell is a spawn cell
 * when a flagged ground tile sits at it (a unit stands on a tile at the tile's own y), or when a
 * flagged voxel sits directly below it (a unit stands on top of a voxel, at its y + 1). This is
 * the same cell the click/drag resolves a hit to, so a hit and a footprint cell agree.
 */
export function makeSpawnCellChecker(
  groundTiles: ReadonlyArray<{ x: number; y: number; z: number; isSpawnPoint?: boolean }>,
  voxels: ReadonlyArray<{ x: number; y: number; z: number; isSpawnPoint?: boolean }>,
): (cell: Vec3) => boolean {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const spawnCells = new Set<string>()
  for (const t of groundTiles) if (t.isSpawnPoint) spawnCells.add(key(t.x, t.y, t.z))
  for (const v of voxels) if (v.isSpawnPoint) spawnCells.add(key(v.x, v.y + 1, v.z))
  return cell => spawnCells.has(key(cell.x, cell.y, cell.z))
}

export interface PlacementOccupant {
  id: string
  size?: DigimonSize
  /** Where it stands; undefined when it is not on the map. */
  position: Vec3 | undefined
  footprint: PlacementFootprint
}

export interface PlacementCheck {
  hit: PlacementSurfaceHit
  isDm: boolean
  /** The unit being placed (it never blocks itself, so a unit can be nudged onto its own old cells). */
  participantId: string
  /** Tamers and callers without a Digimon record use medium. */
  size?: DigimonSize
  footprint: PlacementFootprint
  /** True when a solid voxel stops anything standing on this cell. Asked for every cell of the footprint. */
  isBlocked(cell: Vec3): boolean
  /** True when a player may stand on this cell (see `makeSpawnCellChecker`). Asked for every cell of the footprint, players only. */
  isSpawnCell(cell: Vec3): boolean
  occupants: PlacementOccupant[]
}

export interface PlacementEvaluation {
  cell: Vec3
  footprint: PlacementFootprint
  valid: boolean
}

/**
 * The one decision behind every way of putting a character on the map (click while armed, GM
 * free-move, dragging a token, dropping a HUD card): which cell would the unit land on, and is
 * that allowed? An invalid result still carries its cell so a drag can show where it would have
 * gone.
 *
 * The spawn-area boundary applies to players only, and to the WHOLE footprint: a unit larger than
 * one cell may not hang over a non-spawn cell just because its anchor sits on a spawn one. Solid
 * voxels block everyone. Overlapping units are allowed only when either unit is Tiny.
 */
export function evaluatePlacement(check: PlacementCheck): PlacementEvaluation {
  const cell = placementCellFromHit(check.hit)
  const { footprint } = check
  const refuse = (): PlacementEvaluation => ({ cell, footprint, valid: false })

  if (!surfaceAllowsPlacement(check.isDm, check.hit)) return refuse()
  for (let dx = 0; dx < footprint.width; dx++) {
    for (let dz = 0; dz < footprint.depth; dz++) {
      const covered = { x: cell.x + dx, y: cell.y, z: cell.z + dz }
      if (!check.isDm && !check.isSpawnCell(covered)) return refuse()
      if (check.isBlocked(covered)) return refuse()
    }
  }
  const occupied = check.occupants.some(o =>
    o.id !== check.participantId &&
    sizeInteraction(check.size ?? 'medium', o.size ?? 'medium') !== 'shared' &&
    !!o.position && o.position.y === cell.y &&
    footprintsOverlapXZ(cell, footprint, o.position, o.footprint),
  )
  return occupied ? refuse() : { cell, footprint, valid: true }
}

// ── Drag gesture ────────────────────────────────────────────────────────────

export interface DragRelease<T> {
  subject: T
  /** True once the pointer travelled past the threshold; false means it was a plain click. */
  dragged: boolean
}

/**
 * Tells a click apart from a drag. A press only becomes a drag after the pointer moves
 * `threshold` pixels, so clicking a token still selects it instead of picking it up.
 */
export function createDragTracker<T>(threshold = 4) {
  let subject: T | null = null
  let startX = 0
  let startY = 0
  let dragging = false

  return {
    press(x: number, y: number, pressed: T) {
      subject = pressed
      startX = x
      startY = y
      dragging = false
    },
    /** Feed pointer moves; returns whether the gesture is (now) a drag. */
    move(x: number, y: number): boolean {
      if (subject === null) return false
      if (!dragging && Math.hypot(x - startX, y - startY) >= threshold) dragging = true
      return dragging
    },
    /** Ends the gesture. Null when nothing was pressed. */
    release(): DragRelease<T> | null {
      if (subject === null) return null
      const result = { subject, dragged: dragging }
      subject = null
      dragging = false
      return result
    },
    cancel() {
      subject = null
      dragging = false
    },
    isPressed: () => subject !== null,
    isDragging: () => subject !== null && dragging,
    subject: () => subject,
  }
}
