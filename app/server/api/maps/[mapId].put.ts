import { db, maps, type Map } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const body = await readBody<Partial<Pick<Map,
    'name' | 'description' | 'dimensions' | 'groundTiles' | 'spaceTiles' | 'voxels' |
    'walls' | 'windows' | 'doors' | 'ceilings' | 'stairs'
  >>>(event)

  const updates: Partial<Map> = { ...body, updatedAt: new Date() }
  const query = db.update(maps).set(updates).where(eq(maps.id, mapId))
  const [updated] = getQuery(event).return === 'minimal'
    ? await query.returning({ id: maps.id, updatedAt: maps.updatedAt })
    : await query.returning()
  if (!updated) throw createError({ statusCode: 404, message: 'Map not found' })

  return updated
})
