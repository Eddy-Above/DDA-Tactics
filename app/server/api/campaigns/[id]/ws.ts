import { joinRoom, leaveRoom } from '../../../utils/encounterRoom'
import { campaignRoomKey } from '../../../utils/rollLog'
import { resolveCampaignAccessFromHeaders } from '../../../utils/campaignSecurity'
import { authorizeWebSocketPeer, closeAuthorizedPeer, readWebSocketMessage, releaseAuthorizedPeer } from '../../../utils/websocketSecurity'

export default defineWebSocketHandler({
  async open(peer) {
    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const campaignId = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/ws\/?$/)?.[1]
    if (!campaignId) { peer.close(1008, 'Missing campaign'); return }
    const roomKey = campaignRoomKey(campaignId)
    const access = await authorizeWebSocketPeer(peer, async () => ({
      ...await resolveCampaignAccessFromHeaders(peer.request.headers, campaignId), campaignId,
    }), () => leaveRoom(roomKey, peer))
    if (!access) return
    try {
      await joinRoom(roomKey, peer)
      if (!(peer as any)._securityCanReceive()) leaveRoom(roomKey, peer)
    }
    catch { closeAuthorizedPeer(peer, 1011, 'Unable to load campaign') }
  },
  message(peer, message) {
    if (readWebSocketMessage(peer, message)) closeAuthorizedPeer(peer, 1008, 'Campaign channel is read-only')
  },
  close(peer) { releaseAuthorizedPeer(peer) },
})
