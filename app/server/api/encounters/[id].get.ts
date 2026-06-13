import { buildEncounterPayload } from '../../utils/encounterPayload'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const payload = await buildEncounterPayload(id)

  if (!payload) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  return payload
})
