import { defineEncounterCommand } from '../../utils/encounterCommand'
import { authorizeEncounterIntent } from '../../utils/encounterAuthorization'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../../db'

export default defineEncounterCommand(async (event, commandContext) => {
  const id = getRouterParam(event, 'id')
  if (!commandContext) await authorizeEncounterIntent(event, id, undefined, 'delete')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  // Check if encounter exists
  const existing = commandContext?.encounter ?? (await db.select().from(encounters).where(eq(encounters.id, id)))[0]

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  // Delete encounter
  await db.delete(encounters).where(eq(encounters.id, id))

  return { success: true, id }
})
