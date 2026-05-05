import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!

  const [existing] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!existing) throw createError({ statusCode: 404, message: 'Map not found' })

  await db.delete(maps).where(eq(maps.id, mapId))
  return { success: true }
})
