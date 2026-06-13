import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { getRoomSnapshot } from './encounterRoom'

const BATTLE_LOG_LIMIT = 50

// Shared response shape for the encounter detail GET endpoint and the
// realtime WS push: merges live room state (positions/destructibles) over
// the persisted row, migrates legacy actionsRemaining, and trims the
// battle log so large encounters don't balloon every payload.
export async function buildEncounterPayload(encounterId: string) {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) return null

  const room = await getRoomSnapshot(encounterId)
  const battleLog = (encounter.battleLog as any[]) ?? []
  const wasTrimmed = battleLog.length > BATTLE_LOG_LIMIT
  const trimmedLog = wasTrimmed ? battleLog.slice(battleLog.length - BATTLE_LOG_LIMIT) : battleLog

  return {
    ...encounter,
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
    version: room.version,
    participants: (encounter.participants as any[]).map((p: any) => ({
      ...p,
      // Migrate old format { simple: X, complex: Y } to new format { simple: X }
      actionsRemaining: p.actionsRemaining?.complex !== undefined
        ? { simple: p.actionsRemaining.simple || 0 }
        : p.actionsRemaining || { simple: 2 }
    })),
    battleLog: trimmedLog,
    _battleLogTotal: battleLog.length,
    _battleLogWasTrimmed: wasTrimmed,
  }
}
