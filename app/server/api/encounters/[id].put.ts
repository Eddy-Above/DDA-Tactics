import { defineEncounterCommand } from '../../utils/encounterCommand'
import { requireEncounterAccess } from '../../utils/campaignSecurity'
import { updateEncounterState, type UpdateEncounterBody } from '../../utils/encounterUpdate'
import { serializeIntercedeClaim } from '../../utils/intercedeClaims'
import { tableWriteBody } from '../../utils/securityValidation'
import { encounters } from '../../db'
import { requireLinkedEntity } from '../../utils/entitySecurity'

export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  const { encounter } = await requireEncounterAccess(event, id, 'dm')
  const body = tableWriteBody(await readBody(event), encounters, encounter, [], ['revision']) as UpdateEncounterBody
  if (body.mapId) await requireLinkedEntity(event, 'map', body.mapId, encounter.campaignId)
  if (body.participants) {
    if (!Array.isArray(body.participants)) throw createError({ statusCode: 400, message: 'Participants must be an array' })
    for (const participant of body.participants) {
      if (!['tamer', 'digimon'].includes(participant.type)) throw createError({ statusCode: 400, message: 'Invalid participant type' })
      await requireLinkedEntity(event, participant.type as 'tamer' | 'digimon', participant.entityId, encounter.campaignId)
      const stored = encounter.participants.find(p => p.id === participant.id) as any
      for (const field of ['pendingChargeMove', 'movementReceipts', 'attackReceipts', 'lastStanceOperationId', 'lastCardMoveOperationId', 'lastEndTurnOperationId']) {
        if (stored?.[field] !== undefined) (participant as any)[field] = stored[field]
        else delete (participant as any)[field]
      }
    }
  }
  return serializeIntercedeClaim(id, () => updateEncounterState(id, body))
})
