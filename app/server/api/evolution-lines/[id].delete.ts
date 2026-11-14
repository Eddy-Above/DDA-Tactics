import { requireEntityAccess, entityCampaignId } from '../../utils/entitySecurity'
import { notifyCharacterUpdated } from '../../utils/characterUpdates'
import { eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Evolution line ID is required',
    })
  }

  // Check if evolution line exists
  const [existing] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  await requireEntityAccess(event, 'evolution-line', existing, true)
  const scope = await entityCampaignId('evolution-line', existing)

  // Delete evolution line
  await db.delete(evolutionLines).where(eq(evolutionLines.id, id))
  notifyCharacterUpdated(scope, { ownerTamerIds: existing.partnerId ? [existing.partnerId] : [], evolutionLines: true })

  return { success: true, id }
})
