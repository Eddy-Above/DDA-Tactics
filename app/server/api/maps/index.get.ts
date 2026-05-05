import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined

  const rows = campaignId
    ? await db.select().from(maps).where(eq(maps.campaignId, campaignId))
    : await db.select().from(maps)

  return rows.map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    campaignId: m.campaignId,
    dimensions: typeof m.dimensions === 'string' ? JSON.parse(m.dimensions) : m.dimensions,
    groundTiles: typeof m.groundTiles === 'string' ? JSON.parse(m.groundTiles) : (m.groundTiles ?? []),
    spaceTiles: typeof m.spaceTiles === 'string' ? JSON.parse(m.spaceTiles) : (m.spaceTiles ?? []),
    walls: typeof m.walls === 'string' ? JSON.parse(m.walls) : (m.walls ?? []),
    windows: typeof m.windows === 'string' ? JSON.parse(m.windows) : (m.windows ?? []),
    doors: typeof m.doors === 'string' ? JSON.parse(m.doors) : (m.doors ?? []),
    ceilings: typeof m.ceilings === 'string' ? JSON.parse(m.ceilings) : (m.ceilings ?? []),
    stairs: typeof m.stairs === 'string' ? JSON.parse(m.stairs) : (m.stairs ?? []),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }))
})
