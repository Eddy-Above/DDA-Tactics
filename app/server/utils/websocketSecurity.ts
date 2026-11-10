import { MAX_WS_MESSAGE_BYTES, assertAllowedOrigin, clientIpFromHeaders, headerValue } from './securityTransport'

export interface WebSocketAccess {
  campaignId?: string | null
  userId?: string | null
  isMember: boolean
  isDm: boolean
  principalId: string
  expiresAt?: number
}
type Peer = { request?: { headers?: Headers | Record<string, string | string[] | undefined> }; remoteAddress?: string; close(code: number, reason: string): void; [key: string]: any }
type PeerSession = {
  peer: Peer; ip: string; access: WebSocketAccess; resolve: () => Promise<WebSocketAccess>; onClose: () => void
  active: boolean; timer?: ReturnType<typeof setTimeout>; checking?: Promise<WebSocketAccess | null>; tokens: number; tokenTime: number
}
const sessions = new Map<Peer, PeerSession>()
const connectionCounts = new Map<string, number>()
const REVALIDATE_MS = 60_000

function release(session: PeerSession): void {
  if (!session.active) return
  session.active = false
  if (session.timer) clearTimeout(session.timer)
  sessions.delete(session.peer)
  const remaining = (connectionCounts.get(session.ip) ?? 1) - 1
  if (remaining > 0) connectionCounts.set(session.ip, remaining); else connectionCounts.delete(session.ip)
  session.onClose()
}

export function closeAuthorizedPeer(peer: Peer, code = 1008, reason = 'Campaign access is required'): void {
  const session = sessions.get(peer)
  if (session) release(session)
  peer.close(code, reason)
}

export function releaseAuthorizedPeer(peer: Peer): void {
  const session = sessions.get(peer)
  if (session) release(session)
}

function scheduleRevalidation(session: PeerSession): void {
  if (session.timer) clearTimeout(session.timer)
  const delay = Math.max(1, Math.min(REVALIDATE_MS, (session.access.expiresAt ?? Infinity) - Date.now()))
  session.timer = setTimeout(() => { void revalidateWebSocketPeer(session.peer) }, delay)
  session.timer.unref?.()
}

export async function authorizeWebSocketPeer(peer: Peer, resolve: () => Promise<WebSocketAccess>, onClose: () => void): Promise<WebSocketAccess | null> {
  try { assertAllowedOrigin(headerValue(peer.request?.headers, 'origin')) }
  catch { peer.close(1008, 'Untrusted WebSocket Origin'); return null }
  const ip = clientIpFromHeaders(peer.request?.headers, peer.remoteAddress)
  if ((connectionCounts.get(ip) ?? 0) >= 100) { peer.close(1013, 'Too many connections'); return null }
  connectionCounts.set(ip, (connectionCounts.get(ip) ?? 0) + 1)
  const session: PeerSession = {
    peer, ip, resolve, onClose, active: true, access: { isMember: false, isDm: false, principalId: '' }, tokens: 60, tokenTime: Date.now(),
  }
  sessions.set(peer, session)
  peer._securityCanReceive = () => {
    if (!session.active) return false
    if ((session.access.expiresAt ?? Infinity) <= Date.now()) { closeAuthorizedPeer(peer); return false }
    return session.access.isMember
  }
  return revalidateWebSocketPeer(peer)
}

/** Re-check grants, password rotation and account sessions before each incoming operation and while idle. */
export function revalidateWebSocketPeer(peer: Peer): Promise<WebSocketAccess | null> {
  const session = sessions.get(peer)
  if (!session?.active) return Promise.resolve(null)
  if (session.checking) return session.checking
  session.checking = (async () => {
    try {
      if ((session.access.expiresAt ?? Infinity) <= Date.now()) throw new Error('Expired')
      const access = await session.resolve()
      if (!session.active) return null
      if (!access.isMember || (access.expiresAt ?? Infinity) <= Date.now()) throw new Error('Denied')
      session.access = access
      scheduleRevalidation(session)
      return access
    } catch {
      if (session.active) closeAuthorizedPeer(peer)
      return null
    } finally { session.checking = undefined }
  })()
  return session.checking
}

export function invalidateCampaignPeers(campaignId: string): void {
  for (const session of sessions.values()) if (session.access.campaignId === campaignId) closeAuthorizedPeer(session.peer, 1008, 'Campaign access changed; reconnect after verification')
}

export function invalidateSessionPeers(token: string): void {
  if (!token) return
  for (const session of sessions.values()) {
    const cookie = headerValue(session.peer.request?.headers, 'cookie') ?? ''
    if (cookie.split(';').some(part => part.trim() === `session=${token}`)) closeAuthorizedPeer(session.peer, 1008, 'Session ended')
  }
}

/** Size and token-bucket checks precede decoding/authorization database work. */
export function readWebSocketMessage(peer: Peer, message: { rawData?: unknown; text(): string }): Record<string, unknown> | null {
  const session = sessions.get(peer)
  if (!session?.active) { closeAuthorizedPeer(peer); return null }
  const now = Date.now()
  session.tokens = Math.min(60, session.tokens + Math.max(0, now - session.tokenTime) * 30 / 1000)
  session.tokenTime = now
  if (session.tokens < 1) { closeAuthorizedPeer(peer, 1008, 'WebSocket message rate exceeded'); return null }
  session.tokens--
  const raw = message.rawData
  const length = typeof raw === 'string' ? Buffer.byteLength(raw) : ArrayBuffer.isView(raw) ? raw.byteLength : raw instanceof ArrayBuffer ? raw.byteLength : undefined
  if (length !== undefined && length > MAX_WS_MESSAGE_BYTES) { closeAuthorizedPeer(peer, 1009, 'WebSocket message too large'); return null }
  try {
    const value = message.text()
    if (Buffer.byteLength(value) > MAX_WS_MESSAGE_BYTES) { closeAuthorizedPeer(peer, 1009, 'WebSocket message too large'); return null }
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid message')
    return parsed
  } catch { closeAuthorizedPeer(peer, 1008, 'Invalid WebSocket message'); return null }
}
