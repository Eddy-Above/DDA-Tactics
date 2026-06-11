import { eq } from 'drizzle-orm'
import { db, encounters } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  const room = await getRoomSnapshot(id)

  return {
    ...encounter,
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
    participants: (encounter.participants as any[]).map((p: any) => ({
      ...p,
      // Migrate old format { simple: X, complex: Y } to new format { simple: X }
      actionsRemaining: p.actionsRemaining?.complex !== undefined
        ? { simple: p.actionsRemaining.simple || 0 }
        : p.actionsRemaining || { simple: 2 }
    })),
  }
})
