import { db, maps, type NewMap } from '../../db'
import { generateId } from '../../utils/id'

interface CreateMapBody {
  name: string
  description?: string
  campaignId: string
  dimensions: { width: number; depth: number; height?: number }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateMapBody>(event)

  if (!body.name || !body.campaignId || !body.dimensions) {
    throw createError({ statusCode: 400, message: 'Missing required fields: name, campaignId, dimensions' })
  }

  const id = generateId()
  const now = new Date()

  const groundTiles: { x: number; y: number; z: number; element: string; terrain: string }[] = []
  for (let x = 0; x < body.dimensions.width; x++)
    for (let z = 0; z < body.dimensions.depth; z++)
      groundTiles.push({ x, y: 0, z, element: 'void', terrain: 'normal' })

  const newMap: NewMap = {
    id,
    name: body.name,
    description: body.description || '',
    campaignId: body.campaignId,
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
