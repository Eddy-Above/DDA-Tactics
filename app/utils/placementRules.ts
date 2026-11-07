// Pure rules for putting characters onto the map, shared by EncounterMap (who may be placed or
// dragged, and where a drop is routed) and MapCanvas (surface/footprint validation and the drag
// gesture). Free of Three.js, Vue and server imports so it can be unit-tested directly.
import type { Vec3 } from '~/types'

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
 * - GM: any placed, deployed character in any phase but `ended` (the same free, no-cost teleport
 *   GM free-move offers).
 * - Player: only their own, and only during setup/initiative. Dragging mid-combat would sidestep
 *   movement rules and action cost, so mid-combat movement stays on the radial Move.
 */
export function getDraggableParticipantIds(ctx: PlacementContext): string[] {
  if (!ctx.phase || ctx.phase === 'ended') return []
  if (!ctx.isDm && !isSetupPhase(ctx.phase)) return []
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

/** Overlap on the XZ plane of two square footprints anchored at `a` and `b` (tile counts per side). */
export function footprintsOverlapXZ(a: Vec3, aCount: number, b: Vec3, bCount: number): boolean {
  return a.x < b.x + bCount && a.x + aCount > b.x &&
         a.z < b.z + bCount && a.z + aCount > b.z
}

export interface PlacementOccupant {
  id: string
  /** Where it stands; undefined when it is not on the map. */
  position: Vec3 | undefined
  /** Footprint side length in tiles. */
  tileCount: number
}

export interface PlacementCheck {
  hit: PlacementSurfaceHit
  isDm: boolean
  /** The unit being placed (it never blocks itself, so a unit can be nudged onto its own old cells). */
  participantId: string
  tileCount: number
  /** True when a solid voxel stops anything standing on this cell. Asked for every cell of the footprint. */
  isBlocked(cell: Vec3): boolean
  occupants: PlacementOccupant[]
}

export interface PlacementEvaluation {
  cell: Vec3
  tileCount: number
  valid: boolean
}

/**
 * The one decision behind every way of putting a character on the map (click while armed, GM
 * free-move, dragging a token, dropping a HUD card): which cell would the unit land on, and is
 * that allowed? An invalid result still carries its cell so a drag can show where it would have
 * gone. The spawn-area boundary applies to players only; solid voxels and other units block
 * everyone, so the GM can't stack tokens or bury one in a wall either.
 */
export function evaluatePlacement(check: PlacementCheck): PlacementEvaluation {
  const cell = placementCellFromHit(check.hit)
  const { tileCount } = check
  const refuse = (): PlacementEvaluation => ({ cell, tileCount, valid: false })

  if (!surfaceAllowsPlacement(check.isDm, check.hit)) return refuse()
  for (let dx = 0; dx < tileCount; dx++) {
    for (let dz = 0; dz < tileCount; dz++) {
      if (check.isBlocked({ x: cell.x + dx, y: cell.y, z: cell.z + dz })) return refuse()
    }
  }
  const occupied = check.occupants.some(o =>
    o.id !== check.participantId &&
    !!o.position && o.position.y === cell.y &&
    footprintsOverlapXZ(cell, tileCount, o.position, o.tileCount),
  )
  return occupied ? refuse() : { cell, tileCount, valid: true }
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
