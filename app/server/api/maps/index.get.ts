import { filterReadableEntities } from '../../utils/entitySecurity'
import { requireCampaignMember } from '../../utils/campaignSecurity'
import { db, maps } from '../../db'
import { eq, isNull } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined
  if (campaignId) await requireCampaignMember(event, campaignId)

  const rows = campaignId
    ? await db.select().from(maps).where(eq(maps.campaignId, campaignId))
    : query.sandbox === 'true'
      ? await db.select().from(maps).where(isNull(maps.campaignId))
      : await db.select().from(maps)

  return filterReadableEntities(event, rows, 'map')
})
