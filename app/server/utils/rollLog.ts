import { desc, eq, inArray } from 'drizzle-orm'
import { db, rollLog, type NewRollLogRow, type RollLogRow } from '../db'
import { broadcast } from './encounterRoom'

// The panel shows at most 50 entries, so never store more than 50 rows per
// campaign — pruned on every insert to keep storage bounded across campaigns.
export const ROLL_LOG_LIMIT = 50

export function campaignRoomKey(campaignId: string): string {
  return `campaign:${campaignId}`
}

// Insert a roll-log entry, prune the campaign's log to the newest
// ROLL_LOG_LIMIT rows, and push the entry to everyone in the campaign room.
export async function appendRollLogEntry(campaignId: string, entry: NewRollLogRow): Promise<RollLogRow> {
  const [inserted] = await db.insert(rollLog).values(entry).returning()

  const stale = await db
    .select({ id: rollLog.id })
    .from(rollLog)
    .where(eq(rollLog.campaignId, campaignId))
    .orderBy(desc(rollLog.createdAt), desc(rollLog.id))
    .offset(ROLL_LOG_LIMIT)

  if (stale.length > 0) {
    await db.delete(rollLog).where(inArray(rollLog.id, stale.map((s) => s.id)))
  }

  broadcast(campaignRoomKey(campaignId), { type: 'roll-logged', campaignId, entry: inserted })

  return inserted
}
