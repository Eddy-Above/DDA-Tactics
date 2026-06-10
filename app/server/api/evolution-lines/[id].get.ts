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

  const [evolutionLine] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  if (!evolutionLine) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  return evolutionLine
})
