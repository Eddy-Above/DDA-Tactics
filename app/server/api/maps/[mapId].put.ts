import { MAP_CONTENT_COLLECTIONS, updateMapContentBounds } from '../../../utils/mapContentBounds'
import { db, maps, encounters, type Map } from '../../db'
import { eq } from 'drizzle-orm'
import { requireEntityAccess } from '../../utils/entitySecurity'
import { allowFields, tableWriteBody, finiteNumber } from '../../utils/securityValidation'
import { broadcast } from '../../utils/encounterRoom'
import { recomputeGuidingLightForEncounter } from '../../utils/guidingLight'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const sourceClientId = event.node?.req?.headers ? getRequestHeader(event, 'x-map-client-id')?.slice(0, 100) : undefined
  const body = await readBody<Partial<Pick<Map,
    'name' | 'description' | 'dimensions' | 'groundTiles' | 'spaceTiles' | 'voxels' |
    'walls' | 'windows' | 'doors' | 'ceilings' | 'stairs' | 'hidden'
  >>>(event)

  let notifyIds: string[] = []
  const result = await db.transaction(async tx => {
  // Lock display metadata and live door state without downloading unchanged geometry.
  const [existing] = await tx.select({ contentBounds: maps.contentBounds, id: maps.id, campaignId: maps.campaignId, ownerId: maps.ownerId, hidden: maps.hidden, doors: maps.doors,
    ...(body.doors !== undefined || body.windows !== undefined ? { walls: maps.walls } : {}),
  }).from(maps).where(eq(maps.id, mapId)).for('update')
  if (!existing) throw createError({ statusCode: 404, message: 'Map not found' })
  await requireEntityAccess(event, 'map', existing, true)
  const fields = allowFields(body, ['name', 'description', 'dimensions', 'groundTiles', 'spaceTiles', 'voxels', 'walls', 'windows', 'doors', 'ceilings', 'stairs', 'hidden'])
  if (body.hidden !== undefined && (!existing.ownerId || existing.campaignId)) throw createError({ statusCode: 400, message: 'Only owned workshop maps can be hidden' })
  const updates: Partial<Map> = { ...tableWriteBody(fields, maps, existing), updatedAt: new Date() }
  if (updates.dimensions) for (const [axis, value] of Object.entries(updates.dimensions)) finiteNumber(value, axis, { integer: true, min: 1 })
  for (const collection of ['groundTiles', 'spaceTiles', 'voxels', 'walls', 'ceilings', 'stairs'] as const) {
    if (updates[collection] === undefined) continue
    if (!Array.isArray(updates[collection])) throw createError({ statusCode: 400, message: `${collection} must be an array` })
    for (const cell of updates[collection] as any[]) for (const axis of ['x', 'y', 'z']) {
      if (axis === 'y' && cell[axis] === undefined) continue
      finiteNumber(cell[axis], `${collection}.${axis}`, { integer: true })
    }
  }
  for (const collection of ['windows', 'doors'] as const) {
    if (updates[collection] === undefined) continue
    if (!Array.isArray(updates[collection])) throw createError({ statusCode: 400, message: `${collection} must be an array` })
    const wallIds = new Set((updates.walls ?? existing.walls ?? []).map(wall => wall.id))
    for (const item of updates[collection] as any[]) if (typeof item.id !== 'string' || !wallIds.has(item.wallId)) throw createError({ statusCode: 400, message: 'Invalid linked wall' })
  }
  if (updates.doors) {
    const states = new globalThis.Map(existing.doors.map(door => [door.id, !!door.isOpen] as const))
    updates.doors = updates.doors.map(door => ({ ...door, isOpen: states.get(door.id) ?? false }))
  }
  if (!existing.contentBounds) {
    // One-time initialization for legacy maps, after authorization and under the row lock.
    const [content] = await tx.select({ groundTiles: maps.groundTiles, spaceTiles: maps.spaceTiles,
      voxels: maps.voxels, walls: maps.walls, ceilings: maps.ceilings, stairs: maps.stairs,
    }).from(maps).where(eq(maps.id, mapId))
    updates.contentBounds = updateMapContentBounds(null, { ...content, ...updates })
  } else if (MAP_CONTENT_COLLECTIONS.some(key => updates[key] !== undefined)) {
    updates.contentBounds = updateMapContentBounds(existing.contentBounds, updates)
  }
  const query = tx.update(maps).set(updates).where(eq(maps.id, mapId))
  const [updated] = getQuery(event).return === 'minimal'
    ? await query.returning({ id: maps.id, updatedAt: maps.updatedAt })
    : await query.returning()
  if (!updated) throw createError({ statusCode: 404, message: 'Map not found' })
  notifyIds = (await tx.select({ id: encounters.id }).from(encounters).where(eq(encounters.mapId, mapId))).map(row => row.id)

  return updated
  })
  for (const encounterId of notifyIds) {
    broadcast(encounterId, { type: 'map-edited', encounterId, data: { mapId, tool: 'map', clientId: sourceClientId }, version: Date.now() })
    recomputeGuidingLightForEncounter(encounterId).catch(error => console.error('[map] Terrain benefits refresh failed:', error))
  }
  return result
})
