import { destroySession } from '../../utils/session'
import { getCookie } from 'h3'
import { invalidateSessionPeers } from '../../utils/websocketSecurity'

export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'session')
  await destroySession(event)
  if (token) invalidateSessionPeers(token)
  return { success: true }
})
