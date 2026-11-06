import { db, maps, type Map } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const body = await readBody<Partial<Pick<Map,
    'name' | 'description' | 'dimensions' | 'groundTiles' | 'spaceTiles' | 'voxels' |
    'walls' | 'windows' | 'doors' | 'ceilings' | 'stairs'
  >>>(event)

  const [existing] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!existing) throw createError({ statusCode: 404, message: 'Map not found' })

  const updates: Partial<Map> = { ...body, updatedAt: new Date() }

  await db.update(maps).set(updates).where(eq(maps.id, mapId))

  const [updated] = await db.select().from(maps).where(eq(maps.id, mapId))

  return updated
})
