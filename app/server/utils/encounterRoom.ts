import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'

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
}

const PERSIST_DELAY_MS = 1500

// In-memory authoritative state per encounter, hydrated from the DB on first
// access and kept current via WS messages. The DB row is a debounced
// durability snapshot only — never read back as the live source of truth
// while a room is active.
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
    } catch { /* leave defaults on error */ }
    target.hydrating = null
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
  await db.update(encounters).set({
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))
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

export function broadcast(encounterId: string, message: unknown, exclude?: any): void {
  const room = rooms.get(encounterId)
  if (!room) return
  const raw = JSON.stringify(message)
  for (const peer of room.peers) {
    if (peer !== exclude) {
      try { peer.send(raw) } catch { /* peer disconnected */ }
    }
  }
}

export async function getRoomPositions(encounterId: string): Promise<Record<string, Vec3>> {
  const room = await getOrHydrate(encounterId)
  return { ...room.participantPositions }
}

export async function getRoomDestructibleStates(encounterId: string): Promise<DestructibleState[]> {
  const room = await getOrHydrate(encounterId)
  return room.destructibleStates.map((s) => ({ ...s }))
}

export async function getRoomSnapshot(encounterId: string): Promise<{
  participantPositions: Record<string, Vec3>
  destructibleStates: DestructibleState[]
  version: number
}> {
  const room = await getOrHydrate(encounterId)
  return {
    participantPositions: { ...room.participantPositions },
    destructibleStates: room.destructibleStates.map((s) => ({ ...s })),
    version: room.version,
  }
}

export async function applyUnitMoved(encounterId: string, participantId: string, position: Vec3): Promise<number> {
  const room = await getOrHydrate(encounterId)
  room.participantPositions[participantId] = position
  room.version += 1
  scheduleDebouncedPersist(room)
  return room.version
}

export async function applyPositionPatch(encounterId: string, patch: Record<string, Vec3>): Promise<number> {
  const room = await getOrHydrate(encounterId)
  Object.assign(room.participantPositions, patch)
  room.version += 1
  scheduleDebouncedPersist(room)
  return room.version
}

export async function applyStructureDamaged(encounterId: string, structureId: string, currentWounds: number): Promise<number> {
  const room = await getOrHydrate(encounterId)
  const idx = room.destructibleStates.findIndex((s) => s.structureId === structureId)
  if (idx >= 0) room.destructibleStates[idx] = { structureId, currentWounds }
  else room.destructibleStates.push({ structureId, currentWounds })
  room.version += 1
  scheduleDebouncedPersist(room)
  return room.version
}
