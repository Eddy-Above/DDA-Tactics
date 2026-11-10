import { applyStructureDamaged, broadcast, getRoomSnapshot, joinRoom, leaveRoom, prepareRoomCommit } from '../../../utils/encounterRoom'
import { requireEncounterAccess, securityEventFromHeaders } from '../../../utils/campaignSecurity'
import { loadEncounterMap } from '../../../utils/combatSpatial'
import { serializeIntercedeClaim } from '../../../utils/intercedeClaims'
import { authorizeWebSocketPeer, closeAuthorizedPeer, readWebSocketMessage, releaseAuthorizedPeer, revalidateWebSocketPeer } from '../../../utils/websocketSecurity'
import { db, encounters } from '../../../db'
import { eq } from 'drizzle-orm'
import { withDatabase } from '../../../utils/databaseScope'

export default defineWebSocketHandler({
  async open(peer) {
    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const encounterId = url.pathname.match(/^\/api\/encounters\/([^/]+)\/ws\/?$/)?.[1]
    if (!encounterId) { peer.close(1008, 'Missing encounter'); return }
    const access = await authorizeWebSocketPeer(peer, async () => {
      const result = await requireEncounterAccess(securityEventFromHeaders(peer.request.headers), encounterId)
      return result.access ? { ...result.access, campaignId: result.encounter.campaignId }
        : { isMember: true, isDm: false, principalId: `legacy:${encounterId}` }
    }, () => leaveRoom(encounterId, peer))
    if (!access) return
    ;(peer as any)._encounterId = encounterId
    try {
      await joinRoom(encounterId, peer)
      if (!(peer as any)._securityCanReceive()) { leaveRoom(encounterId, peer); return }
      const snapshot = await getRoomSnapshot(encounterId)
      if (!(peer as any)._securityCanReceive()) { leaveRoom(encounterId, peer); return }
      peer.send(JSON.stringify({ type: 'full-state', encounterId, ...snapshot }))
    } catch { closeAuthorizedPeer(peer, 1011, 'Unable to load encounter') }
  },

  async message(peer, rawMessage) {
    const encounterId: string | undefined = (peer as any)._encounterId
    if (!encounterId) { peer.close(1008, 'Campaign access is required'); return }
    const message = readWebSocketMessage(peer, rawMessage)
    if (!message) return
    // Position commits, doors and map refreshes originate from validated HTTP commands now.
    const allowed = new Set(['type', 'encounterId', 'structureId', 'woundsRemaining', 'version'])
    if (message.type !== 'structure-damaged' || message.encounterId !== encounterId
      || Object.keys(message).some(key => !allowed.has(key))
      || typeof message.structureId !== 'string' || !message.structureId || message.structureId.length > 128
      || !Number.isSafeInteger(message.woundsRemaining) || (message.woundsRemaining as number) < 0) {
      closeAuthorizedPeer(peer, 1008, 'Invalid or server-only WebSocket operation'); return
    }
    const access = await revalidateWebSocketPeer(peer)
    if (!access) return
    if (!access.isDm) { closeAuthorizedPeer(peer, 1008, 'GM access is required'); return }
    try {
      await serializeIntercedeClaim(encounterId, async () => {
        await prepareRoomCommit(encounterId)
        const committed: Array<() => void | Promise<void>> = []
        await db.transaction(async transaction => withDatabase(transaction, async () => {
        await db.select().from(encounters).where(eq(encounters.id, encounterId)).for('update')
        const { encounter } = await requireEncounterAccess(securityEventFromHeaders(peer.request.headers), encounterId, 'dm')
        const map = await loadEncounterMap(encounter.mapId)
        const structure = [...(map?.walls ?? []), ...(map?.windows ?? []), ...(map?.ceilings ?? [])].find(item => item.id === message.structureId)
        if (!structure || !Number.isSafeInteger(structure.woundBoxes) || structure.woundBoxes! < 0
          || (message.woundsRemaining as number) > structure.woundBoxes!) {
          closeAuthorizedPeer(peer, 1008, 'Invalid destructible structure'); return
        }
        const version = await applyStructureDamaged(encounterId, message.structureId as string, message.woundsRemaining as number)
        broadcast(encounterId, { type: 'structure-damaged', encounterId, structureId: message.structureId, woundsRemaining: message.woundsRemaining, version })
        }, committed))
        for (const publish of committed) await publish()
      })
    } catch { closeAuthorizedPeer(peer, 1008, 'Operation is no longer permitted') }
  },

  close(peer) { releaseAuthorizedPeer(peer) },
})
