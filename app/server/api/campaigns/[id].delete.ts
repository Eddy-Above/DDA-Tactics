import { eq } from 'drizzle-orm'
import { db, campaigns, tamers, digimon, encounters, evolutionLines } from '../../db'

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

  // Delete in child-first order for FK safety
  await db.delete(evolutionLines).where(eq(evolutionLines.campaignId, id))
  await db.delete(digimon).where(eq(digimon.campaignId, id))
  await db.delete(encounters).where(eq(encounters.campaignId, id))
  await db.delete(tamers).where(eq(tamers.campaignId, id))
  await db.delete(campaigns).where(eq(campaigns.id, id))

  return { success: true, id }
})
