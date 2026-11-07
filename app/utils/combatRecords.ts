// Which stored records (Tamer, Digimon, evolution lines) a combat update touches, so a page can
// refetch just those instead of reloading everything. Pure and shared by both encounter pages.
import { evolutionFormsKey } from './evolutionForms'

/** The action a page just performed, for records an encounter snapshot cannot reveal. */
export type CombatActionKind =
  | 'attack' | 'dodge' | 'counterattack' | 'health' | 'throw-impact' | 'recovery' | 'direct'
  | 'intercede-claim' | 'intercede-skip' | 'intercede-optouts' | 'intercede-pass' | 'divine-protection'
  | 'digivolve' | 'devolve' | 'mode-change'
  | 'special-order' | 'skill-order' | 'spend-inspiration'
  | 'clash' | 'move' | 'stance' | 'end-turn' | 'request-response'

export interface RecordHint {
  /** The acting player's own Tamer record changed (daily orders, Inspiration, digivolution count). */
  tamer?: boolean
  /** Evolution line stages moved. */
  evolutionLines?: boolean
  /** The player's partner Digimon records changed (a new form's stats, a rookie's wounds). */
  partnerDigimon?: boolean
}

/**
 * Records an action rewrites that the returned encounter does not show. Everything else a page
 * needs is read from the encounter itself or found by diffing two snapshots (see below), so an
 * action absent here (an attack, a skip, a move) refreshes no records at all.
 */
export const ACTION_RECORD_HINTS: Readonly<Partial<Record<CombatActionKind, RecordHint>>> = {
  digivolve: { tamer: true, evolutionLines: true, partnerDigimon: true },
  devolve: { evolutionLines: true, partnerDigimon: true },
  'special-order': { tamer: true },
  'skill-order': { tamer: true },
  'spend-inspiration': { tamer: true },
  recovery: { partnerDigimon: true },
}

export interface RecordRefreshPlan {
  /** Digimon records to refetch by id. */
  digimonIds: string[]
  tamerIds: string[]
  evolutionLines: boolean
  /** Reload the acting player's partner Digimon list. */
  partnerDigimon: boolean
}

export interface RecordOwner {
  tamerId: string
  /** Digimon records the page already holds. */
  knownDigimonIds: ReadonlySet<string>
}

/**
 * The slice of a participant that mirrors its stored record. A change here without a change of
 * entity id (a GM stat edit that moved the wound boxes, an NPC's stage) means the record is stale.
 */
export function participantRecordKey(p: any): string {
  return [p.id, p.entityId, p.maxWounds, p.totalHealth, p.npcStageIndex, p.evolutionLineId].join('|')
}

/**
 * Compares the encounter a page held with the one it just received and lists what to refetch:
 * Digimon the page has never loaded (evolution into a new record), Digimon whose participant
 * mirror changed (devolution back to a known form, an edit that kept the id), the evolution lines
 * when any evolving participant changed form, and the player's own Tamer when its live Inspiration
 * moved. `hint` adds what the acting player's own action is known to rewrite.
 */
export function planRecordRefresh(
  previous: { participants?: readonly any[] | null } | null | undefined,
  next: { participants?: readonly any[] | null } | null | undefined,
  owner: RecordOwner,
  hint?: RecordHint | null,
): RecordRefreshPlan {
  const plan: RecordRefreshPlan = {
    digimonIds: [],
    tamerIds: [],
    evolutionLines: !!hint?.evolutionLines,
    partnerDigimon: !!hint?.partnerDigimon,
  }
  const before = new Map<string, any>((previous?.participants ?? []).map((p) => [p.id, p]))
  const digimonIds = new Set<string>()

  for (const p of next?.participants ?? []) {
    const prior = before.get(p.id)
    if (p.type === 'digimon' && p.entityId) {
      if (!owner.knownDigimonIds.has(p.entityId)) digimonIds.add(p.entityId)
      else if (prior && participantRecordKey(prior) !== participantRecordKey(p)) digimonIds.add(p.entityId)
    }
    if (p.type === 'tamer' && p.entityId === owner.tamerId && prior && prior.currentInspiration !== p.currentInspiration) {
      plan.tamerIds.push(owner.tamerId)
    }
  }

  if (evolutionFormsKey(previous) !== evolutionFormsKey(next)) {
    plan.evolutionLines = true
    plan.partnerDigimon = true
  }
  if (hint?.tamer && !plan.tamerIds.includes(owner.tamerId)) plan.tamerIds.push(owner.tamerId)
  plan.digimonIds = [...digimonIds]
  return plan
}

export function isEmptyPlan(plan: RecordRefreshPlan): boolean {
  return plan.digimonIds.length === 0 && plan.tamerIds.length === 0 && !plan.evolutionLines && !plan.partnerDigimon
}

/**
 * Merges refetched records into a list by id. A record whose `updatedAt` is unchanged keeps its
 * object identity, so nothing that depends on it recomputes; unknown ids are appended.
 */
export function mergeRecordsById<T extends { id: string; updatedAt?: unknown }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  if (incoming.length === 0) return current as T[]
  const byId = new Map(incoming.map((r) => [r.id, r]))
  const merged = current.map((record) => {
    const fresh = byId.get(record.id)
    if (!fresh) return record
    byId.delete(record.id)
    return String(fresh.updatedAt ?? '') === String(record.updatedAt ?? '') && record.updatedAt !== undefined ? record : fresh
  })
  return [...merged, ...byId.values()]
}
