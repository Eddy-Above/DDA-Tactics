import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'

export default defineEncounterCommand(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const requestId = getRouterParam(event, 'requestId')
  await authorizeEncounterIntent(event, encounterId, { requestId }, 'requests-delete')

  if (!encounterId || !requestId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID and Request ID are required',
    })
  }

  return serializeIntercedeClaim(encounterId, () => deleteRequest(encounterId, requestId))
})

async function deleteRequest(encounterId: string, requestId: string) {

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${encounterId} not found`,
    })
  }

  let pendingRequests = encounter.pendingRequests

  // Check if request exists
  const requestExists = pendingRequests.some((r: any) => r.id === requestId)
  if (!requestExists) {
    throw createError({
      statusCode: 404,
      message: 'Request not found',
    })
  }

  // Remove request only - keep responses for player attack result modals
  pendingRequests = pendingRequests.filter((r: any) => r.id !== requestId)
  // Don't remove responses - they need to persist so players can see attack outcomes

  // Update encounter
  await db.update(encounters).set({
    pendingRequests,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
}
