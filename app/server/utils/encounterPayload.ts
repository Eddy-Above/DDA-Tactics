import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { getRoomSnapshot } from './encounterRoom'
import { normalizeActionsRemaining, trimBattleLog } from '../../utils/encounterSnapshot'

// Shared response shape for the encounter detail GET endpoint and the
// realtime WS push: merges live room state (positions/destructibles) over
// the persisted row, migrates legacy actionsRemaining, and trims the
// battle log so large encounters don't balloon every payload. The trimming and
// migration live in utils/encounterSnapshot.ts so the pages shape an action
// response (a raw row) identically before applying it.
export async function buildEncounterPayload(encounterId: string) {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) return null

  const room = await getRoomSnapshot(encounterId)
  const { entries, total, wasTrimmed } = trimBattleLog(encounter.battleLog as any[])

  return {
    ...encounter,
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
    version: room.version,
    participants: normalizeActionsRemaining(encounter.participants as any[]),
    battleLog: entries,
    _battleLogTotal: total,
    _battleLogWasTrimmed: wasTrimmed,
  }
}
