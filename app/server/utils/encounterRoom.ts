import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { afterDatabaseCommit, scopedRoomState, stageRoomState } from './databaseScope'

interface Vec3 {
  x: number
  y: number
  z: number
}

interface DestructibleState {
  structureId: string
  currentWounds: number
}

interface RoomState {
  encounterId: string
  participantPositions: Record<string, Vec3>
  destructibleStates: DestructibleState[]
  version: number
  peers: Set<any>
  hydrating: Promise<void> | null
  persistTimer: ReturnType<typeof setTimeout> | null
  persistChain: Promise<void>
}

const PERSIST_DELAY_MS = 1500

// Live room views are hydrated once. Validated commands persist their position
// and structure changes in the command transaction, then update this cache and
// publish to peers after the transaction commits.
const rooms = new Map<string, RoomState>()

async function getOrHydrate(encounterId: string): Promise<RoomState> {
  let room = rooms.get(encounterId)
  if (room) {
    if (room.hydrating) await room.hydrating
    return room
  }

  room = {
    encounterId,
    participantPositions: {},
    destructibleStates: [],
    version: 0,
    peers: new Set(),
    hydrating: null,
    persistTimer: null,
    persistChain: Promise.resolve(),
  }
  rooms.set(encounterId, room)

  const target = room
  target.hydrating = (async () => {
    try {
      const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      if (enc) {
        target.participantPositions = enc.participantPositions ?? {}
        target.destructibleStates = enc.destructibleStates ?? []
      }
    } catch (error) {
      // An unavailable database must not turn stored units into an empty map.
      // Remove only this failed attempt so the next request can hydrate again.
      if (rooms.get(encounterId) === target) rooms.delete(encounterId)
      throw error
    } finally { target.hydrating = null }
  })()

  await target.hydrating
  return room
}

function scheduleDebouncedPersist(room: RoomState) {
  if (room.persistTimer) return
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null
    flushPersist(room.encounterId).catch((e) => console.error('[encounterRoom] Failed to persist room state:', e))
  }, PERSIST_DELAY_MS)
}

export async function flushPersist(encounterId: string): Promise<void> {
  const room = rooms.get(encounterId)
  if (!room) return
  if (room.persistTimer) {
    clearTimeout(room.persistTimer)
    room.persistTimer = null
  }
  const snapshot = {
    participantPositions: { ...room.participantPositions },
    destructibleStates: room.destructibleStates.map(state => ({ ...state })),
    updatedAt: new Date(),
  }
  const write = room.persistChain.catch(() => {}).then(async () => {
    await db.update(encounters).set(snapshot).where(eq(encounters.id, encounterId))
  })
  room.persistChain = write
  await write
}

/** Drain the earlier durability snapshot before an HTTP command persists newer positions. */
export async function prepareRoomCommit(encounterId: string): Promise<void> {
  const room = await getOrHydrate(encounterId)
  if (room.persistTimer) await flushPersist(encounterId)
  else await room.persistChain
}

export async function joinRoom(encounterId: string, peer: any): Promise<RoomState> {
  const room = await getOrHydrate(encounterId)
  room.peers.add(peer)
  return room
}

export function leaveRoom(encounterId: string, peer: any): void {
  const room = rooms.get(encounterId)
  if (!room) return
  room.peers.delete(peer)
  if (room.peers.size === 0) {
    if (room.persistTimer) {
      flushPersist(encounterId).catch((e) => console.error('[encounterRoom] Failed to persist room state:', e))
    }
    rooms.delete(encounterId)
  }
}

export function notifyEncounterUpdated(encounterId: string): void {
  broadcast(encounterId, { type: 'encounter-updated', encounterId })
}

export function broadcast(encounterId: string, message: unknown, exclude?: any): void {
  const raw = JSON.stringify(message)
  if (afterDatabaseCommit(() => broadcastRaw(encounterId, raw, exclude))) return
  broadcastRaw(encounterId, raw, exclude)
}

function broadcastRaw(encounterId: string, raw: string, exclude?: any): void {
  const room = rooms.get(encounterId)
  if (!room) return
  for (const peer of room.peers) {
    if (peer !== exclude && (typeof peer._securityCanReceive !== 'function' || peer._securityCanReceive())) {
      try { peer.send(raw) } catch { /* peer disconnected */ }
    }
  }
}

export async function getRoomPositions(encounterId: string): Promise<Record<string, Vec3>> {
  const staged = scopedRoomState(encounterId)
  if (staged) return { ...staged.participantPositions }
  const room = await getOrHydrate(encounterId)
  return { ...room.participantPositions }
}

export async function getRoomDestructibleStates(encounterId: string): Promise<DestructibleState[]> {
  const staged = scopedRoomState(encounterId)
  if (staged) return staged.destructibleStates.map(state => ({ ...state }))
  const room = await getOrHydrate(encounterId)
  return room.destructibleStates.map((s) => ({ ...s }))
}

