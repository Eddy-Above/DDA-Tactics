import { eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerId = query.partnerId as string | undefined
  const campaignId = query.campaignId as string | undefined

  let queryBuilder = db.select().from(evolutionLines)

  if (campaignId) {
    queryBuilder = queryBuilder.where(eq(evolutionLines.campaignId, campaignId)) as typeof queryBuilder
  }

  if (partnerId) {
    queryBuilder = queryBuilder.where(eq(evolutionLines.partnerId, partnerId)) as typeof queryBuilder
  }

  return await queryBuilder
})
