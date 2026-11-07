import { eq } from 'drizzle-orm'
import { db, encounters, campaigns } from '../db'
import { STAGE_CONFIG, type CampaignRulesSettings, type EddySoulRules, type HouseRules, type Vec3 } from '../../types'
import { DAMAGE_OVER_TIME_EFFECTS, getEffectStatModifiers } from '../../data/attackConstants'
import { type StatBlock, applyStatSwaps } from '../../utils/statSwaps'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { loadParticipantDigimon } from './combatSpatial'
import { resolveParticipantName } from './participantName'
import { getDigizoidArmorBonus } from './digizoidArmor'
import { getRoomPositions } from './encounterRoom'
import { chebyshev } from './gridDistance'
import { preserveEnduringSoul } from '../../utils/specialOrderCombat'

// Damage over time — [Poison] and [Burn]. Both their damage and their duration countdown are
// resolved here, server-side, so a tick and its countdown always happen together (a 3-round
// Poison ticks exactly 3 times). The client's per-turn countdown in nextTurn() skips them.
//
// - Poison (DDA 1.4): unalterable Wound Box damage equal to the target's CPU at the end of each
//   round. EddySoul `poisonTicksAtTurnEnd`: at the end of the poisoned unit's own turn instead —
//   a partner digimon grouped under its Tamer ticks at the end of the Tamer's turn.
// - Burn (DDA 1.4): 1 damage per meter moved — by choice, Knockback/Pull or being thrown — reduced
//   by Armor, minimum 1 (applyMovementBurn, called by every movement path). A burned digimon that
//   didn't move all round takes Stage Bonus × 2 at the end of the round, also reduced by Armor to
//   a minimum of 1 (house rule `burnStationaryIgnoresArmor`: flat). EddySoul
//   `burnPerTwoSpacesMoved`: 1 damage per 2 spaces moved, ignoring Armor, and nothing for standing
//   still. Movement needs a map, so in a theatre-of-mind encounter Burn only counts down.
//   Naturewalk: Fire is immune (isImmuneToEffect, checked where attacks apply their effect).
//
// Only digimon take the damage: the rules key on CPU / Stage Bonus / "the Digimon". A Tamer's
// Poison/Burn still counts down on the same schedule.

/** The campaign rules Poison/Burn read: two EddySoul rules and a house rule. */
export type DamageOverTimeRules = Pick<EddySoulRules, 'poisonTicksAtTurnEnd' | 'burnPerTwoSpacesMoved'>
  & Pick<HouseRules, 'burnStationaryIgnoresArmor'>

/** The Poison/Burn rules out of a campaign's rules settings. */
export function damageOverTimeRules(settings: Pick<CampaignRulesSettings, 'eddySoulRules' | 'houseRules'> | null | undefined): DamageOverTimeRules {
  return {
    poisonTicksAtTurnEnd: settings?.eddySoulRules?.poisonTicksAtTurnEnd,
    burnPerTwoSpacesMoved: settings?.eddySoulRules?.burnPerTwoSpacesMoved,
    burnStationaryIgnoresArmor: settings?.houseRules?.burnStationaryIgnoresArmor,
  }
}

interface TickContext {
  participants: any[]
  digimonById: Map<string, any>
  round: number
  logEntries: any[]
}

function hasEffect(p: any, name: string): boolean {
  return (p.activeEffects || []).some((e: any) => e.name === name)
}

function hasDamageOverTime(participants: any[]): boolean {
  return participants.some((p: any) => (p.activeEffects || []).some((e: any) => DAMAGE_OVER_TIME_EFFECTS.has(e.name)))
}

function displayName(p: any, participants: any[], digimonById: Map<string, any>): string {
  const record = digimonById.get(p.entityId)
  return resolveParticipantName(p, participants, record?.name, !!(record?.isEnemy ?? p.isEnemy))
}

// Counts the effect down by one and drops it at 0. Returns the remaining duration.
function countDown(p: any, effectName: string): number {
  let remaining = 0
  p.activeEffects = (p.activeEffects || [])
    .map((e: any) => {
      if (e.name !== effectName) return e
      remaining = (e.duration ?? 1) - 1
      return { ...e, duration: remaining }
    })
    .filter((e: any) => e.name !== effectName || e.duration > 0)
  return remaining
}

function roundsLeftNote(effectName: string, remaining: number): string {
  return remaining > 0 ? ` · ${remaining} round${remaining !== 1 ? 's' : ''} left` : ` · ${effectName} wears off`
}

/**
 * Damage that fills Wound Boxes: temporary wounds absorb it first (an emptied Shield is removed),
 * the rest lands on wounds, capped at maxWounds. Mutates `p`.
 */
