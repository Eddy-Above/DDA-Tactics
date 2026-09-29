import type { WebSocketMapMessage } from '../../../../types'
import {
  applyStructureDamaged,
  applyUnitMoved,
  broadcast,
  getRoomSnapshot,
  joinRoom,
  leaveRoom,
} from '../../../utils/encounterRoom'
import { recomputeGuidingLightForEncounter } from '../../../utils/guidingLight'

export default defineWebSocketHandler({
  async open(peer) {
    // Extract encounterId from the URL path
    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const parts = url.pathname.split('/')
    const encounterId = parts[parts.indexOf('encounters') + 1]
    if (!encounterId) { peer.close(1008, 'Missing encounterId'); return }

    ;(peer as any)._encounterId = encounterId
    await joinRoom(encounterId, peer)

    // Send current authoritative state to the new peer
    const snapshot = await getRoomSnapshot(encounterId)
    const msg: WebSocketMapMessage = {
      type: 'full-state',
      encounterId,
      participantPositions: snapshot.participantPositions,
      destructibleStates: snapshot.destructibleStates,
      version: snapshot.version,
    }
    peer.send(JSON.stringify(msg))
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
      const version = await applyUnitMoved(encounterId, msg.participantId, msg.position)
      broadcast(encounterId, { ...msg, version }, peer)
      // Live [Guiding Light] aura: recompute who's in radius now that a unit moved. Broadcasts
      // its own 'encounter-state' message (with the fuller updated participants) only if something
      // actually entered or left a radius, so a plain move with no aura change stays a no-op.
      recomputeGuidingLightForEncounter(encounterId).catch((e) => console.error('[ws] Guiding Light recompute failed:', e))
    } else if (msg.type === 'door-toggled') {
      broadcast(encounterId, msg, peer)
    } else if (msg.type === 'element-painted' || msg.type === 'map-edited') {
      broadcast(encounterId, msg, peer)
    } else if (msg.type === 'structure-damaged') {
      const version = await applyStructureDamaged(encounterId, msg.structureId, msg.woundsRemaining)
      broadcast(encounterId, { ...msg, version }, peer)
    }
  },

  close(peer) {
    const encounterId: string = (peer as any)._encounterId
    if (encounterId) leaveRoom(encounterId, peer)
  },
})
