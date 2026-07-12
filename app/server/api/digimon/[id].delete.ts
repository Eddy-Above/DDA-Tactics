import { eq } from 'drizzle-orm'
import { db, digimon } from '../../db'
import { assertCanModifySandboxCharacter } from '../../utils/ownership'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Digimon ID is required',
    })
  }

  // Check if digimon exists
  const [existing] = await db.select().from(digimon).where(eq(digimon.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Digimon with ID ${id} not found`,
    })
  }

  await assertCanModifySandboxCharacter(event, existing)

  // Delete digimon
  await db.delete(digimon).where(eq(digimon.id, id))

  return { success: true, id }
})
