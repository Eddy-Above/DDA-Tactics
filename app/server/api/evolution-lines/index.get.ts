import { filterReadableEntities } from '../../utils/entitySecurity'
import { requireCampaignMember } from '../../utils/campaignSecurity'
import { and, eq, or, isNull } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerId = query.partnerId as string | undefined
  const campaignId = query.campaignId as string | undefined
  if (campaignId) await requireCampaignMember(event, campaignId)

  let queryBuilder = db.select().from(evolutionLines)

  const conditions = []
  // Legacy lines can inherit their campaign through a Tamer or chain form.
  // Resolve those candidates below before returning any rows to this campaign.
  if (campaignId) conditions.push(or(eq(evolutionLines.campaignId, campaignId), isNull(evolutionLines.campaignId)))
  if (partnerId) conditions.push(eq(evolutionLines.partnerId, partnerId))
  if (conditions.length) queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder

  return filterReadableEntities(event, await queryBuilder, 'evolution-line', undefined, campaignId)
})
