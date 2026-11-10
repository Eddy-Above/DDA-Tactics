import { requireEntityAccess } from '../../utils/entitySecurity'
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

  // Delete evolution line
  await db.delete(evolutionLines).where(eq(evolutionLines.id, id))

  return { success: true, id }
})