export function applyWoundDamage(p: any, amount: number): void {
  if (amount <= 0) return
  const previousWounds = p.currentWounds || 0
  const tempAvailable = p.currentTempWounds ?? 0
  const tempAbsorb = Math.min(tempAvailable, amount)
  if (tempAbsorb > 0) {
    p.currentTempWounds = tempAvailable - tempAbsorb
    if (p.currentTempWounds === 0) {
      p.activeEffects = (p.activeEffects || []).filter((e: any) => e.name !== 'Shield')
    }
  }
  p.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + (amount - tempAbsorb))
  preserveEnduringSoul(p, previousWounds)
}

/** Effects a digimon's qualities make it immune to: Naturewalk: Fire can't be [Burned]. */
export function isImmuneToEffect(effectName: string, qualities: any[] | null | undefined): boolean {
  if (effectName === 'Burn') return (qualities || []).some((q: any) => q.id === 'naturewalk' && q.choiceId === 'fire')
  return false
}

/**
 * A digimon's own Armor, for Burn's movement damage: the same terms computeAttackDamage uses for
 * a target's Armor, minus the attack-only ones (clash bonus, Finesse, Tank Buster, Armor Piercing).
 */
export function getBurnArmor(participant: any, record: any): number {
  if (!record) return 0
  const base = record.baseStats
  const bonus = record.bonusStats
  const raw: StatBlock = {
    accuracy: (base?.accuracy ?? 0) + (bonus?.accuracy ?? 0),
    damage: (base?.damage ?? 0) + (bonus?.damage ?? 0),
    dodge: (base?.dodge ?? 0) + (bonus?.dodge ?? 0),
    armor: (base?.armor ?? 0) + (bonus?.armor ?? 0),
  }
  let armor = applyStatSwaps(raw, participant.statSwaps).armor

  const qualities = record.qualities || []
  if (qualities.find((q: any) => q.id === 'data-optimization')?.choiceId === 'guardian') armor += 2
  armor += getDigizoidArmorBonus(qualities).armor
  armor += participant.blackArmorRoundBonus?.armor ?? 0
  armor += getEffectStatModifiers(participant.activeEffects || []).armor
  armor += participant.juggernauntBonuses?.armor ?? 0
  armor += (participant.tormentorBonusStacks ?? 0) * 2
  const mood = participant.moodValue ?? 3
  if (qualities.some((q: any) => q.id === 'positive-reinforcement') && mood <= 2) armor -= 3 - mood

  return Math.max(0, armor)
}

/**
 * Burn damage for one move of `meters` cells: 1 per meter reduced by Armor, minimum 1 — or under
 * EddySoul `burnPerTwoSpacesMoved`, 1 per 2 spaces (rounded down per move), ignoring Armor.
 */
export function burnMovementDamage(meters: number, armor: number, perTwoSpaces: boolean): number {
  if (meters <= 0) return 0
  if (perTwoSpaces) return Math.floor(meters / 2)
  return Math.max(1, meters - armor)
}

export interface UnitMove {
  participantId: string
  /** Cells moved (the Chebyshev step count — server/client pathing is uniform-cost 26-neighbour) */
  meters: number
}

/** One move per participant whose position differs between the two snapshots. */
export function movesFromPositions(before: Record<string, Vec3>, after: Record<string, Vec3>): UnitMove[] {
  const moves: UnitMove[] = []
  for (const [participantId, to] of Object.entries(after)) {
    const from = before[participantId]
    if (!from || !to) continue
    const meters = chebyshev(from, to)
    if (meters > 0) moves.push({ participantId, meters })
  }
  return moves
}

/**
 * Movement during combat: stamps `lastMovedRound` on every unit that moved (Burn's stationary
 * check) and deals Burn's movement damage to burned digimon. Movers get new participant objects;
 * everyone else is returned as-is. `damageById` lets a caller fold the damage into its own log line
 * (Knockback/Pull, Clash throw); `logEntries` are standalone entries for the rest.
 */
