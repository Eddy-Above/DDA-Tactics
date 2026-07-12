import { eq } from 'drizzle-orm'
import { db, tamers, digimon, evolutionLines } from '../../db'
import { assertCanModifySandboxCharacter } from '../../utils/ownership'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Tamer ID is required',
    })
  }

  // Check if tamer exists
  const [existing] = await db.select().from(tamers).where(eq(tamers.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Tamer with ID ${id} not found`,
    })
  }

  await assertCanModifySandboxCharacter(event, existing)

  // Delete all digimon associated with this tamer
  await db.delete(digimon).where(eq(digimon.partnerId, id))

  // Delete all evolution lines associated with this tamer
  await db.delete(evolutionLines).where(eq(evolutionLines.partnerId, id))

  // Delete tamer
  await db.delete(tamers).where(eq(tamers.id, id))

  return { success: true, id }
})
