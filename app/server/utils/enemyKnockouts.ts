import { eq } from 'drizzle-orm'
import { db, encounters, campaigns } from '../db'
import type { GameMap, Vec3 } from '../../types'
import { applyDeferredIntercedeCost, recordTurnStart } from '../../utils/intercedeActions'
import { applyEffectToParticipant } from './applyEffect'
import { resolveParticipantName } from './participantName'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { applyEndOfTurnGravity, computeGravityDrops } from './endOfTurnGravity'
import { loadParticipantDigimon } from './combatSpatial'
import { applyRoundStartQualityTriggers } from './roundStartQualityTriggers'
import { applyRoundEndEffects, loadRoundEndContext } from './damageOverTime'
import { refreshGuidingLightForParticipants } from './guidingLight'
import { autoDevolveParticipant } from './partnerDevolution'
import { applyLagInitiative } from '../../utils/lagInitiative'
import { getRoomDestructibleStates, getDestroyedStructureIds } from './encounterRoom'

// Enemy knockouts. An enemy whose Wound Boxes are all filled leaves the encounter, whatever filled
// them: an attack (resolveNpcAttack), Poison/Burn, a Clash Throw, a fall, interceding or reflected
// damage. A knocked-out enemy instead, in this order:
//   1. devolves, if it digivolved during combat (as resolveNpcAttack's auto-devolve);
//   2. triggers [Time Control], if it's a boss that hasn't used it yet;
//   3. otherwise is removed from participants and turnOrder, and its clash partner is freed.
// Removing the active participant ends its turn and the next one's starts. Past the last slot that
// wraps into a new round (round-end Poison/Burn, the round reset, round-start triggers). An enemy
// knocked out by that round end, or by the fall at the turn change, is resolved the same way.
//
// Partners also devolve when these damage paths knock them out, including partners that entered
// combat already evolved. Their token and turn stay in place. Callers pass only candidates affected
// by their request: unrelated participants already at 0 when it arrived are left alone.

type HouseRulesArg = { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean }
type CampaignLevel = 'standard' | 'enhanced' | 'extreme'

export interface TurnState {
  participants: any[]
  turnOrder: string[]
  currentTurnIndex: number
  round: number
}

export interface KnockoutContext {
  encounterId?: string
  houseRules?: HouseRulesArg
  /** Display names for the log, by participant id (otherwise resolved from the digimon records) */
  names?: Record<string, string>
  /**
   * End-of-turn gravity when a knockout ends the active participant's turn. With `map` + `positions`
   * the drops are computed on those positions and returned as `positionPatch` for the caller to
   * apply; 'room' reads the room's positions and broadcasts the drops itself (applyEndOfTurnGravity).
   * Omitted: no gravity (the caller already ran it for this turn change, or has no map).
   */
  gravity?: { map: GameMap; positions: Record<string, Vec3>; destroyedStructures?: Set<string> } | 'room'
  /** For 'room' gravity; loaded from the encounter when omitted */
  mapId?: string | null
  campaignLevel?: CampaignLevel
}

export interface KnockoutResult extends TurnState {
  logEntries: any[]
  positionPatch?: Record<string, Vec3>
  /** Ids removed from the encounter */
  removedIds: string[]
  /** The active participant was removed and another one's turn started */
  turnAdvanced: boolean
  /** Something changed: a devolve, Time Control or a removal */
  changed: boolean
}

function isKnockedOutEnemy(p: any): boolean {
  return !!p && !!p.isEnemy && !p.inReserve && p.maxWounds > 0 && (p.currentWounds ?? 0) >= p.maxWounds
}

function isKnockedOutDigimon(p: any): boolean {
  return p?.type === 'digimon' && !p.inReserve && p.maxWounds > 0 && (p.currentWounds ?? 0) >= p.maxWounds
}

/** Internal turn-boundary damage checks also include partners. */
function knockedOutDigimonIds(participants: any[]): string[] {
  return participants.filter(isKnockedOutDigimon).map((p: any) => p.id)
}

/** Enemies (not in reserve) whose Wound Boxes are all filled. */
export function knockedOutEnemyIds(participants: any[]): string[] {
  return participants.filter(isKnockedOutEnemy).map((p: any) => p.id)
}

/** Boss quality [Time Control] that hasn't been used yet. */
export function hasUnusedTimeControl(p: any, qualities: any[] | null | undefined): boolean {
  return !!p?.isEnemy && !p.timeControlUsed && (qualities || []).some((q: any) => q.id === 'time-control')
}

