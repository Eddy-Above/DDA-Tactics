import type { CombatParticipant } from '../types/combat'
import { isRequestAnswered } from './requestState'

interface TurnEncounter {
  id: string
  phase: string
  round: number
  currentTurnIndex: number
  turnOrder: string[]
  participants: Pick<CombatParticipant, 'id' | 'type' | 'entityId' | 'inReserve' | 'isEnemy' | 'actionsRemaining'>[]
}

/** A player's turn includes all deployed Digimon partnered with the active tamer. */
export function exhaustedPlayerTurnKey(
  encounter: TurnEncounter | null | undefined,
  digimon: ReadonlyMap<string, { partnerId?: string | null; isEnemy?: boolean }>,
): string | null {
  if (!encounter || encounter.phase !== 'combat') return null
  const active = encounter.participants.find(p => p.id === encounter.turnOrder[encounter.currentTurnIndex])
  if (!active || active.id === 'gm' || active.inReserve || active.isEnemy
    || (active.type === 'digimon' && digimon.get(active.entityId)?.isEnemy)) return null
  const actors = encounter.participants.filter(p => !p.inReserve && (p.id === active.id
    || (active.type === 'tamer' && p.type === 'digimon' && digimon.get(p.entityId)?.partnerId === active.entityId)))
  if (actors.some(p => (p.actionsRemaining?.simple ?? 0) > 0)) return null
  return `${encounter.id}:${encounter.round}:${encounter.currentTurnIndex}:${active.id}`
}

export function hasUnresolvedTurnRequests(encounter: {
  pendingRequests?: any[] | null
  requestResponses?: any[] | null
} | null | undefined): boolean {
  return (encounter?.pendingRequests ?? []).some(request =>
    request.type === 'intercede-group-state' || !isRequestAnswered(request, encounter?.requestResponses))
}
