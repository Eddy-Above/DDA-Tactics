import { db, maps } from '../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined

  const rows = campaignId
    ? await db.select().from(maps).where(eq(maps.campaignId, campaignId))
    : await db.select().from(maps)

  return rows
})
