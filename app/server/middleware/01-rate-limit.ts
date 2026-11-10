import { consumeHttpLimit, enforcePasswordAttemptLimit, getClientIp } from '../utils/securityTransport'

export default defineEventHandler(event => {
  const method = event.node.req.method ?? 'GET'
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]!
  if (!path.startsWith('/api/')) return
  const ip = getClientIp(event)
  const password = path.match(/^\/api\/campaigns\/([^/]+)\/verify-(?:dm-)?password$/)
  if (method === 'POST' && password) {
    enforcePasswordAttemptLimit(event, password[1]!)
    consumeHttpLimit(event, `password-attempt:${ip}`, 30)
  } else if (method === 'POST' && /^\/api\/auth\/(login|register)$/.test(path)) {
    // Login separately limits failed guesses; successful logins do not use that budget.
    consumeHttpLimit(event, `account-auth:${ip}`, 30)
  }
  if (method === 'DELETE' || method === 'POST' && (/^\/api\/(campaigns|tamers|digimon|maps|encounters|evolution-lines)\/?$/.test(path) || path === '/api/auth/register')) {
    consumeHttpLimit(event, `create-delete:${ip}`, 10)
  }
  // A generous first boundary protects work before campaign authentication resolves.
  consumeHttpLimit(event, `api-ip:${ip}`, 3000)
})
