import { eq } from 'drizzle-orm'
import { db, encounters, campaigns } from '../db'
import type { EddySoulRules } from '../../types'
import { DAMAGE_OVER_TIME_EFFECTS } from '../../data/attackConstants'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { loadParticipantDigimon } from './combatSpatial'
import { resolveParticipantName } from './participantName'

// Damage over time — [Poison] and [Burn]. Both their damage and their duration countdown are
// resolved here, server-side, so a tick and its countdown always happen together (a 3-round
// Poison ticks exactly 3 times). The client's per-turn countdown in nextTurn() skips them.
//
// - Poison (DDA 1.4): unalterable Wound Box damage equal to the target's CPU at the end of each
//   round. EddySoul `poisonTicksAtTurnEnd`: at the end of the poisoned unit's own turn instead —
//   a partner digimon grouped under its Tamer ticks at the end of the Tamer's turn.
// - Burn: counts down at the end of each round.
//
// Only digimon take the damage: the rules key on CPU / Stage Bonus / "the Digimon". A Tamer's
// Poison/Burn still counts down on the same schedule.

type DamageOverTimeRules = Pick<EddySoulRules, 'poisonTicksAtTurnEnd'>

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

function displayName(p: any, ctx: TickContext): string {
  const record = ctx.digimonById.get(p.entityId)
  return resolveParticipantName(p, ctx.participants, record?.name, !!(record?.isEnemy ?? p.isEnemy))
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

/**
 * Damage that fills Wound Boxes: temporary wounds absorb it first (an emptied Shield is removed),
 * the rest lands on wounds, capped at maxWounds. Mutates `p`.
 */
export function applyWoundDamage(p: any, amount: number): void {
  if (amount <= 0) return
  const tempAvailable = p.currentTempWounds ?? 0
  const tempAbsorb = Math.min(tempAvailable, amount)
  if (tempAbsorb > 0) {
    p.currentTempWounds = tempAvailable - tempAbsorb
    if (p.currentTempWounds === 0) {
      p.activeEffects = (p.activeEffects || []).filter((e: any) => e.name !== 'Shield')
    }
  }
  p.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + (amount - tempAbsorb))
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
    actorName: displayName(p, ctx),
    action: 'Poison',
    target: null,
    result: `${damage} Poison damage (CPU)${remaining > 0 ? ` · ${remaining} round${remaining !== 1 ? 's' : ''} left` : ' · Poison wears off'}`,
    damage,
    effects: ['Poison'],
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
 * unless EddySoul `poisonTicksAtTurnEnd` moved it to turn end, and counts Burn down. Reserved
 * participants are off the board and skipped. Mutates participants in place and returns them
 * with the battle-log entries.
 */
export async function applyRoundEndEffects(args: {
  participants: any[]
  endingRound: number
  rules?: DamageOverTimeRules
}): Promise<{ participants: any[]; logEntries: any[] }> {
  const { participants, endingRound, rules } = args
  if (!hasDamageOverTime(participants)) return { participants, logEntries: [] }

  const digimonById = await loadParticipantDigimon(participants)
  const ctx: TickContext = { participants, digimonById, round: endingRound, logEntries: [] }

  for (const p of participants) {
    if (p.inReserve) continue
    if (!rules?.poisonTicksAtTurnEnd) await tickPoison(p, ctx)
    if (hasEffect(p, 'Burn')) countDown(p, 'Burn')
  }

  return { participants, logEntries: ctx.logEntries }
}

/**
 * Current round and the campaign's EddySoul rules for an encounter — for server-side round wraps
 * that run outside a request which already loaded the campaign.
 */
export async function loadEncounterRules(encounterId: string): Promise<{ round: number; eddySoulRules?: EddySoulRules }> {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) return { round: 0 }
  let eddySoulRules: EddySoulRules | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    eddySoulRules = campaign?.rulesSettings?.eddySoulRules
  }
  return { round: encounter.round ?? 0, eddySoulRules }
}

/** Loads the EddySoul rules only when a round wrap actually has Poison/Burn to resolve. */
export async function loadDamageOverTimeRules(encounterId: string | undefined, participants: any[]): Promise<EddySoulRules | undefined> {
  if (!encounterId || !hasDamageOverTime(participants)) return undefined
  return (await loadEncounterRules(encounterId)).eddySoulRules
}
