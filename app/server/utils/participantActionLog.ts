import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, digimon, tamers, type Encounter } from '../db'
import type { CombatParticipant } from '../../types/combat'
import { readCombatRecord } from './combatRecordCache'
import { resolveParticipantName } from './participantName'

/** Mechanical action logs use stored identities and commit with the action they describe. */
export async function createParticipantActionLog(
  encounter: Pick<Encounter, 'round' | 'participants'>,
  actor: Pick<CombatParticipant, 'id' | 'type' | 'entityId' | 'seq' | 'isEnemy'>,
  action: string,
  result: string,
): Promise<Encounter['battleLog'][number]> {
  const record = actor.type === 'digimon'
    ? await readCombatRecord('digimon', actor.entityId, () => db.select().from(digimon).where(eq(digimon.id, actor.entityId)))
    : await readCombatRecord('tamer', actor.entityId, () => db.select().from(tamers).where(eq(tamers.id, actor.entityId)))
  const actorName = actor.type === 'digimon'
    ? resolveParticipantName(actor, encounter.participants, (record as any)?.name ?? 'Digimon', (record as any)?.isEnemy ?? false)
    : (record as any)?.name ?? 'Tamer'
  return {
    id: `log-${randomUUID()}`, timestamp: new Date().toISOString(), round: encounter.round,
    actorId: actor.id, actorName, action, target: null, result, damage: null, effects: [],
  }
}
