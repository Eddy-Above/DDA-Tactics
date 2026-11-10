import { validateSecurityConfiguration } from '../utils/securityTransport'

export default defineNitroPlugin(() => {
  validateSecurityConfiguration()
})
