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

  const children = await db.select().from(digimon).where(eq(digimon.partnerId, id))
  const lines = await db.select().from(evolutionLines).where(eq(evolutionLines.partnerId, id))
  const workshop = !existing.campaignId
  for (const child of children) {
    if ((child.campaignId ?? null) !== (existing.campaignId ?? null)) throw createError({ statusCode: 400, message: 'Linked Digimon has a different campaign' })
    // Workshop deletes only unlink these records. Validate the actual row's
    // ownership rather than traversing unrelated/malformed evolution graphs.
    if (workshop) await assertCanModifySandboxCharacter(event, child)
    else await requireEntityAccess(event, 'digimon', child, true)
  }
  for (const line of lines) {
    if ((line.campaignId ?? null) !== (existing.campaignId ?? null)) throw createError({ statusCode: 400, message: 'Linked evolution line has a different campaign' })
    // Standalone lines are controlled by their stored partner Tamer, authorized above.
    if (!workshop) await requireEntityAccess(event, 'evolution-line', line, true)
  }

  if (workshop) {
    await db.update(digimon).set({ partnerId: null, updatedAt: new Date() }).where(eq(digimon.partnerId, id))
    await db.update(evolutionLines).set({ partnerId: null, updatedAt: new Date() }).where(eq(evolutionLines.partnerId, id))
  } else {
    await db.delete(digimon).where(eq(digimon.partnerId, id))
    await db.delete(evolutionLines).where(eq(evolutionLines.partnerId, id))
  }

  // Delete any per-tamer access grants (no DB-level FK, so this is manual)
  await db.delete(tamerAccessGrants).where(eq(tamerAccessGrants.tamerId, id))

  // Delete tamer
  await db.delete(tamers).where(eq(tamers.id, id))

  return { success: true, id }
}))
