import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

const parseJson = (v: unknown, fallback: unknown) => {
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return fallback } }
  return v ?? fallback
}

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!

  const [map] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!map) throw createError({ statusCode: 404, message: 'Map not found' })

  return {
    id: map.id,
    name: map.name,
    description: map.description,
    campaignId: map.campaignId,
    dimensions: parseJson(map.dimensions, { width: 20, depth: 20, height: 10 }),
    groundTiles: parseJson(map.groundTiles, []),
    spaceTiles: parseJson(map.spaceTiles, []),
    walls: parseJson(map.walls, []),
    windows: parseJson(map.windows, []),
    doors: parseJson(map.doors, []),
    ceilings: parseJson(map.ceilings, []),
    stairs: parseJson(map.stairs, []),
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  }
})
