import { entityWrite } from '../../utils/entitySecurity'
import { requireEntityAccess, requireLinkedEntity } from '../../utils/entitySecurity'
import { tableWriteBody } from '../../utils/securityValidation'
import { db, evolutionLines, type NewEvolutionLine } from '../../db'
import { generateId } from '../../utils/id'

interface CreateEvolutionLineBody {
  name: string
  description?: string
  chain: Array<{
    stage: 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'
    species: string
    digimonId: string // Required: must link to library Digimon
    isUnlocked?: boolean
    evolvesFromIndex?: number | null
  }>
  partnerId?: string
  campaignId?: string
}

export default defineEventHandler(async (event) => entityWrite(async () => {
  const body = await readBody<CreateEvolutionLineBody>(event)
  tableWriteBody(body, evolutionLines)

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

  await requireEntityAccess(event, 'evolution-line', body, true)
  await requireLinkedEntity(event, 'tamer', body.partnerId, body.campaignId ?? null)
  for (const entry of body.chain) await requireLinkedEntity(event, 'digimon', entry.digimonId, body.campaignId ?? null)

  const id = generateId()
  const now = new Date()

  // Build chain with isUnlocked (first stage unlocked by default, others locked)
  const chain = body.chain.map((entry, index) => ({
    ...entry,
    isUnlocked: index === 0 || (entry.isUnlocked ?? false),
    evolvesFromIndex: entry.evolvesFromIndex === undefined ? (index === 0 ? null : index - 1) : entry.evolvesFromIndex,
  }))

  const newEvolutionLine: NewEvolutionLine = {
    id,
    name: body.name,
    description: body.description || '',
    chain,
    partnerId: body.partnerId || null,
    campaignId: body.campaignId || null,
    currentStageIndex: 0,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(evolutionLines).values(newEvolutionLine)

  return newEvolutionLine
}))
