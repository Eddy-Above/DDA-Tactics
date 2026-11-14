import { defineEncounterCommand } from '../../utils/encounterCommand'
import { updateEncounterState, type UpdateEncounterBody } from '../../utils/encounterUpdate'
import { serializeIntercedeClaim } from '../../utils/intercedeClaims'
import { tableWriteBody } from '../../utils/securityValidation'
import { encounters } from '../../db'
import { requireLinkedEntity } from '../../utils/entitySecurity'

export default defineEncounterCommand(async (event, { encounter }) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  const body = tableWriteBody(await readBody(event), encounters, encounter, [], ['revision']) as UpdateEncounterBody
  if (body.mapId) await requireLinkedEntity(event, 'map', body.mapId, encounter.campaignId)
  if (body.participants) {
    if (!Array.isArray(body.participants)) throw createError({ statusCode: 400, message: 'Participants must be an array' })
    const storedById = new Map(encounter.participants.map(participant => [participant.id, participant]))
    for (const participant of body.participants) {
      if (!['tamer', 'digimon'].includes(participant.type)) throw createError({ statusCode: 400, message: 'Invalid participant type' })
      // updateEncounterState validates the complete linked roster in batched reads
      // under the command transaction, before gameplay effects or writes run.
      const stored = storedById.get(participant.id) as any
      for (const field of ['pendingChargeMove', 'movementReceipts', 'attackReceipts', 'lastStanceOperationId', 'lastCardMoveOperationId', 'lastEndTurnOperationId']) {
        if (stored?.[field] !== undefined) (participant as any)[field] = stored[field]
        else delete (participant as any)[field]
      }
    }
  }
  return serializeIntercedeClaim(id, () => updateEncounterState(id, body, encounter))
})
