// "Never intercede" opt-outs — who never wants to be asked to intercede for whom.
//
// Stored in the encounter's own `intercede_opt_outs` column, not on the participant rows:
// nearly every combat endpoint rewrites the whole `participants` array from a copy it read at
// request start, so an opt-out saved there could be reverted by any concurrent write. Only the
// opt-out endpoints write the column (server/utils/intercedeOptOuts.ts). Shared by the server
// and both encounter pages, so it must stay free of server/client-only imports.

export interface EncounterIntercedeOptOuts {
  /** Owner → target participant ids they never want to be asked about. The owner is a tamer's
   *  entity id, or 'GM' — the same convention as `pendingRequests[].targetTamerId`. */
  targets?: Record<string, string[]>
  /** GM only: target participant id → participant ids the GM never intercedes with for it. */
  gmCharacters?: Record<string, string[]>
}

export const GM_OPT_OUT_OWNER = 'GM'

interface OptOutSource {
  intercedeOptOuts?: EncounterIntercedeOptOuts | null
  participants?: unknown
}

// Encounters saved before the column existed kept their lists on the participant rows: the
// tamer's own row, or a pseudo-participant with id 'gm'. Read only until the owner saves again.
function legacyOwnerRow(encounter: OptOutSource, ownerId: string): any {
  const participants = (encounter.participants as any[] | undefined) || []
  return ownerId === GM_OPT_OUT_OWNER
    ? participants.find((p) => p.id === 'gm')
    : participants.find((p) => p.type === 'tamer' && p.entityId === ownerId)
}

/** Target participant ids this owner has opted out of being asked about. */
export function getTargetOptOuts(encounter: OptOutSource | null | undefined, ownerId: string | null | undefined): string[] {
  if (!encounter || !ownerId) return []
  const stored = encounter.intercedeOptOuts?.targets?.[ownerId]
  if (stored) return stored
  return legacyOwnerRow(encounter, ownerId)?.intercedeOptOuts || []
}

/** The GM's per-target lists of characters that should never intercede for that target. */
export function getGmCharacterOptOuts(encounter: OptOutSource | null | undefined): Record<string, string[]> {
  if (!encounter) return {}
  return encounter.intercedeOptOuts?.gmCharacters
    ?? legacyOwnerRow(encounter, GM_OPT_OUT_OWNER)?.gmCharacterOptOuts
    ?? {}
}

/** Targets an intercede-offer is still asking its recipient about. */
export function getOfferTargetIds(offer: any): string[] {
  const d = offer?.data || {}
  if (!d.isAreaAttack) return d.targetId ? [d.targetId] : []
  if (offer.targetTamerId === GM_OPT_OUT_OWNER) return d.gmAreaTargetIds || []
  return [...new Set<string>([...(d.tamerAreaTargetIds || []), ...(d.digimonAreaTargetIds || [])])]
}

/** True when every target an offer covers is one its recipient has opted out of. */
export function isOfferFullyOptedOut(offer: any, optOuts: string[]): boolean {
  const targetIds = getOfferTargetIds(offer)
  return targetIds.length > 0 && targetIds.every((id) => optOuts.includes(id))
}
