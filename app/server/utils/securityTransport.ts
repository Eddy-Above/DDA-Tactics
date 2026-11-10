import { isIP } from 'node:net'
import { createError, getRequestHeader, setResponseHeader, type H3Event } from 'h3'

export const MAX_WS_MESSAGE_BYTES = 64 * 1024
const WINDOW_MS = 60_000
type HeadersLike = Headers | Record<string, string | string[] | undefined>
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
let nextSweep = 0

export function headerValue(headers: HeadersLike | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  return Array.isArray(value) ? value.join(',') : value
}

/** Forwarded headers are trusted only after the operator verifies Railway's HTTP ingress. */
export function clientIpFromHeaders(headers: HeadersLike | undefined, remoteAddress?: string): string {
  const railway = headerValue(headers, 'x-real-ip')?.trim()
  if (process.env.CLIENT_IP_SOURCE === 'railway' && railway && isIP(railway)) return railway
  return remoteAddress || 'unknown'
}

export function getClientIp(event: H3Event): string {
  return clientIpFromHeaders(event.node.req.headers, event.node.req.socket?.remoteAddress)
}

/** Reject an unusable production deployment before accepting requests. */
export function validateSecurityConfiguration(): void {
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (process.env.NODE_ENV === 'production' && !configured.length) throw new Error('APP_ALLOWED_ORIGINS must explicitly list the application origins in production')
  for (const origin of configured) {
    let url: URL
    try { url = new URL(origin) } catch { throw new Error('APP_ALLOWED_ORIGINS contains an invalid origin') }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('APP_ALLOWED_ORIGINS must contain exact HTTP or HTTPS origins without paths')
  }
}

export function assertAllowedOrigin(origin: string | null | undefined): void {
  let parsed: URL
  try { parsed = new URL(origin ?? '') } catch { throw createError({ statusCode: 403, message: 'A trusted request Origin is required' }) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw createError({ statusCode: 403, message: 'Untrusted request Origin' })
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  const development = process.env.NODE_ENV !== 'production' && !configured.length && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (!configured.includes(parsed.origin) && !development) throw createError({ statusCode: 403, message: 'Untrusted request Origin' })
}

export function assertUnsafeRequestOrigin(event: H3Event): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.node.req.method ?? 'GET')) return
  assertAllowedOrigin(getRequestHeader(event, 'origin'))
}

function bucketFor(key: string, now = Date.now()): Bucket {
  if (now >= nextSweep) {
    for (const [name, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(name)
    nextSweep = now + WINDOW_MS
  }
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + WINDOW_MS }; buckets.set(key, bucket) }
  return bucket
}

function limited(event: H3Event, bucket: Bucket): never {
  setResponseHeader(event, 'Retry-After', Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)))
  throw createError({ statusCode: 429, message: 'Rate limit exceeded. Please try again shortly.' })
}

export function consumeHttpLimit(event: H3Event, key: string, limit: number): void {
  const bucket = bucketFor(key)
  if (++bucket.count > limit) limited(event, bucket)
}

export function enforcePasswordAttemptLimit(event: H3Event, campaignId: string): void {
  const ip = getClientIp(event)
  for (const key of [`password-failed:${ip}`, `password-failed:${campaignId}:${ip}`]) {
    const bucket = bucketFor(key)
    if (bucket.count >= 5) limited(event, bucket)
  }
}

/** Failed guesses are scoped to the caller; nobody can lock a whole campaign out. */
export function recordPasswordFailure(event: H3Event, campaignId: string): void {
  const ip = getClientIp(event)
  bucketFor(`password-failed:${ip}`).count++
  bucketFor(`password-failed:${campaignId}:${ip}`).count++
}

export function enforcePrincipalWriteLimit(event: H3Event, principalId: string): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.node.req.method ?? 'GET') || event.context.securityWriteLimited) return
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]!
  const map = /^\/api\/maps\//i.test(path)
  const ip = getClientIp(event)
  const principal = principalId.startsWith('public:') ? `${principalId}:${ip}` : principalId
  consumeHttpLimit(event, `write:${map ? 'map' : 'normal'}:${principal}`, map ? 300 : 120)
  consumeHttpLimit(event, `write-ip:${map ? 'map' : 'normal'}:${ip}`, map ? 1500 : 600)
  event.context.securityWriteLimited = true
}
