import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { performDigivolution, type DigivolveBody } from '../../../../utils/digivolutionAction'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<DigivolveBody>(event)
  await authorizeEncounterIntent(event, id, body, 'digivolve')
  return serializeIntercedeClaim(id!, () => performDigivolution(id!, body))
})
