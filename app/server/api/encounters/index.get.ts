import { and, desc, eq, type SQL } from 'drizzle-orm'
import { db, encounters } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const campaignId = query.campaignId as string | undefined
  // Player pages pass this so hidden (GM-staged) encounters never reach the client at all.
  const visibleOnly = query.visibleToPlayers === 'true'

  const filters: SQL[] = []
  if (campaignId) filters.push(eq(encounters.campaignId, campaignId))
  if (visibleOnly) filters.push(eq(encounters.visibleToPlayers, true))

  let queryBuilder = db.select().from(encounters)

  if (filters.length > 0) {
    queryBuilder = queryBuilder.where(and(...filters)) as typeof queryBuilder
  }

  // Newest activity first — without an explicit order Postgres returns rows in an
  // arbitrary order, which made "which encounter am I in?" resolution non-deterministic.
  const allEncounters = await queryBuilder.orderBy(desc(encounters.updatedAt))

  return allEncounters.map((encounter) => ({
    ...encounter,
    // The list view doesn't need the full combat history — trim the heavy
    // fields here; callers needing them should fetch the single encounter.
    battleLog: [],
    requestResponses: [],
    participants: (encounter.participants as any[]).map((p: any) => ({
      ...p,
      // Migrate old format { simple: X, complex: Y } to new format { simple: X }
      actionsRemaining: p.actionsRemaining?.complex !== undefined
        ? { simple: p.actionsRemaining.simple || 0 }
        : p.actionsRemaining || { simple: 2 }
    })),
  }))
})
