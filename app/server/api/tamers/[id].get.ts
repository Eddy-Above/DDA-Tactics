import { eq } from 'drizzle-orm'
import { db, tamers } from '../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Tamer ID is required',
    })
  }

  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, id))

  if (!tamer) {
    throw createError({
      statusCode: 404,
      message: `Tamer with ID ${id} not found`,
    })
  }

  return tamer
})