/**
 * [Time Control]: "If the Digimon would be defeated due to Wound Boxes reaching 0, negate the
 * effects of that attack and give the Digimon ... additional Wound Boxes equal to their Stage
 * Bonus." Restores the boss to Stage Bonus wound boxes (a fixed 3, covering most boss stages) and
 * gives it +BIT to all stats for the rest of combat.
 */
export async function triggerTimeControl(
  participants: any[],
  targetId: string,
  opts: { round: number; houseRules?: HouseRulesArg; name: string },
): Promise<{ participants: any[]; logEntry: any }> {
  const target = participants.find((p: any) => p.id === targetId)
  const stageBonus = 3  // Default stage bonus; covers most boss stages
  const tcDerived = await getDigimonDerivedStats(target.entityId)
  const bitBonus = tcDerived?.bit ?? 0
  const restoredWounds = Math.max(0, target.maxWounds - stageBonus)

  return {
    participants: participants.map((p: any) => {
      if (p.id !== targetId) return p
      return {
        ...p,
        currentWounds: restoredWounds,
        timeControlUsed: true,
        activeEffects: applyEffectToParticipant(p.activeEffects || [], {
          name: 'Time Control',
          type: 'buff',
          duration: 999,
          source: 'Time Control',
          description: `+${bitBonus} to all stats for the rest of combat.`,
          potency: bitBonus,
          potencyStat: 'bit',
        }, opts.houseRules, []),
      }
    }),
    logEntry: {
      id: `log-${Date.now()}-timecontrol`,
      timestamp: new Date().toISOString(),
      round: opts.round,
      actorId: targetId,
      actorName: opts.name,
      action: 'activates Time Control — the clock rewinds!',
      target: null,
      result: `Restored to ${restoredWounds} wounds. Gains +${bitBonus} to all stats.`,
      damage: null,
      effects: ['Time Control'],
    },
  }
}

// The canonical helper mutates its participant. Keep the caller's original combat state intact.
async function devolveCandidate(
  participants: any[],
  id: string,
  round: number,
): Promise<{ participants: any[]; logEntry: any } | null> {
  const p = participants.find((x: any) => x.id === id)
  if (!p) return null
  const devolved = {
    ...p,
    ...(Array.isArray(p.woundsHistory) ? { woundsHistory: [...p.woundsHistory] } : {}),
  }
  const logEntry = await autoDevolveParticipant(devolved, participants, { round, database: db })
  if (!logEntry) return null

  return {
    participants: participants.map((x: any) => (x.id === id ? devolved : x)),
    logEntry,
  }
}

// The round reset: every participant's actions come back (same rules as the client's round reset).
// Mutates participants in place.
function resetRound(participants: any[]): void {
  participants.forEach((p: any) => {
    const hasteEffect = (p.activeEffects || []).find((e: any) => e.name === 'Haste')
    const hasteGrantsNextRound = !!(hasteEffect && hasteEffect.potency === 1
      && (p.actionsRemaining?.simple ?? 0) > 0)
    p.actionsRemaining = { simple: 2 }
    p.hasActed = false
    p.usedAttackIds = []
    p.hasAttemptedDigivolve = false
    if (!p.stunActionReducedThisRound) {
      const stunEffect = (p.activeEffects || []).find((e: any) => e.name === 'Stun')
      if (stunEffect) p.actionsRemaining.simple = Math.max(0, p.actionsRemaining.simple - 1)
    }
    p.stunActionReducedThisRound = false
    if (hasteGrantsNextRound) p.actionsRemaining.simple += 1
    if (p.clash) {
      const opponent = participants.find((o: any) => o.id === p.clash?.opponentParticipantId)
      const eitherPinned = p.clash.isPinned || opponent?.clash?.isPinned
      p.clash.clashCheckNeeded = !eitherPinned
      p.clash.isPinned = false
    }
    p.usedFreeClashThisRound = false
  })
}

