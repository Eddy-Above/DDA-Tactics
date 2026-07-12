import type { H3Event } from 'h3'

// In-memory per-IP rate limiting. A single Railway instance keeps this map
// process-local, so no shared store (Redis, etc.) is needed.
interface RateLimitBucket {
  count: number
  resetAt: number
}

interface RateLimitTier {
  key: string
  limit: number
  windowMs: number
  match: (method: string, path: string) => boolean
}

const TIERS: RateLimitTier[] = [
  // Password verification is the most sensitive — keep it tight.
  {
    key: 'password',
    limit: 5,
    windowMs: 60_000,
    match: (method, path) => method === 'POST' && /\/verify-(dm-)?password$/.test(path),
  },
  // Account registration/login — same tier as password verification.
  {
    key: 'auth',
    limit: 5,
    windowMs: 60_000,
    match: (method, path) => method === 'POST' && /^\/api\/auth\/(register|login)$/.test(path),
  },
  // Encounter action writes happen frequently during combat but should still
  // be bounded well above normal usage.
  {
    key: 'encounter-write',
    limit: 30,
    windowMs: 60_000,
    match: (method, path) => (method === 'POST' || method === 'PUT') && path.startsWith('/api/encounters/'),
  },
  // General API reads (polling, page loads).
  {
    key: 'api-general',
    limit: 100,
    windowMs: 60_000,
    match: (method, path) => method === 'GET' && path.startsWith('/api/'),
  },
]

const buckets = new Map<string, RateLimitBucket>()

// Periodically sweep expired buckets so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}, 60_000)

function getClientIp(event: H3Event): string {
  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return event.node.req.socket?.remoteAddress || 'unknown'
}

export default defineEventHandler((event) => {
  const method = event.node.req.method ?? 'GET'
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]

  const tier = TIERS.find((t) => t.match(method, path))
  if (!tier) return

  const ip = getClientIp(event)
  const bucketKey = `${ip}:${tier.key}`
  const now = Date.now()

  let bucket = buckets.get(bucketKey)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + tier.windowMs }
    buckets.set(bucketKey, bucket)
  }

  bucket.count++

  if (bucket.count > tier.limit) {
    setResponseStatus(event, 429)
    setResponseHeader(event, 'Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
    return { error: 'Rate limit exceeded' }
  }
})
