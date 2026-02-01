import { eq, inArray } from 'drizzle-orm'
import { db, digimon, type NewDigimon } from '../../db'
import { generateId } from '../../utils/id'
import { parseDigimonData } from '../../utils/parsers'
import {
  type DigimonStage,
  type DigimonAttribute,
  type DigimonSize,
  STAGE_CONFIG,
} from '../../../types'

interface CreateDigimonBody {
  name: string
  species: string
  stage: DigimonStage
  attribute: DigimonAttribute
  family: string
  type?: string
  size?: DigimonSize
  baseStats: {
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }
  bonusStats?: {
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }
  attacks?: Array<{
    id: string
    name: string
    range: 'melee' | 'ranged'
    type: 'damage' | 'support'
    tags: string[]
    effect?: string
    description: string
  }>
  qualities?: Array<{
    id: string
    name: string
    type: 'static' | 'trigger' | 'attack' | Array<'static' | 'trigger' | 'attack'>
    dpCost: number
    description: string
    effect: string
    ranks?: number
    choiceId?: string
    choiceName?: string
  }>
  dataOptimization?: string
  bonusDP?: number
  bonusDPForQualities?: number
  partnerId?: string
  isEnemy?: boolean
  notes?: string
  spriteUrl?: string
  evolvesFromId?: string | null
  evolutionPathIds?: string[]
  syncBonusDP?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateDigimonBody>(event)

  // Validate required fields (type is optional)
  if (!body.name || !body.species || !body.stage || !body.attribute || !body.family || !body.baseStats) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: name, species, stage, attribute, family, baseStats',
    })
  }

  // Validate stage
  if (!STAGE_CONFIG[body.stage]) {
    throw createError({
      statusCode: 400,
      message: `Invalid stage: ${body.stage}`,
    })
  }

  const id = generateId()
  const now = new Date()
  const stageConfig = STAGE_CONFIG[body.stage]

  const newDigimon: NewDigimon = {
    id,
    name: body.name,
    species: body.species,
    stage: body.stage,
    attribute: body.attribute,
    family: body.family,
    type: body.type || null,
    size: body.size || 'medium',
    baseStats: JSON.stringify(body.baseStats),
    attacks: JSON.stringify(body.attacks || []),
    qualities: JSON.stringify(body.qualities || []),
    dataOptimization: body.dataOptimization || null,
    baseDP: stageConfig.dp,
    bonusDP: body.bonusDP || 0,
    bonusStats: JSON.stringify(body.bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }),
    bonusDPForQualities: body.bonusDPForQualities || 0,
    currentWounds: 0,
    currentStance: 'neutral',
    evolutionPathIds: JSON.stringify(body.evolutionPathIds || []),
    evolvesFromId: body.evolvesFromId || null,
    partnerId: body.partnerId || null,
    isEnemy: body.isEnemy || false,
    notes: body.notes || '',
    spriteUrl: body.spriteUrl || null,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.insert(digimon).values(newDigimon)

    // Handle bidirectional evolution links
    // If evolvesFromId is set, add this Digimon to the parent's evolutionPathIds
    if (body.evolvesFromId) {
      const [parent] = await db.select().from(digimon).where(eq(digimon.id, body.evolvesFromId))
      if (parent) {
        const updatedPaths = [...new Set([...(parent.evolutionPathIds || []), id])]
        await db.update(digimon).set({ evolutionPathIds: JSON.stringify(updatedPaths), updatedAt: now }).where(eq(digimon.id, body.evolvesFromId))
      }
    }

    // If evolutionPathIds is set, set evolvesFromId on those children to point to this Digimon
    if (body.evolutionPathIds && body.evolutionPathIds.length > 0) {
      await db.update(digimon).set({ evolvesFromId: id, updatedAt: now }).where(inArray(digimon.id, body.evolutionPathIds))
    }
  } catch (e) {
    console.error('Database insert error:', e)
    throw createError({
      statusCode: 500,
      message: e instanceof Error ? e.message : 'Database insert failed',
    })
  }

  // Fetch and return the created digimon with parsed JSON fields
  const [created] = await db.select().from(digimon).where(eq(digimon.id, id))
  return parseDigimonData(created)
})