// Starts a participant's turn (the server-side counterpart of the client's activateParticipant).
// Mutates participants in place.
async function startTurn(participants: any[], participantId: string | undefined, round: number): Promise<void> {
  const nextParticipant = participants.find((p: any) => p.id === participantId)
  if (!nextParticipant) return
  for (const p of participants) if (p.strikeFastReady) p.strikeFastReady = false
  nextParticipant.isActive = true
  nextParticipant.dodgePenalty = 0
  nextParticipant.hasDirectedThisTurn = false
  applyDeferredIntercedeCost(nextParticipant, round)
  recordTurnStart(nextParticipant)
  if (nextParticipant.pendingSimpleActionPenalty && nextParticipant.pendingSimpleActionPenalty > 0) {
    nextParticipant.actionsRemaining = nextParticipant.actionsRemaining || { simple: 2 }
    nextParticipant.actionsRemaining.simple = Math.max(
      0,
      nextParticipant.actionsRemaining.simple - nextParticipant.pendingSimpleActionPenalty,
    )
    nextParticipant.pendingSimpleActionPenalty = 0
  }
  if (nextParticipant.type === 'tamer') {
    const digimonById = await loadParticipantDigimon(participants)
    for (const p of participants.filter((p: any) => p.type === 'digimon')) {
      if (digimonById.get(p.entityId)?.partnerId === nextParticipant.entityId) {
        p.dodgePenalty = 0
        applyDeferredIntercedeCost(p, round)
        p.hasActed = false
        break
      }
    }
  }
}

/**
 * Resolves knocked-out enemy and partner candidates (see the top of this file) and, when an enemy
 * was removed from the active slot, starts the next participant's turn. Other ids are ignored.
 * Returns the new turn state; `participants` is a new array.
 */
