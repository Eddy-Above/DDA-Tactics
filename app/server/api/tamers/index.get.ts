import { eq } from 'drizzle-orm'
import { db, tamers } from '../../db'
import { parseTamerData } from '../../utils/parsers'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined

  let queryBuilder = db.select().from(tamers)

  if (campaignId) {
    queryBuilder = queryBuilder.where(eq(tamers.campaignId, campaignId)) as typeof queryBuilder
  }

  const allTamers = await queryBuilder
  return allTamers.map(parseTamerData)
})
