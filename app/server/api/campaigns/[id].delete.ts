import { afterDatabaseCommit } from '../../utils/databaseScope'
import { invalidateCampaignPeers } from '../../utils/websocketSecurity'
import { entityWrite } from '../../utils/entitySecurity'
import { requireCampaignManager } from '../../utils/campaignSecurity'
import { eq, inArray } from 'drizzle-orm'
import { db, campaigns, tamers, digimon, encounters, maps, evolutionLines, campaignAccessGrants, tamerAccessGrants } from '../../db'
import { requireOwnerOrCoOwner } from '../../utils/campaignAuth'

export default defineEventHandler(async (event) => entityWrite(async () => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Campaign ID is required',
    })
  }

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Campaign with ID ${id} not found`,
    })
  }

  // Owned campaigns require a manager; protected ownerless campaigns require verified GM access.
  await requireCampaignManager(event, id)

  // Delete in child-first order for FK safety
  await db.delete(evolutionLines).where(eq(evolutionLines.campaignId, id))
  await db.delete(digimon).where(eq(digimon.campaignId, id))
  await db.delete(encounters).where(eq(encounters.campaignId, id))
  await db.delete(maps).where(eq(maps.campaignId, id))

  // tamerAccessGrants has no campaignId column, so it can only be filtered
  // via tamerId — must run before the tamers themselves are deleted below.
  const campaignTamers = await db.select({ id: tamers.id }).from(tamers).where(eq(tamers.campaignId, id))
  const campaignTamerIds = campaignTamers.map((t) => t.id)
  if (campaignTamerIds.length > 0) {
    await db.delete(tamerAccessGrants).where(inArray(tamerAccessGrants.tamerId, campaignTamerIds))
  }

  await db.delete(tamers).where(eq(tamers.campaignId, id))
  await db.delete(campaignAccessGrants).where(eq(campaignAccessGrants.campaignId, id))
  await db.delete(campaigns).where(eq(campaigns.id, id))

  afterDatabaseCommit(() => invalidateCampaignPeers(id))
  return { success: true, id }
}))
