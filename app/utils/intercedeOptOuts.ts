// "Never intercede" opt-outs — who never wants to be asked to intercede for whom.
//
// Stored in the encounter's own `intercede_opt_outs` column, not on the participant rows:
// nearly every combat endpoint rewrites the whole `participants` array from a copy it read at
// request start, so an opt-out saved there could be reverted by any concurrent write. Only the
// opt-out endpoints write the column (server/utils/intercedeOptOuts.ts). Shared by the server
// and both encounter pages, so it must stay free of server/client-only imports.

/**
 * "Pass until my next turn": a player's temporary, encounter-scoped decision to skip every
 * intercede prompt. It is not a permanent opt-out and never edits `targets`.
 */
export interface TemporaryIntercedePass {
  /** The player's Tamer participant — the slot whose turn start ends the pass. Its grouped partner
   *  is covered too, because offers are addressed to the Tamer's owner id. */
  characterId: string
  /** That participant's `turnsStarted` when the pass was set. */
  turnsStarted: number
  createdAt: string
}

export interface EncounterIntercedeOptOuts {
  /** Owner → target participant ids they never want to be asked about. The owner is a tamer's
   *  entity id, or 'GM' — the same convention as `pendingRequests[].targetTamerId`. */
  targets?: Record<string, string[]>
  /** GM only: target participant id → participant ids the GM never intercedes with for it. */
  gmCharacters?: Record<string, string[]>
  /** Owner (tamer entity id) → their active "pass until my next turn". Players only. */
  temporaryPasses?: Record<string, TemporaryIntercedePass>
}

export const GM_OPT_OUT_OWNER = 'GM'

interface OptOutSource {
  intercedeOptOuts?: EncounterIntercedeOptOuts | null
  participants?: unknown
  phase?: string
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

/** The participant a player's pass hangs on: their Tamer, unless it is staged in reserve. */
export function findPassSlot(participants: unknown, ownerId: string | null | undefined): any | null {
  if (!ownerId || ownerId === GM_OPT_OUT_OWNER) return null
  const slot = ((participants as any[] | undefined) || []).find((p) => p.type === 'tamer' && p.entityId === ownerId)
  return slot && !slot.inReserve ? slot : null
}

/**
 * The owner's pass, if it is still in force. A pass lasts only while the participant it was set
 * on has not started another turn: every turn start bumps `turnsStarted`, so the pass ends by
 * itself at that character's next real turn — including a turn started by a knockout or by
 * removing the active participant — while a reorder, an added participant or an unrelated
 * removal never touches the counter and cannot end it. It is void once the Tamer leaves the
 * fight or combat is no longer running. Players only: the GM has no pass.
 */
export function getActiveTemporaryPass(
  encounter: OptOutSource | null | undefined,
  ownerId: string | null | undefined,
): TemporaryIntercedePass | null {
  if (!encounter || !ownerId || ownerId === GM_OPT_OUT_OWNER) return null
  if (encounter.phase !== undefined && encounter.phase !== 'combat') return null
  const pass = encounter.intercedeOptOuts?.temporaryPasses?.[ownerId]
  if (!pass) return null
  const character = ((encounter.participants as any[] | undefined) || []).find((p) => p.id === pass.characterId)
  if (!character || character.type !== 'tamer' || character.entityId !== ownerId || character.inReserve) return null
  return (character.turnsStarted ?? 0) === pass.turnsStarted ? pass : null
}

/** Owners whose pass is currently in force. */
export function getPassingOwnerIds(encounter: OptOutSource | null | undefined): string[] {
  return Object.keys(encounter?.intercedeOptOuts?.temporaryPasses || {})
    .filter((ownerId) => getActiveTemporaryPass(encounter, ownerId))
}

/** The stored passes that are still in force (expired ones are dropped when passes are rewritten). */
export function getActiveTemporaryPasses(encounter: OptOutSource | null | undefined): Record<string, TemporaryIntercedePass> {
  const active: Record<string, TemporaryIntercedePass> = {}
  for (const ownerId of getPassingOwnerIds(encounter)) {
    active[ownerId] = encounter!.intercedeOptOuts!.temporaryPasses![ownerId]!
  }
  return active
}

/** An offer that carries a usable Quick Reaction for the recipient's own partner. */
export function offerHasQuickReaction(offer: any): boolean {
  return !!offer?.data?.canUseQuickReaction
}

/**
 * True when a pass answers this offer for its recipient. A pass is a way to stop being asked to
 * intercede, so an offer that also carries a Quick Reaction (a once-per-day order the GM applies
 * for the player) is left standing rather than silently forfeited.
 */
export function isOfferPassed(encounter: OptOutSource | null | undefined, offer: any): boolean {
  if (!offer || offer.type !== 'intercede-offer' || offerHasQuickReaction(offer)) return false
  return !!getActiveTemporaryPass(encounter, offer.targetTamerId)
}

/** True when the recipient has already said they do not want this offer: opted out or passing. */
export function isOfferSuppressed(encounter: OptOutSource | null | undefined, offer: any): boolean {
  if (!offer) return false
  if (isOfferFullyOptedOut(offer, getTargetOptOuts(encounter, offer.targetTamerId))) return true
  return isOfferPassed(encounter, offer)
}
