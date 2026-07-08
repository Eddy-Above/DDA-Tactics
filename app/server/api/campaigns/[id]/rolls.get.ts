import { desc, eq } from 'drizzle-orm'
import { db, rollLog } from '../../../db'
import { ROLL_LOG_LIMIT } from '../../../utils/rollLog'

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')

  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const entries = await db
    .select()
    .from(rollLog)
    .where(eq(rollLog.campaignId, campaignId))
    .orderBy(desc(rollLog.createdAt), desc(rollLog.id))
    .limit(ROLL_LOG_LIMIT)

  return { entries }
})
