import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const body = await readBody<Partial<{
    name: string
    description: string
    dimensions: { width: number; depth: number; height: number }
    groundTiles: unknown[]
    spaceTiles: unknown[]
    walls: unknown[]
    windows: unknown[]
    doors: unknown[]
    ceilings: unknown[]
    stairs: unknown[]
  }>>(event)

  const [existing] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!existing) throw createError({ statusCode: 404, message: 'Map not found' })

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined)        updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.dimensions !== undefined)  updates.dimensions = JSON.stringify(body.dimensions)
  if (body.groundTiles !== undefined) updates.groundTiles = JSON.stringify(body.groundTiles)
  if (body.spaceTiles !== undefined)  updates.spaceTiles = JSON.stringify(body.spaceTiles)
  if (body.walls !== undefined)       updates.walls = JSON.stringify(body.walls)
  if (body.windows !== undefined)     updates.windows = JSON.stringify(body.windows)
  if (body.doors !== undefined)       updates.doors = JSON.stringify(body.doors)
  if (body.ceilings !== undefined)    updates.ceilings = JSON.stringify(body.ceilings)
  if (body.stairs !== undefined)      updates.stairs = JSON.stringify(body.stairs)

  await db.update(maps).set(updates as any).where(eq(maps.id, mapId))

  const [updated] = await db.select().from(maps).where(eq(maps.id, mapId))
  const p = (v: unknown, fb: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? fb) } catch { return fb } }

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    campaignId: updated.campaignId,
    dimensions: p(updated.dimensions, {}),
    groundTiles: p(updated.groundTiles, []),
    spaceTiles: p(updated.spaceTiles, []),
    walls: p(updated.walls, []),
    windows: p(updated.windows, []),
    doors: p(updated.doors, []),
    ceilings: p(updated.ceilings, []),
    stairs: p(updated.stairs, []),
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
})
