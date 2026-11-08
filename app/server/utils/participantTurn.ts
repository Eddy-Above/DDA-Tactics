import type { CombatParticipant } from '../../types/combat'
import { readCombatRecord } from './combatRecordCache'

type TurnParticipant = Pick<CombatParticipant, 'id' | 'type' | 'entityId'>
type PartnerRecord = { partnerId?: string | null }

interface ParticipantTurnContext {
  participants: readonly TurnParticipant[]
  turnOrder: readonly string[]
  currentTurnIndex?: number | null
  /** Reuse an actor record the action already loaded; null means it was not found. */
  actorDigimon?: PartnerRecord | null
}

/**
 * Ordinary actions belong to the active participant or a Digimon paired with the active Tamer.
 * Callers keep their own validation/errors and exceptions (reactions or forced evolution).
 * The query is lazy and shares an existing per-action record cache when one is active.
 */
export async function canActOnEncounterTurn(
  actor: TurnParticipant,
  context: ParticipantTurnContext,
  queryDigimon: (id: string) => PromiseLike<PartnerRecord[]>,
): Promise<boolean> {
  const activeId = context.turnOrder[context.currentTurnIndex || 0]
  if (actor.id === activeId) return true
  if (actor.type !== 'digimon') return false
  const active = context.participants.find(participant => participant.id === activeId)
  if (active?.type !== 'tamer') return false

  const record = context.actorDigimon !== undefined
    ? context.actorDigimon
    : await readCombatRecord('digimon', actor.entityId, () => queryDigimon(actor.entityId))
  return record?.partnerId === active.entityId
}
