import { getResponseHeader, removeResponseHeader, setResponseHeader } from 'h3'
import { withWebSocketOrigins } from '../utils/securityCsp'

export default defineNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('beforeResponse', event => {
    const policy = getResponseHeader(event, 'Content-Security-Policy-Report-Only')
      ?? getResponseHeader(event, 'Content-Security-Policy')
    if (typeof policy !== 'string') return
    const enforce = process.env.DDA_CSP_REPORT_ONLY === 'false'
    const name = enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
    removeResponseHeader(event, enforce ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy')
    setResponseHeader(event, name, withWebSocketOrigins(policy, process.env.APP_ALLOWED_ORIGINS ?? ''))
  })
})
