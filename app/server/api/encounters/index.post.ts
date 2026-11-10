import { db, encounters, type NewEncounter } from '../../db'
import { generateId } from '../../utils/id'
import { requireCampaignDm } from '../../utils/campaignSecurity'
import { requireLinkedEntity } from '../../utils/entitySecurity'
import { allowFields, boundedString } from '../../utils/securityValidation'

interface CreateEncounterBody {
  name: string
  description?: string
  campaignId?: string
  mapId?: string
}

export default defineEventHandler(async (event) => {
  const body = allowFields(await readBody(event), ['name', 'description', 'campaignId', 'mapId']) as unknown as CreateEncounterBody
  if (!body.campaignId) throw createError({ statusCode: 400, message: 'Choose a campaign for new encounters' })
  await requireCampaignDm(event, body.campaignId)
  boundedString(body.name, 'name', 200, false)
  if (body.description !== undefined) boundedString(body.description, 'description', 10000)
  await requireLinkedEntity(event, 'map', body.mapId, body.campaignId)

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
    mapId: body.mapId || null,
    round: 0,
    phase: 'setup',
    participants: [],
    turnOrder: [],
    currentTurnIndex: 0,
    battleLog: [],
    hazards: [],
    participantPositions: {},
    destructibleStates: [],
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(encounters).values(newEncounter)

  return newEncounter
})
