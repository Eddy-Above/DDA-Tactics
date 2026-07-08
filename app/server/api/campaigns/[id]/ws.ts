import { joinRoom, leaveRoom } from '../../../utils/encounterRoom'
import { campaignRoomKey } from '../../../utils/rollLog'

// Campaign-level WS channel (currently: live roll-log pushes). Reuses the
// encounterRoom peer registry under a `campaign:` key; these rooms carry no
// map state, so there is no full-state send and no inbound message handling.
export default defineWebSocketHandler({
  async open(peer) {
    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const parts = url.pathname.split('/')
    const campaignId = parts[parts.indexOf('campaigns') + 1]
    if (!campaignId) { peer.close(1008, 'Missing campaignId'); return }

    ;(peer as any)._campaignId = campaignId
    await joinRoom(campaignRoomKey(campaignId), peer)
  },

  close(peer) {
    const campaignId: string = (peer as any)._campaignId
    if (campaignId) leaveRoom(campaignRoomKey(campaignId), peer)
  },
})
