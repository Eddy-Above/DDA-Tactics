import { and, eq, isNull, or } from 'drizzle-orm'
import { db, tamers } from '../../db'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined
  const sandbox = query.sandbox === 'true'

  let queryBuilder = db.select().from(tamers)

  if (sandbox) {
    // Workshop (sandbox) tamers: not attached to any campaign. Hidden
    // characters are visible only to their owner; a hidden flag on an
    // unowned record is neutralized (visible to everyone) so anonymous
    // edits can't vanish a record for good.
    const sessionUser = await getSessionUser(event)
    const visibility = [eq(tamers.hidden, false), isNull(tamers.ownerId)]
    if (sessionUser) visibility.push(eq(tamers.ownerId, sessionUser.id))
    queryBuilder = queryBuilder.where(and(isNull(tamers.campaignId), or(...visibility))) as typeof queryBuilder
  } else if (campaignId) {
    queryBuilder = queryBuilder.where(eq(tamers.campaignId, campaignId)) as typeof queryBuilder
  }

  return await queryBuilder
})
