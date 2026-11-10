import { assertUnsafeRequestOrigin } from '../utils/securityTransport'

export default defineEventHandler(event => {
  assertUnsafeRequestOrigin(event)
})
