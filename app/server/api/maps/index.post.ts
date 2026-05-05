import { db, maps } from '../../db'
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

  await db.insert(maps).values({
    id,
    name: body.name,
    description: body.description || '',
    campaignId: body.campaignId,
    dimensions: JSON.stringify(body.dimensions) as any,
    groundTiles: JSON.stringify(groundTiles) as any,
    spaceTiles: JSON.stringify([]) as any,
    walls: JSON.stringify([]) as any,
    windows: JSON.stringify([]) as any,
    doors: JSON.stringify([]) as any,
    ceilings: JSON.stringify([]) as any,
    stairs: JSON.stringify([]) as any,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id,
    name: body.name,
    description: body.description || '',
    campaignId: body.campaignId,
    dimensions: body.dimensions,
    groundTiles,
    spaceTiles: [],
    walls: [],
    windows: [],
    doors: [],
    ceilings: [],
    stairs: [],
    createdAt: now,
    updatedAt: now,
  }
})
