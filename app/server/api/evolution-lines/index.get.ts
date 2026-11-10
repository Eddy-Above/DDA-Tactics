import { filterReadableEntities } from '../../utils/entitySecurity'
import { requireCampaignMember } from '../../utils/campaignSecurity'
import { and, eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerId = query.partnerId as string | undefined
  const campaignId = query.campaignId as string | undefined
  if (campaignId) await requireCampaignMember(event, campaignId)

  let queryBuilder = db.select().from(evolutionLines)

  const conditions = []
  if (campaignId) conditions.push(eq(evolutionLines.campaignId, campaignId))
  if (partnerId) conditions.push(eq(evolutionLines.partnerId, partnerId))
  if (conditions.length) queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder

  return filterReadableEntities(event, await queryBuilder, 'evolution-line')
})
