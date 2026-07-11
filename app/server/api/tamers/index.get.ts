import { eq, isNull } from 'drizzle-orm'
import { db, tamers } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined
  const sandbox = query.sandbox === 'true'

  let queryBuilder = db.select().from(tamers)

  if (sandbox) {
    // Workshop (sandbox) tamers: not attached to any campaign
    queryBuilder = queryBuilder.where(isNull(tamers.campaignId)) as typeof queryBuilder
  } else if (campaignId) {
    queryBuilder = queryBuilder.where(eq(tamers.campaignId, campaignId)) as typeof queryBuilder
  }

  return await queryBuilder
})
