import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../db'
import type { WebSocketMapMessage } from '../../../../types'

// In-memory registry of connected peers per encounter
const rooms = new Map<string, Set<any>>()

function getRoom(encounterId: string): Set<any> {
  if (!rooms.has(encounterId)) rooms.set(encounterId, new Set())
  return rooms.get(encounterId)!
}

function broadcast(encounterId: string, message: unknown, exclude?: any) {
  const room = rooms.get(encounterId)
  if (!room) return
  const raw = JSON.stringify(message)
  for (const peer of room) {
    if (peer !== exclude) {
      try { peer.send(raw) } catch { /* peer disconnected */ }
    }
  }
}

// Periodically send full-state reconciliation every 5 seconds
const reconcileIntervals = new Map<string, ReturnType<typeof setInterval>>()

async function startReconciliation(encounterId: string) {
  if (reconcileIntervals.has(encounterId)) return
  const interval = setInterval(async () => {
    const room = rooms.get(encounterId)
    if (!room || room.size === 0) {
      clearInterval(interval)
      reconcileIntervals.delete(encounterId)
      return
    }
    try {
      const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      if (!enc) return
      const p = (v: any, fb: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb) } catch { return fb } }
      const msg: WebSocketMapMessage = {
        type: 'full-state',
        encounterId,
        participantPositions: p((enc as any).participantPositions, {}),
        destructibleStates: p((enc as any).destructibleStates, []),
      }
      broadcast(encounterId, msg)
    } catch { /* db error, skip */ }
  }, 5000)
  reconcileIntervals.set(encounterId, interval)
}

export default defineWebSocketHandler({
  async open(peer) {
    // Extract encounterId from the URL path
    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const parts = url.pathname.split('/')
    const encounterId = parts[parts.indexOf('encounters') + 1]
    if (!encounterId) { peer.close(1008, 'Missing encounterId'); return }

    ;(peer as any)._encounterId = encounterId
    getRoom(encounterId).add(peer)
    await startReconciliation(encounterId)

    // Send current state to the new peer
    try {
      const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      if (enc) {
        const p = (v: any, fb: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb) } catch { return fb } }
        const msg: WebSocketMapMessage = {
          type: 'full-state',
          encounterId,
          participantPositions: p((enc as any).participantPositions, {}),
          destructibleStates: p((enc as any).destructibleStates, []),
        }
        peer.send(JSON.stringify(msg))
      }
    } catch { /* ignore */ }
  },

  async message(peer, rawMessage) {
    const encounterId: string = (peer as any)._encounterId
    if (!encounterId) return

    let msg: WebSocketMapMessage
    try {
      msg = JSON.parse(rawMessage.text())
    } catch {
      return
    }

    if (msg.type === 'unit-moved') {
      // Persist to DB
      try {
        const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
        if (enc) {
          const p = (v: any, fb: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb) } catch { return fb } }
          const positions = p((enc as any).participantPositions, {})
          positions[msg.participantId] = msg.position
          await db.update(encounters).set({
            participantPositions: JSON.stringify(positions) as any,
            updatedAt: new Date(),
          }).where(eq(encounters.id, encounterId))
        }
      } catch { /* ignore db error */ }
      broadcast(encounterId, msg, peer)
    } else if (msg.type === 'door-toggled') {
      broadcast(encounterId, msg, peer)
    } else if (msg.type === 'element-painted' || msg.type === 'map-edited') {
      broadcast(encounterId, msg, peer)
    } else if (msg.type === 'structure-damaged') {
      // Persist destructible state
      try {
        const [enc] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
        if (enc) {
          const p = (v: any, fb: any) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb) } catch { return fb } }
          const states: Array<{ structureId: string; currentWounds: number }> = p((enc as any).destructibleStates, [])
          const idx = states.findIndex(s => s.structureId === msg.structureId)
          if (idx >= 0) states[idx].currentWounds = msg.woundsRemaining
          else states.push({ structureId: msg.structureId, currentWounds: msg.woundsRemaining })
          await db.update(encounters).set({
            destructibleStates: JSON.stringify(states) as any,
            updatedAt: new Date(),
          }).where(eq(encounters.id, encounterId))
        }
      } catch { /* ignore */ }
      broadcast(encounterId, msg, peer)
    }
  },

  close(peer) {
    const encounterId: string = (peer as any)._encounterId
    if (encounterId) {
      const room = rooms.get(encounterId)
      if (room) {
        room.delete(peer)
        if (room.size === 0) {
          rooms.delete(encounterId)
          const interval = reconcileIntervals.get(encounterId)
          if (interval) { clearInterval(interval); reconcileIntervals.delete(encounterId) }
        }
      }
    }
  },
})