export async function getRoomSnapshot(encounterId: string): Promise<{
  participantPositions: Record<string, Vec3>
  destructibleStates: DestructibleState[]
  version: number
}> {
  const staged = scopedRoomState(encounterId)
  if (staged) return { participantPositions: { ...staged.participantPositions }, destructibleStates: staged.destructibleStates.map(state => ({ ...state })), version: staged.version }
  const room = await getOrHydrate(encounterId)
  return {
    participantPositions: { ...room.participantPositions },
    destructibleStates: room.destructibleStates.map((s) => ({ ...s })),
    version: room.version,
  }
}

export async function applyUnitMoved(encounterId: string, participantId: string, position: Vec3): Promise<number> {
  return applyPositionPatch(encounterId, { [participantId]: position })
}

export async function applyPositionPatch(encounterId: string, patch: Record<string, Vec3>): Promise<number> {
  const snapshot = await getRoomSnapshot(encounterId)
  const next = { ...snapshot, participantPositions: { ...snapshot.participantPositions, ...patch }, version: snapshot.version + 1 }
  if (stageRoomState(encounterId, next)) {
    await db.update(encounters).set({ participantPositions: next.participantPositions, updatedAt: new Date() }).where(eq(encounters.id, encounterId))
    afterDatabaseCommit(async () => { await applyPositionPatchLive(encounterId, patch, false) })
    return next.version
  }
  return applyPositionPatchLive(encounterId, patch, true)
}

async function applyPositionPatchLive(encounterId: string, patch: Record<string, Vec3>, persist: boolean): Promise<number> {
  const room = await getOrHydrate(encounterId)
  Object.assign(room.participantPositions, patch)
  room.version += 1
  if (persist) scheduleDebouncedPersist(room)
  return room.version
}

/** The caller has persisted positions with participant resources in the same transaction. */
export async function publishCommittedPositions(encounterId: string, patch: Record<string, Vec3>): Promise<number> {
  const snapshot = await getRoomSnapshot(encounterId)
  const next = { ...snapshot, participantPositions: { ...snapshot.participantPositions, ...patch }, version: snapshot.version + 1 }
  const publish = async () => {
    const version = await applyPositionPatchLive(encounterId, patch, false)
    broadcastRaw(encounterId, JSON.stringify({ type: 'position-patch', encounterId, patch, version }))
  }
  if (stageRoomState(encounterId, next)) { afterDatabaseCommit(publish); return next.version }
  await publish()
  return next.version
}

// Applies a position patch to the room AND broadcasts it to all viewers. The common pairing used by
// every server displacement path (Clash Throw, Knockback/Pull, gravity, intercede reposition).
export async function broadcastPositionPatch(encounterId: string, patch: Record<string, Vec3>): Promise<number> {
  const version = await applyPositionPatch(encounterId, patch)
  broadcast(encounterId, { type: 'position-patch', encounterId, patch, version })
  return version
}

// A structure (wall/ceiling/etc.) is destroyed once its remaining wounds reach 0. Mirrors the
// client's `destroyedIds()` in EncounterMap.vue so server pathing can ignore destroyed structures.
export function getDestroyedStructureIds(destructibleStates: DestructibleState[]): Set<string> {
  return new Set(destructibleStates.filter((s) => s.currentWounds <= 0).map((s) => s.structureId))
}

export async function applyStructureDamaged(encounterId: string, structureId: string, currentWounds: number): Promise<number> {
  const snapshot = await getRoomSnapshot(encounterId)
  const states = snapshot.destructibleStates.filter(state => state.structureId !== structureId)
  states.push({ structureId, currentWounds })
  if (stageRoomState(encounterId, { ...snapshot, destructibleStates: states, version: snapshot.version + 1 })) {
    await db.update(encounters).set({ destructibleStates: states, updatedAt: new Date() }).where(eq(encounters.id, encounterId))
    afterDatabaseCommit(async () => { await applyStructureDamagedLive(encounterId, structureId, currentWounds, false) })
    return snapshot.version + 1
  }
  return applyStructureDamagedLive(encounterId, structureId, currentWounds, true)
}

async function applyStructureDamagedLive(encounterId: string, structureId: string, currentWounds: number, persist: boolean): Promise<number> {
  const room = await getOrHydrate(encounterId)
  const idx = room.destructibleStates.findIndex((s) => s.structureId === structureId)
  if (idx >= 0) room.destructibleStates[idx] = { structureId, currentWounds }
  else room.destructibleStates.push({ structureId, currentWounds })
  room.version += 1
  if (persist) scheduleDebouncedPersist(room)
  return room.version
}
