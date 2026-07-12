import { eq } from 'drizzle-orm'
import { db, tamers } from '../../db'
import { getSessionUser } from '../../utils/session'

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

  // Hidden sandbox characters are owner-only — 404 (not 403) for anyone
  // else so their existence isn't confirmed by direct link.
  if (tamer.campaignId === null && tamer.hidden && tamer.ownerId) {
    const sessionUser = await getSessionUser(event)
    if (sessionUser?.id !== tamer.ownerId) {
      throw createError({ statusCode: 404, message: `Tamer with ID ${id} not found` })
    }
  }

  return tamer
})
