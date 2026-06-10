import { db, maps, type Map } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const body = await readBody<Partial<{
    name: string
    description: string
    dimensions: { width: number; depth: number; height: number }
    groundTiles: unknown[]
    spaceTiles: unknown[]
    voxels: unknown[]
    walls: unknown[]
    windows: unknown[]
    doors: unknown[]
    ceilings: unknown[]
    stairs: unknown[]
  }>>(event)

  const [existing] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!existing) throw createError({ statusCode: 404, message: 'Map not found' })

  const updates: Partial<Map> = { ...body, updatedAt: new Date() }

  await db.update(maps).set(updates).where(eq(maps.id, mapId))

  const [updated] = await db.select().from(maps).where(eq(maps.id, mapId))

  return updated
})
