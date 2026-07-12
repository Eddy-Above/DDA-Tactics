import { eq } from 'drizzle-orm'
import { db, campaigns, tamers, digimon, encounters, evolutionLines, campaignAccessGrants } from '../../db'
import { requireOwnerOrCoOwner } from '../../utils/campaignAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Campaign ID is required',
    })
  }

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Campaign with ID ${id} not found`,
    })
  }

  // Only the owner/co-owner can delete an owned campaign. Ownerless
  // campaigns keep today's fully-open behavior (DM password only).
  if (existing.ownerId) {
    await requireOwnerOrCoOwner(event, id)
  }

  // Delete in child-first order for FK safety
  await db.delete(evolutionLines).where(eq(evolutionLines.campaignId, id))
  await db.delete(digimon).where(eq(digimon.campaignId, id))
  await db.delete(encounters).where(eq(encounters.campaignId, id))
  await db.delete(tamers).where(eq(tamers.campaignId, id))
  await db.delete(campaignAccessGrants).where(eq(campaignAccessGrants.campaignId, id))
  await db.delete(campaigns).where(eq(campaigns.id, id))

  return { success: true, id }
})