export function applyMovementBurn(
  participants: any[],
  moves: UnitMove[],
  opts: { round: number; digimonById: Map<string, any>; rules?: DamageOverTimeRules },
): { participants: any[]; logEntries: any[]; damageById: Record<string, number> } {
  const metersById = new Map<string, number>()
  for (const m of moves) {
    if (m.meters > 0) metersById.set(m.participantId, (metersById.get(m.participantId) ?? 0) + m.meters)
  }
  const logEntries: any[] = []
  const damageById: Record<string, number> = {}
  if (metersById.size === 0) return { participants, logEntries, damageById }

  const perTwoSpaces = !!opts.rules?.burnPerTwoSpacesMoved
  const updated = participants.map((p: any) => {
    const meters = metersById.get(p.id)
    if (meters === undefined) return p
    const next = { ...p, lastMovedRound: opts.round }
    if (next.type !== 'digimon' || !hasEffect(next, 'Burn')) return next

    const armor = perTwoSpaces ? 0 : getBurnArmor(next, opts.digimonById.get(next.entityId))
    const damage = burnMovementDamage(meters, armor, perTwoSpaces)
    if (damage <= 0) return next
    applyWoundDamage(next, damage)
    damageById[next.id] = damage
    const how = perTwoSpaces
      ? `moved ${meters} space${meters !== 1 ? 's' : ''}`
      : `moved ${meters} m${armor > 0 ? `, ${armor} Armor` : ''}`
    logEntries.push({
      id: `log-burn-${next.id}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      round: opts.round,
      actorId: next.id,
      actorName: displayName(next, participants, opts.digimonById),
      action: 'Burn',
      target: null,
      result: `${damage} Burn damage (${how})`,
      damage,
      effects: ['Burn'],
    })
    return next
  })
  return { participants: updated, logEntries, damageById }
}

// One Poison tick: unalterable damage equal to the digimon's current CPU (so Quick-Applied Poison,
// which carries no potency, and a digimon that digivolved since being poisoned both use the right
// value), then the countdown.
async function tickPoison(p: any, ctx: TickContext): Promise<void> {
  const poison = (p.activeEffects || []).find((e: any) => e.name === 'Poison')
  if (!poison) return

  if (p.type !== 'digimon') {
    countDown(p, 'Poison')
    return
  }

  const derived = await getDigimonDerivedStats(p.entityId)
  const damage = Math.max(0, derived?.cpu ?? poison.potency ?? 0)
  applyWoundDamage(p, damage)
  const remaining = countDown(p, 'Poison')

  ctx.logEntries.push({
    id: `log-poison-${p.id}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: ctx.round,
    actorId: p.id,
    actorName: displayName(p, ctx.participants, ctx.digimonById),
    action: 'Poison',
    target: null,
    result: `${damage} Poison damage (CPU)${roundsLeftNote('Poison', remaining)}`,
    damage,
    effects: ['Poison'],
  })
}

// Burn at the end of a round: under the core rule a positioned digimon that didn't move this
// round takes its Stage Bonus × 2, reduced by Armor to a minimum of 1 (house rule
// `burnStationaryIgnoresArmor`: flat), then the countdown.
function tickBurnAtRoundEnd(p: any, ctx: TickContext, positions: Record<string, Vec3> | null | undefined, rules?: DamageOverTimeRules): void {
  const stationary = !rules?.burnPerTwoSpacesMoved
    && p.type === 'digimon'
    && !!positions?.[p.id]
    && p.lastMovedRound !== ctx.round
  const record = ctx.digimonById.get(p.entityId)
  const penalty = stationary ? (STAGE_CONFIG[record?.stage as keyof typeof STAGE_CONFIG]?.stageBonus ?? 0) * 2 : 0
  const armor = penalty > 0 && !rules?.burnStationaryIgnoresArmor ? getBurnArmor(p, record) : 0
  const damage = armor > 0 ? Math.max(1, penalty - armor) : penalty
  applyWoundDamage(p, damage)
  const remaining = countDown(p, 'Burn')
  if (damage <= 0) return

  ctx.logEntries.push({
    id: `log-burn-${p.id}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: ctx.round,
    actorId: p.id,
    actorName: displayName(p, ctx.participants, ctx.digimonById),
    action: 'Burn',
    target: null,
    result: `${damage} Burn damage (didn't move this round: Stage Bonus × 2${armor > 0 ? `, ${armor} Armor` : ''})${roundsLeftNote('Burn', remaining)}`,
    damage,
    effects: ['Burn'],
  })
}

/**
 * Turn end. Only acts under EddySoul `poisonTicksAtTurnEnd`: ticks Poison on the unit whose turn
 * just ended and, when that unit is a Tamer, on its grouped partner digimon (the ones that act on
 * the Tamer's turn — same test as useEncounters' isGroupedUnderTamer). Mutates participants in
 * place and returns them with the battle-log entries.
 */
export async function applyTurnEndEffects(args: {
  participants: any[]
  endedParticipantId: string
  turnOrder: string[]
  round: number
  rules?: DamageOverTimeRules
}): Promise<{ participants: any[]; logEntries: any[] }> {
  const { participants, endedParticipantId, turnOrder, round, rules } = args
  if (!rules?.poisonTicksAtTurnEnd || !hasDamageOverTime(participants)) return { participants, logEntries: [] }

  const ended = participants.find((p: any) => p.id === endedParticipantId)
  if (!ended) return { participants, logEntries: [] }

  const digimonById = await loadParticipantDigimon(participants)
  const ctx: TickContext = { participants, digimonById, round, logEntries: [] }

  const units = [ended]
  if (ended.type === 'tamer') {
    units.push(...participants.filter((p: any) =>
      p.type === 'digimon' && !p.inReserve && !turnOrder.includes(p.id)
      && digimonById.get(p.entityId)?.partnerId === ended.entityId,
    ))
  }
  for (const p of units) await tickPoison(p, ctx)

  return { participants, logEntries: ctx.logEntries }
}

/**
 * Round end (`endingRound` is the round that just finished). Ticks Poison on every participant
 * unless EddySoul `poisonTicksAtTurnEnd` moved it to turn end, and resolves Burn: the stationary
 * penalty (core rule; needs the map `positions` — pass null for a theatre-of-mind encounter) and
 * its countdown. Reserved participants are off the board and skipped. Mutates participants in
 * place and returns them with the battle-log entries.
 */
export async function applyRoundEndEffects(args: {
  participants: any[]
  endingRound: number
  rules?: DamageOverTimeRules
  positions?: Record<string, Vec3> | null
}): Promise<{ participants: any[]; logEntries: any[] }> {
  const { participants, endingRound, rules, positions } = args
  if (!hasDamageOverTime(participants)) return { participants, logEntries: [] }

  const digimonById = await loadParticipantDigimon(participants)
  const ctx: TickContext = { participants, digimonById, round: endingRound, logEntries: [] }

  for (const p of participants) {
    if (p.inReserve) continue
    if (!rules?.poisonTicksAtTurnEnd) await tickPoison(p, ctx)
    if (hasEffect(p, 'Burn')) tickBurnAtRoundEnd(p, ctx, positions, rules)
  }

  return { participants, logEntries: ctx.logEntries }
}

/**
 * Room positions for Burn's stationary penalty — only loaded when it can apply: a map is attached,
 * the core Burn rule is in force and someone is burned. Null otherwise.
 */
export async function loadStationaryBurnPositions(
  encounterId: string,
  mapId: string | null | undefined,
  participants: any[],
  rules?: DamageOverTimeRules,
): Promise<Record<string, Vec3> | null> {
  if (!mapId || rules?.burnPerTwoSpacesMoved) return null
  if (!participants.some((p: any) => !p.inReserve && hasEffect(p, 'Burn'))) return null
  return getRoomPositions(encounterId)
}

/** A campaign's Poison/Burn rules (undefined for an encounter with no campaign). */
export async function loadCampaignDamageOverTimeRules(campaignId: string | null | undefined): Promise<DamageOverTimeRules | undefined> {
  if (!campaignId) return undefined
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  return campaign ? damageOverTimeRules(campaign.rulesSettings) : undefined
}

/**
 * Current round, map and the campaign's Poison/Burn rules for an encounter — for server-side round
 * wraps and movement paths that run outside a request which already loaded the campaign.
 */
export async function loadEncounterRules(encounterId: string): Promise<{ round: number; mapId?: string | null; rules?: DamageOverTimeRules }> {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) return { round: 0 }
  return {
    round: encounter.round ?? 0,
    mapId: (encounter as any).mapId,
    rules: await loadCampaignDamageOverTimeRules(encounter.campaignId),
  }
}

/** Loads the Poison/Burn rules only when there is Poison/Burn to resolve. */
export async function loadDamageOverTimeRules(encounterId: string | undefined, participants: any[]): Promise<DamageOverTimeRules | undefined> {
  if (!encounterId || !hasDamageOverTime(participants)) return undefined
  return (await loadEncounterRules(encounterId)).rules
}

/**
 * Rules and Burn positions for a round wrap that only knows the encounter id (resolveNpcAttack).
 * Pass `positions` when the caller already holds the authoritative ones; otherwise the room's are
 * loaded (only when the stationary penalty can apply). Nothing is loaded without Poison/Burn.
 */
export async function loadRoundEndContext(
  encounterId: string | undefined,
  participants: any[],
  positions?: Record<string, Vec3> | null,
): Promise<{ rules?: DamageOverTimeRules; positions: Record<string, Vec3> | null }> {
  if (!encounterId || !hasDamageOverTime(participants)) return { positions: positions ?? null }
  const { mapId, rules } = await loadEncounterRules(encounterId)
  return {
    rules,
    positions: positions !== undefined ? positions : await loadStationaryBurnPositions(encounterId, mapId, participants, rules),
  }
}
