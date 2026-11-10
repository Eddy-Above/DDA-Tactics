import { consumeHttpLimit, enforcePasswordAttemptLimit, getClientIp } from '../utils/securityTransport'

export default defineEventHandler(event => {
  const method = event.node.req.method ?? 'GET'
  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]!.replace(/\/+$/, '')
  if (!/^\/api\//i.test(path)) return
  const ip = getClientIp(event)
  const password = path.match(/^\/api\/campaigns\/([^/]+)\/verify-(?:dm-)?password$/i)
  if (method === 'POST' && password) {
    enforcePasswordAttemptLimit(event, password[1]!)
    consumeHttpLimit(event, `password-attempt:${ip}`, 30)
  } else if (method === 'POST' && /^\/api\/auth\/(login|register)$/i.test(path)) {
    // Login separately limits failed guesses; successful logins do not use that budget.
    consumeHttpLimit(event, `account-auth:${ip}`, 30)
  }
  if (method === 'DELETE' || method === 'POST' && (/^\/api\/(campaigns|tamers|digimon|maps|encounters|evolution-lines)$/i.test(path) || /^\/api\/auth\/register$/i.test(path))) {
    consumeHttpLimit(event, `create-delete:${ip}`, 10)
  }
  // A generous first boundary protects work before campaign authentication resolves.
  consumeHttpLimit(event, `api-ip:${ip}`, 3000)
})
