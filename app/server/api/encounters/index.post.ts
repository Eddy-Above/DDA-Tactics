import { db, encounters, type NewEncounter } from '../../db'
import { generateId } from '../../utils/id'

interface CreateEncounterBody {
  name: string
  description?: string
  campaignId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateEncounterBody>(event)

  if (!body.name) {
    throw createError({
      statusCode: 400,
      message: 'Encounter name is required',
    })
  }

  const id = generateId()
  const now = new Date()

  const newEncounter: any = {
    id,
    name: body.name,
    description: body.description || '',
    campaignId: body.campaignId || null,
    round: 0,
    phase: 'setup',
    participants: [],
    turnOrder: [],
    currentTurnIndex: 0,
    battleLog: [],
    hazards: [],
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(encounters).values(newEncounter)

  return newEncounter
})
