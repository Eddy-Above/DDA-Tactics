import { eq } from 'drizzle-orm'
import { db, digimon } from '../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Digimon ID is required',
    })
  }

  const [found] = await db.select().from(digimon).where(eq(digimon.id, id))

  if (!found) {
    throw createError({
      statusCode: 404,
      message: `Digimon with ID ${id} not found`,
    })
  }

  return found
})
