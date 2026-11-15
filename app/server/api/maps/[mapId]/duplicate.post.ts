import { eq } from 'drizzle-orm'
import { updateMapContentBounds } from '../../../../utils/mapContentBounds'
import { db, maps, type NewMap } from '../../../db'
import { requireEntityAccess } from '../../../utils/entitySecurity'
import { generateId } from '../../../utils/id'
import { getSessionUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const mapId = getRouterParam(event, 'mapId')!
  const [source] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!source) throw createError({ statusCode: 404, message: 'Map not found' })
  await requireEntityAccess(event, 'map', source, true)

  // Legacy endless maps can have zero dimensions. These are metadata, not terrain bounds.
  const dimension = (value: number | undefined) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
  const now = new Date()
  const copy: NewMap = {
    ...source,
    id: generateId(),
    name: `${source.name.slice(0, 993)} (copy)`,
    ownerId: source.campaignId ? null : (await getSessionUser(event))?.id ?? null,
    dimensions: {
      width: dimension(source.dimensions?.width),
      depth: dimension(source.dimensions?.depth),
      height: dimension(source.dimensions?.height),
    },
    contentBounds: updateMapContentBounds(null, source),
    createdAt: now,
    updatedAt: now,
  }

  // A single insert copies every terrain collection and preserves linked wall/door IDs.
  await db.insert(maps).values(copy)
  return copy
})
