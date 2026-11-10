import { MAX_WS_MESSAGE_BYTES } from '../utils/securityTransport'

export default defineNitroPlugin(nitroApp => {
  // Nitro passes this cached h3 options object to crossws' Node adapter.
  const options = nitroApp.h3App.websocket as typeof nitroApp.h3App.websocket & {
    serverOptions?: { maxPayload?: number; perMessageDeflate?: boolean }
  }
  options.serverOptions = { ...options.serverOptions, maxPayload: MAX_WS_MESSAGE_BYTES, perMessageDeflate: false }
})
