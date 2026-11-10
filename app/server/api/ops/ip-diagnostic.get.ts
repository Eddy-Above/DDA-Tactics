import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { clientIpFromHeaders, headerValue } from '../../utils/securityTransport'

export default defineEventHandler(event => {
  const expectedToken = process.env.IP_DIAGNOSTIC_TOKEN
  if (!expectedToken) throw createError({ statusCode: 404, message: 'Not found' })
  const provided = getRequestHeader(event, 'authorization')?.replace(/^Bearer /, '') ?? ''
  if (Buffer.byteLength(provided) !== Buffer.byteLength(expectedToken)
    || !timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken))) throw createError({ statusCode: 403, message: 'Not found' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const headers = event.node.req.headers
  const selected = clientIpFromHeaders(headers, event.node.req.socket?.remoteAddress)
  const expectedIp = getRequestHeader(event, 'x-diagnostic-expect')?.trim()
  return {
    source: process.env.CLIENT_IP_SOURCE === 'railway' ? 'railway' : 'socket',
    realIpMatchesSentinel: headerValue(headers, 'x-real-ip')?.trim() === '203.0.113.8',
    forwardedForContainsSentinel: (headerValue(headers, 'x-forwarded-for') ?? '').split(',').some(value => value.trim() === '203.0.113.7'),
    selectedMatchesSentinel: selected === '203.0.113.7' || selected === '203.0.113.8',
    expectedMatchesSelected: !!expectedIp && !!isIP(expectedIp) && selected === expectedIp,
  }
})
