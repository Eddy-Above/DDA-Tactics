import { entityWrite } from '../../utils/entitySecurity'
import { requireEntityAccess } from '../../utils/entitySecurity'
import { eq } from 'drizzle-orm'
import { db, tamers, digimon, evolutionLines, tamerAccessGrants } from '../../db'
import { assertCanModifySandboxCharacter } from '../../utils/ownership'

export default defineEventHandler(async (event) => entityWrite(async () => {
  const id = getRouterParam(event, 'id')

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

  await requireEntityAccess(event, 'tamer', existing, true)

  for (const child of await db.select().from(digimon).where(eq(digimon.partnerId, id))) {
    if ((child.campaignId ?? null) !== (existing.campaignId ?? null)) throw createError({ statusCode: 400, message: 'Linked Digimon has a different campaign' })
    await requireEntityAccess(event, 'digimon', child, true)
  }
  for (const line of await db.select().from(evolutionLines).where(eq(evolutionLines.partnerId, id))) await requireEntityAccess(event, 'evolution-line', line, true)

  // Delete all digimon associated with this tamer
  await db.delete(digimon).where(eq(digimon.partnerId, id))

  // Delete all evolution lines associated with this tamer
  await db.delete(evolutionLines).where(eq(evolutionLines.partnerId, id))

  // Delete any per-tamer access grants (no DB-level FK, so this is manual)
  await db.delete(tamerAccessGrants).where(eq(tamerAccessGrants.tamerId, id))

  // Delete tamer
  await db.delete(tamers).where(eq(tamers.id, id))

  return { success: true, id }
}))
