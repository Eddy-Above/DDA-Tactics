import { assertUnsafeRequestOrigin } from '../utils/securityTransport'

export default defineEventHandler(event => {
  if ((event.path ?? event.node.req.url ?? '').startsWith('/api/')) assertUnsafeRequestOrigin(event)
})
