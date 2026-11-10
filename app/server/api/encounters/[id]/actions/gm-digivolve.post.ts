import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { requireEncounterAccess } from '../../../../utils/campaignSecurity'
import { performDigivolution, type DigivolveBody } from '../../../../utils/digivolutionAction'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { allowFields } from '../../../../utils/securityValidation'
export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  await requireEncounterAccess(event, id, 'dm')
  const body = allowFields(await readBody(event), ['participantId', 'targetChainIndex', 'operationId', 'expectedRevision']) as unknown as DigivolveBody
  return serializeIntercedeClaim(id, () => performDigivolution(id, body, true))
})
