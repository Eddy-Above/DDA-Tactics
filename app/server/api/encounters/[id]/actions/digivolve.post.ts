import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { performDigivolution, type DigivolveBody } from '../../../../utils/digivolutionAction'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
export default defineEncounterCommand(async (event, commandContext) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<DigivolveBody>(event)
  if (!commandContext) await authorizeEncounterIntent(event, id, body, 'digivolve')
  return serializeIntercedeClaim(id!, () => performDigivolution(id!, body, false, commandContext?.encounter))
})
