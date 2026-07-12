import { eq } from 'drizzle-orm'
import { db, tamers, type Tamer } from '../../db'
import { assertCanModifySandboxCharacter } from '../../utils/ownership'

type UpdateTamerBody = Partial<Omit<Tamer, 'id' | 'createdAt' | 'updatedAt'>>

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateTamerBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Tamer ID is required',
    })
  }

  // Check if tamer exists
  const [existing] = await db.select().from(tamers).where(eq(tamers.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Tamer with ID ${id} not found`,
    })
  }

  await assertCanModifySandboxCharacter(event, existing)

  const updateData: Partial<Tamer> = {
    ...body,
    updatedAt: new Date(),
  }

  // Hiding is owner-only: an unowned record can't be hidden (it would
  // vanish for everyone, its anonymous editor included).
  if (!existing.ownerId) delete updateData.hidden

  console.log('[PUT /api/tamers/:id] Updating tamer:', { id, name: body.name })

  await db.update(tamers).set(updateData).where(eq(tamers.id, id))

  // Return updated tamer
  const [updated] = await db.select().from(tamers).where(eq(tamers.id, id))
  return updated
})
