import { eq } from 'drizzle-orm'
import { db, digimon } from '../../db'
import { getSessionUser } from '../../utils/session'

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

  // Hidden sandbox characters are owner-only — 404 (not 403) for anyone
  // else so their existence isn't confirmed by direct link.
  if (found.campaignId === null && found.hidden && found.ownerId) {
    const sessionUser = await getSessionUser(event)
    if (sessionUser?.id !== found.ownerId) {
      throw createError({ statusCode: 404, message: `Digimon with ID ${id} not found` })
    }
  }

  return found
})
