// Defending against an area attack. An `[Area]` cast that hits several of one player's characters
// (their Tamer and partner, say) creates one `dodge-roll` request per target. These pure helpers
// group those requests by the cast that made them and work out each target's Dodge pool, so the
// player page can show one panel per cast instead of one modal per target. Shared by the page and
// its tests; no Vue, no server imports.
import { applyStatSwaps, type StatBlock } from './statSwaps'
import { applyStanceToDodge } from './stanceModifiers'
import { getEffectStatModifiers } from '../data/attackConstants'
import { isAttackedFromOutsideClash } from './clashRules'

export interface DodgeRequestGroup<R = any> {
  /** The cast (`intercedeGroupId`) the requests share, or a per-request key when there is none. */
  groupId: string
  /** True when the requests came from one cast; a request without a cast id is its own group. */
  isCast: boolean
  /** In the order the server created them, which is the order the targets are defended in. */
  requests: R[]
}

/**
 * Groups `dodge-roll` requests by the cast that created them (`data.intercedeGroupId`, set on both
 * the post-intercede and the no-offer area paths). A request without a cast id — a single-target
 * attack, a counterattack — is a group of one, so unrelated attacks never share a panel. Other
 * request types are ignored. Groups and the requests inside them keep their array order.
 */
export function groupDodgeRequests<R extends { id: string; type: string; data?: any }>(requests: readonly R[]): DodgeRequestGroup<R>[] {
  const groups = new Map<string, DodgeRequestGroup<R>>()
  for (const request of requests) {
    if (request.type !== 'dodge-roll') continue
    const castId = request.data?.intercedeGroupId
    const groupId = castId ? String(castId) : `request:${request.id}`
    const group = groups.get(groupId) ?? { groupId, isCast: !!castId, requests: [] }
    group.requests.push(request)
    groups.set(groupId, group)
  }
  return [...groups.values()]
}

/** Where a dodge pool comes from: the page owns the records and the stat rules, the math lives here. */
export interface DodgeDefenseContext {
  participants: readonly any[]
  findDigimon: (id: string) => any | undefined
  findTamer: (id: string) => any | undefined
  /** The Digimon's derived Dodge, quality bonuses included (the page's `calcDigimonStats(d).dodge`). */
  digimonDodge: (digimon: any) => number
  /** The Tamer's derived Dodge pool (the page's `calcTamerStats(t).dodgePool`). */
  tamerDodgePool: (tamer: any) => number
}

export interface DodgeModifier {
  label: string
  value: number
}

export interface DodgeDefense {
  /** Dice to roll. 0 when the target cannot dodge. */
  pool: number
  /** Attacked from outside the target's clash: it cannot dodge at all. */
  blocked: boolean
  /** Counterattack: only half the pool is rolled. */
  half: boolean
  /** The pool before stance, penalties and effects. */
  basePool: number
  /** What moved the pool away from `basePool`, in the order they apply (changes only). */
  modifiers: DodgeModifier[]
}

/** Whether the target of a dodge request can dodge at all (the clash rule, checked against live state). */
export function isDodgeBlocked(request: any, participants: readonly any[]): boolean {
  if (!request) return false
  if (request.data?.cannotDodge) return true
  const attacker = participants.find((p) => p.id === request.data?.attackerParticipantId)
  const target = participants.find((p) => p.id === request.targetParticipantId)
  return isAttackedFromOutsideClash(attacker, target)
}

/**
 * The Dodge pool for one `dodge-roll` request: the target's Dodge, its stance, the successive
 * attack penalty, active effects and Directed, then the clash block and the counterattack half.
 * An unknown target or an unloaded record falls back to 3 dice, as the single-request modal always
 * has. (Quick Reaction dice are not included, as before.)
 */
export function computeDodgeDefense(request: any, ctx: DodgeDefenseContext): DodgeDefense {
  const blocked = isDodgeBlocked(request, ctx.participants)
  const half = !!request?.data?.halfDodge
  const target = ctx.participants.find((p) => p.id === request?.targetParticipantId)
  if (!request || !target) return { pool: 3, blocked, half, basePool: 3, modifiers: [] }

  let pool = 3
  if (target.type === 'digimon') {
    const digi = ctx.findDigimon(target.entityId)
    if (digi) {
      const darkEvoBonus = digi.isDarkEvolution ? 2 : 0
      const rawStats: StatBlock = {
        accuracy: (digi.baseStats?.accuracy ?? 0) + (digi.bonusStats?.accuracy ?? 0) + darkEvoBonus,
        damage: (digi.baseStats?.damage ?? 0) + (digi.bonusStats?.damage ?? 0) + darkEvoBonus,
        dodge: (digi.baseStats?.dodge ?? 0) + (digi.bonusStats?.dodge ?? 0) + darkEvoBonus,
        armor: (digi.baseStats?.armor ?? 0) + (digi.bonusStats?.armor ?? 0) + darkEvoBonus,
      }
      const resolvedStats = applyStatSwaps(rawStats, target.statSwaps)
      const qualityDodgeBonus = ctx.digimonDodge(digi) - rawStats.dodge
      pool = resolvedStats.dodge + qualityDodgeBonus || 3
      // Digizoid Armor: Black's per-round rolled Dodge bonus (not part of the derived stats)
      pool += target.blackArmorRoundBonus?.dodge ?? 0
    }
  } else if (target.type === 'tamer') {
    const tamer = ctx.findTamer(target.entityId)
    if (tamer) pool = ctx.tamerDodgePool(tamer) || 3
  }

  const basePool = pool
  const modifiers: DodgeModifier[] = []
  const apply = (label: string, next: number) => {
    if (next !== pool) modifiers.push({ label, value: next - pool })
    pool = next
  }

  apply('Stance', applyStanceToDodge(pool, target.currentStance))
  apply('Successive attack penalty', Math.max(1, pool - (request.data?.dodgePenalty ?? 0)))
  apply('Effects', pool + getEffectStatModifiers(target.activeEffects || []).dodge)
  const directed = target.activeEffects?.find((e: any) => e.name === 'Directed')
  if (directed?.value) apply('Directed', pool + directed.value)

  if (blocked) return { pool: 0, blocked, half, basePool, modifiers }
  if (half) apply('Counterattack (half)', Math.max(1, Math.floor(pool / 2)))
  return { pool: Math.max(1, pool), blocked, half, basePool, modifiers }
}

/**
 * The outcome of one target's dodge, read from a battle log: the most recent `Dodge` entry for that
 * target (`Dodge (Support)` for a support attack). Null when the log has none yet.
 */
export function summarizeDodgeResult(
  battleLog: readonly any[],
  request: any,
): { hit: boolean; finalDamage: number | null; netSuccesses: number | null } | null {
  const action = request?.data?.isSupportAttack === true ? 'Dodge (Support)' : 'Dodge'
  for (let i = battleLog.length - 1; i >= 0; i--) {
    const entry = battleLog[i]
    if (entry?.action === action && entry.actorId === request?.targetParticipantId) {
      return { hit: !!entry.hit, finalDamage: entry.finalDamage ?? null, netSuccesses: entry.netSuccesses ?? null }
    }
  }
  return null
}