export async function resolveEnemyKnockouts(
  state: TurnState,
  candidateIds: string[],
  ctx: KnockoutContext = {},
): Promise<KnockoutResult> {
  let participants = [...state.participants]
  let turnOrder = [...state.turnOrder]
  let currentTurnIndex = state.currentTurnIndex
  let round = state.round
  const logEntries: any[] = []
  const removedIds: string[] = []
  let positionPatch: Record<string, Vec3> | undefined
  let changed = false
  let turnAdvanced = false
  // The active participant was removed: whoever now holds its slot hasn't started a turn yet
  let pending = false

  const resolve = async (ids: string[], logRound: number) => {
    const knockedOut = [...new Set(ids)].filter((id) => {
      const p = participants.find((p: any) => p.id === id)
      return isKnockedOutEnemy(p) || isKnockedOutDigimon(p)
    })
    if (knockedOut.length === 0) return
    const digimonById = await loadParticipantDigimon(participants)

    for (const id of knockedOut) {
      const p = participants.find((x: any) => x.id === id)
      if (!isKnockedOutEnemy(p) && !isKnockedOutDigimon(p)) continue
      const record = digimonById.get(p.entityId)
      const name = ctx.names?.[id] ?? resolveParticipantName(p, participants, record?.name, isKnockedOutEnemy(p))

      const isEnemy = isKnockedOutEnemy(p)
      if (!isEnemy && (record?.isEnemy || typeof record?.partnerId !== 'string' || !record.partnerId.trim())) continue

      const devolved = await devolveCandidate(participants, id, logRound)
      if (devolved) {
        participants = devolved.participants
        if (!isEnemy) devolved.logEntry.actorName = name
        logEntries.push(devolved.logEntry)
        changed = true
        continue
      }
      if (!isEnemy) continue

      if (hasUnusedTimeControl(p, record?.qualities)) {
        const timeControl = await triggerTimeControl(participants, id, { round: logRound, houseRules: ctx.houseRules, name })
        participants = timeControl.participants
        logEntries.push(timeControl.logEntry)
        changed = true
        continue
      }

      participants = participants
        .filter((x: any) => x.id !== id)
        // Clear clash state for any participant whose opponent was just removed
        .map((x: any) => (x.clash?.opponentParticipantId === id ? { ...x, clash: null } : x))
      const index = turnOrder.indexOf(id)
      if (index !== -1) {
        turnOrder.splice(index, 1)
        if (index < currentTurnIndex) currentTurnIndex -= 1   // the active participant shifted left a slot
        else if (index === currentTurnIndex) pending = true
      }
      removedIds.push(id)
      changed = true
      logEntries.push({
        id: `log-${Date.now()}-defeated-${id}`,
        timestamp: new Date().toISOString(),
        round: logRound,
        actorId: id,
        actorName: name,
        action: 'was defeated and removed from the encounter!',
        target: null,
        result: 'Defeated',
        damage: null,
        effects: ['Defeated'],
      })
    }
  }

  // Map and campaign level for 'room' gravity, loaded once and only when a turn ends
  let room: { mapId: string | null; campaignLevel: CampaignLevel } | null = null
  const loadRoom = async () => {
    if (room) return room
    let mapId = ctx.mapId
    let campaignLevel = ctx.campaignLevel
    if (mapId === undefined || !campaignLevel) {
      const [encounter] = await db.select().from(encounters).where(eq(encounters.id, ctx.encounterId!))
      if (mapId === undefined) mapId = (encounter as any)?.mapId ?? null
      if (!campaignLevel && encounter?.campaignId) {
        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
        campaignLevel = campaign?.level
      }
    }
    room = { mapId: mapId ?? null, campaignLevel: campaignLevel ?? 'standard' }
    return room
  }

  let destroyedStructures: Set<string> | undefined
  // A true turn boundary: drop airborne non-flyers (fall damage mutates participants)
  const applyGravity = async () => {
    const gravity = ctx.gravity
    if (!gravity) return
    if (gravity !== 'room') {
      const positions = { ...gravity.positions, ...(positionPatch ?? {}) }
      destroyedStructures ??= gravity.destroyedStructures ?? (ctx.encounterId
        ? getDestroyedStructureIds(await getRoomDestructibleStates(ctx.encounterId))
        : new Set())
      const g = await computeGravityDrops(positions, participants, gravity.map, await loadParticipantDigimon(participants), round, destroyedStructures)
      if (Object.keys(g.patch).length > 0) positionPatch = { ...(positionPatch ?? {}), ...g.patch }
      logEntries.push(...g.logEntries)
      return
    }
    if (!ctx.encounterId) return
    const { mapId, campaignLevel } = await loadRoom()
    if (!mapId) return
    const g = await applyEndOfTurnGravity(ctx.encounterId, mapId, participants, round, campaignLevel, ctx.houseRules)
    participants = g.participants
    logEntries.push(...g.logEntries)
  }

  await resolve(candidateIds, round)

  // Each pass starts one turn; a pass only repeats when the participant it started is knocked out
  // in turn (round-end damage or the turn change's fall), so the guard is never reached in play.
  for (let guard = 0; pending && turnOrder.length > 0 && guard < 50; guard++) {
    pending = false
    turnAdvanced = true

    if (currentTurnIndex >= turnOrder.length) {
      // Past the last slot: the round ends (Poison/Burn), then the reset and round-start triggers
      const endingRound = round
      const before = new Set(knockedOutDigimonIds(participants))
      const dot = await loadRoundEndContext(
        ctx.encounterId,
        participants,
        ctx.gravity && ctx.gravity !== 'room' ? { ...ctx.gravity.positions, ...(positionPatch ?? {}) } : undefined,
      )
      const roundEnd = await applyRoundEndEffects({ participants, endingRound, rules: dot.rules, positions: dot.positions })
      participants = roundEnd.participants
      logEntries.push(...roundEnd.logEntries)
      await resolve(knockedOutDigimonIds(participants).filter((id) => !before.has(id)), endingRound)
      if (turnOrder.length === 0) break

      currentTurnIndex = 0
      round = endingRound + 1
      resetRound(participants)
      if (participants.some(participant => participant.lagBaseOrder !== undefined || participant.activeEffects?.some((effect: any) => effect.name === 'Lag'))) {
        turnOrder = applyLagInitiative(participants, turnOrder, round, await loadParticipantDigimon(participants))
      }
      participants = await applyRoundStartQualityTriggers(participants)
    }

    await startTurn(participants, turnOrder[currentTurnIndex], round)

    const before = new Set(knockedOutDigimonIds(participants))
    await applyGravity()
    await resolve(knockedOutDigimonIds(participants).filter((id) => !before.has(id)), round)
  }

  if (turnOrder.length === 0) currentTurnIndex = 0

  // A removal or devolution changes the aura even when no token moved. Keep the refreshed
  // effects in the array the caller saves, using any gravity positions not yet broadcast.
  if (changed) {
    const positions = ctx.gravity && ctx.gravity !== 'room'
      ? { ...ctx.gravity.positions, ...(positionPatch ?? {}) }
      : undefined
    participants = await refreshGuidingLightForParticipants(ctx.encounterId, participants, positions)
  }

  return { participants, turnOrder, currentTurnIndex, round, logEntries, positionPatch, removedIds, turnAdvanced, changed }
}
