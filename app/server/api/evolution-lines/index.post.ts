import { db, evolutionLines } from '../../db'
import { generateId } from '../../utils/id'

interface CreateEvolutionLineBody {
  name: string
  description?: string
  chain: Array<{
    stage: 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega'
    species: string
    digimonId: string // Required: must link to library Digimon
    isUnlocked?: boolean
  }>
  partnerId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateEvolutionLineBody>(event)

  if (!body.name || !body.chain || body.chain.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Name and chain are required',
    })
  }

  // Validate all chain entries have digimonId
  if (body.chain.some((entry) => !entry.digimonId)) {
    throw createError({
      statusCode: 400,
      message: 'All chain entries must be linked to a Digimon',
    })
  }

  const id = generateId()
  const now = new Date()

  // Build chain with isUnlocked (first stage unlocked by default, others locked)
  const chain = body.chain.map((entry, index) => ({
    ...entry,
    isUnlocked: index === 0 || (entry.isUnlocked ?? false),
  }))

  const newEvolutionLine = {
    id,
    name: body.name,
    description: body.description || '',
    chain: JSON.stringify(chain), // Explicitly stringify to ensure proper JSON storage
    partnerId: body.partnerId || null,
    currentStageIndex: 0,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(evolutionLines).values(newEvolutionLine)

  // Return with parsed chain
  return {
    ...newEvolutionLine,
    chain, // Return the array, not the stringified version
  }
})
