import { requireEntityAccess } from '../../utils/entitySecurity'
import { tableWriteBody } from '../../utils/securityValidation'
import { eq } from 'drizzle-orm'
import { db, tamers, type Tamer } from '../../db'
import { assertCanModifySandboxCharacter } from '../../utils/ownership'
import { requireCampaignDm } from '../../utils/campaignDm'
import { reconcileTamerExperience, validTotalXp } from '../../../utils/tamerExperience'
import { requireTamerGmFields } from '../../utils/libraryGmFields'

type UpdateTamerBody = Partial<Omit<Tamer, 'id' | 'createdAt' | 'updatedAt'>>

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  let body = await readBody<UpdateTamerBody>(event)
  if (body.xp !== undefined && (body.xp === null || !validTotalXp(body.xp))) {
    throw createError({ statusCode: 400, message: 'Available XP must be a nonnegative whole number' })
  }
  if (body.totalXp !== undefined && !validTotalXp(body.totalXp)) {
    throw createError({ statusCode: 400, message: 'Total XP must be a nonnegative whole number or null' })
  }

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Tamer ID is required',
    })
  }

  // Lock the current budget through validation and saving, including against concurrent GM rewards.
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(tamers).where(eq(tamers.id, id)).for('update')
    if (!existing) {
      throw createError({ statusCode: 404, message: `Tamer with ID ${id} not found` })
    }

    await requireEntityAccess(event, 'tamer', existing, true)
    body = tableWriteBody(body, tamers, existing, [], ['publicAccess']) as UpdateTamerBody
    await requireTamerGmFields(event, existing.campaignId, body, existing)
    if (body.totalXp !== undefined && body.totalXp !== existing.totalXp) {
      if (!existing.campaignId) throw createError({ statusCode: 403, message: 'Only a campaign GM can set the XP budget' })
      await requireCampaignDm(event, existing.campaignId)
    }

    let experience: { xp: number; totalXp: number | null }
    try { experience = reconcileTamerExperience(existing, body) }
    catch (error: any) { throw createError({ statusCode: 400, message: error.message }) }

    const updateData: Partial<Tamer> = { ...body, ...experience, updatedAt: new Date() }
    // Hiding is owner-only; an unowned record cannot be hidden from its anonymous editor.
    if (!existing.ownerId) delete updateData.hidden

    console.log('[PUT /api/tamers/:id] Updating tamer:', { id, name: body.name })
    await tx.update(tamers).set(updateData).where(eq(tamers.id, id))
    const [updated] = await tx.select().from(tamers).where(eq(tamers.id, id))
    return updated
  })
})
