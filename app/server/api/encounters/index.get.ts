import { eq } from 'drizzle-orm'
import { db, encounters } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined

  let queryBuilder = db.select().from(encounters)

  if (campaignId) {
    queryBuilder = queryBuilder.where(eq(encounters.campaignId, campaignId)) as typeof queryBuilder
  }

  const allEncounters = await queryBuilder

  return allEncounters.map((encounter) => ({
    ...encounter,
    participants: (encounter.participants as any[]).map((p: any) => ({
      ...p,
      // Migrate old format { simple: X, complex: Y } to new format { simple: X }
      actionsRemaining: p.actionsRemaining?.complex !== undefined
        ? { simple: p.actionsRemaining.simple || 0 }
        : p.actionsRemaining || { simple: 2 }
    })),
  }))
})
