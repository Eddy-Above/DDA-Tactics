import type { RecordRefreshPlan } from './combatRecords'
import { PLAYER_VISIBLE_PHASES } from './encounterSnapshot'

export interface CharacterUpdate {
  type: 'character-updated'
  campaignId: string
  tamerIds: string[]
  digimonIds: string[]
  /** Owners affected by a partner roster or evolution-line change. */
  ownerTamerIds: string[]
  partnerDigimon: boolean
  evolutionLines: boolean
  deletedTamerIds?: string[]
}

/** Ignore unrelated saves before making any HTTP requests. */
export function playerCharacterRefreshPlan(
  message: CharacterUpdate,
  ownerId: string,
  ownedDigimonIds: ReadonlySet<string>,
): RecordRefreshPlan {
  const ownsChange = message.ownerTamerIds.includes(ownerId)
  return {
    tamerIds: message.tamerIds.filter(id => id === ownerId),
    digimonIds: message.digimonIds.filter(id => ownedDigimonIds.has(id)),
    partnerDigimon: ownsChange && message.partnerDigimon,
    evolutionLines: ownsChange && message.evolutionLines,
  }
}

export interface EncounterAudience {
  id: string
  campaignId: string | null
  visibleToPlayers?: boolean
  phase: string
  participants?: readonly { type: string; entityId: string }[] | null
  pendingRequests?: readonly { targetTamerId?: string }[] | null
}

/** IDs only: campaign listeners must never receive a staged encounter's contents. */
export function encounterAudience(encounter: EncounterAudience | null | undefined) {
  if (!encounter || encounter.visibleToPlayers === false || !PLAYER_VISIBLE_PHASES.includes(encounter.phase)) {
    return { tamerIds: [] as string[], digimonIds: [] as string[] }
  }
  return {
    tamerIds: [...new Set([
      ...(encounter.participants ?? []).filter(p => p.type === 'tamer').map(p => p.entityId),
      ...(encounter.pendingRequests ?? []).flatMap(r => r.targetTamerId && r.targetTamerId !== 'GM' ? [r.targetTamerId] : []),
    ])].sort(),
    digimonIds: [...new Set((encounter.participants ?? []).filter(p => p.type === 'digimon').map(p => p.entityId))].sort(),
  }
}
