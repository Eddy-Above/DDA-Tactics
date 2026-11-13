import { db, maps, type NewMap } from '../../db'
import { getSessionUser } from '../../utils/session'
import { generateId } from '../../utils/id'
import { requireCampaignDm } from '../../utils/campaignSecurity'
import { finiteNumber, allowFields, boundedString } from '../../utils/securityValidation'

interface CreateMapBody {
  name: string
  description?: string
  campaignId?: string | null
  dimensions: { width: number; depth: number; height?: number }
  generateGround?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateMapBody>(event)
  allowFields(body, ['name', 'description', 'campaignId', 'dimensions', 'generateGround'])
  boundedString(body.name, 'name', 1000, false)
  if (body.description !== undefined) boundedString(body.description, 'description', 100000)

  if (!body.name || !body.dimensions) {
    throw createError({ statusCode: 400, message: 'Missing required fields: name, dimensions' })
  }

  if (body.campaignId !== undefined && body.campaignId !== null) boundedString(body.campaignId, 'campaignId', 1000, false)
  const id = generateId()
  if (body.campaignId) await requireCampaignDm(event, body.campaignId)
  const sessionUser = body.campaignId ? null : await getSessionUser(event)
  allowFields(body.dimensions, ['width', 'depth', 'height'])
  finiteNumber(body.dimensions.width, 'width', { integer: true, min: 1 })
  finiteNumber(body.dimensions.depth, 'depth', { integer: true, min: 1 })
  if (body.dimensions.height !== undefined) finiteNumber(body.dimensions.height, 'height', { integer: true, min: 1 })
  if (body.generateGround !== undefined && typeof body.generateGround !== 'boolean') throw createError({ statusCode: 400, message: 'generateGround must be a boolean' })
  if (body.generateGround !== false) finiteNumber(body.dimensions.width * body.dimensions.depth, 'floor area', { integer: true, min: 1 })
  const now = new Date()

  const groundTiles: { x: number; y: number; z: number; element: string; terrain: string }[] = []
  for (let x = 0; body.generateGround !== false && x < body.dimensions.width; x++)
    for (let z = 0; z < body.dimensions.depth; z++)
      groundTiles.push({ x, y: 0, z, element: 'void', terrain: 'normal' })

  const newMap: NewMap = {
    id,
    name: body.name,
    description: body.description || '',
    campaignId: body.campaignId || null,
    ownerId: sessionUser?.id ?? null,
    hidden: false,
    dimensions: { height: 10, ...body.dimensions },
    groundTiles,
    spaceTiles: [],
    voxels: [],
    walls: [],
    windows: [],
    doors: [],
    ceilings: [],
    stairs: [],
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(maps).values(newMap)

  return newMap
})
