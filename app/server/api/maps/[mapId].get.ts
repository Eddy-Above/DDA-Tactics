import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!

  const [map] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!map) throw createError({ statusCode: 404, message: 'Map not found' })

  return map
})
