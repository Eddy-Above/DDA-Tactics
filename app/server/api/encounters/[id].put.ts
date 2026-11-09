import { autoDevolveParticipant } from '../../utils/partnerDevolution'
import { eq } from 'drizzle-orm'
import { preserveEnduringSouls, combatTurnKey } from '../../../utils/specialOrderCombat'
import { db, encounters, digimon, type Encounter } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'
import { applyEndOfTurnGravity } from '../../utils/endOfTurnGravity'
import { applyRoundStartQualityTriggers } from '../../utils/roundStartQualityTriggers'
import { applyEncounterStartTriggers } from '../../utils/encounterStartTriggers'
import { applyGuidingLightAuras } from '../../utils/guidingLight'
import { applyTurnEndEffects, applyRoundEndEffects, loadStationaryBurnPositions, damageOverTimeRules } from '../../utils/damageOverTime'
import { knockedOutEnemyIds, resolveEnemyKnockouts } from '../../utils/enemyKnockouts'
import { loadCampaignCombatContext } from '../../utils/combatContext'
import { clearTemporaryPasses } from '../../utils/intercedeOptOuts'
import { readCombatRecord, withCombatRecords } from '../../utils/combatRecordCache'
import { loadParticipantDigimon, loadTamersByIds } from '../../utils/combatSpatial'
import { applyLagInitiative } from '../../../utils/lagInitiative'

type UpdateEncounterBody = Partial<Omit<Encounter, 'id' | 'createdAt' | 'updatedAt' | 'revision'>> & { movementActionParticipantId?: string }

export default defineEventHandler(async (event) => withCombatRecords(async () => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateEncounterBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if ('participantPositions' in body || 'destructibleStates' in body) {
    throw createError({
      statusCode: 400,
      message: 'participantPositions and destructibleStates are managed via the encounter WebSocket and cannot be updated via PUT',
    })
  }

  // Check if encounter exists
  const [existing] = await db.select().from(encounters).where(eq(encounters.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  const isCombatStart = existing.phase !== 'combat' && body.phase === 'combat'
  if (body.participants || isCombatStart) {
    // Later checks can restore an earlier form. Load both rosters and their form histories once
    // so gravity, round triggers and aura refreshes share the same request-local records.
    const roster = [...((existing.participants as any[]) || []), ...((body.participants as any[]) || [])]
    const forms = roster.flatMap(p => p.type === 'digimon' && Array.isArray(p.woundsHistory)
      ? p.woundsHistory.flatMap((state: any) => typeof state?.entityId === 'string' && state.entityId
        ? [{ type: 'digimon', entityId: state.entityId }] : [])
      : [])
    const records = await loadParticipantDigimon([...roster, ...forms])
    await loadTamersByIds([...records.values()].flatMap(record => record.partnerId ? [record.partnerId] : []))
  }

  // Intercede opt-outs are written only by the intercede-optouts/intercede-skip endpoints (under a
  // row lock). Ignore them here so a client PUT built from an older copy can't revert them.
  const { intercedeOptOuts: _managedByOptOutEndpoints, revision: _databaseRevision, movementActionParticipantId, ...updatableFields } = body as UpdateEncounterBody & { revision?: unknown }

  const updateData: Partial<Encounter> = {
    ...updatableFields,
    updatedAt: new Date(),
  }

  // Parse existing round for Juggernaut comparison
  const existingRound = typeof existing.round === 'number' ? existing.round : 0
  const incomingRound = typeof body.round === 'number' ? body.round : existingRound
  const isNewRound = incomingRound > existingRound

  // Campaign level + house rules + Poison/Burn rules, used by gravity, damage over time,
  // encounter-start triggers and the final Guiding Light pass below.
  let campaignRules: ReturnType<typeof loadCampaignCombatContext> | undefined
  const getCampaignRules = async () => {
    const context = await (campaignRules ??= loadCampaignCombatContext(existing.campaignId))
    return {
      ...context,
      dotRules: context.rulesSettings ? damageOverTimeRules(context.rulesSettings) : undefined,
    }
  }

  if (body.participants) {
    let participants = body.participants as any[]

    // lastMovedRound is only ever written server-side (the movement paths), so a client copy that
    // hasn't caught up with a move's broadcast must not roll it back — Burn's stationary check
    // below reads it.
    // turnsStarted (the turn counter a "Pass until my next turn" is measured against) is the same:
    // a stale client copy must not roll it back and bring an expired pass back to life.
    const existingById = new Map(((existing.participants as any[]) || []).map((p: any) => [p.id, p]))
    participants = participants.map((p: any) => {
      const stored = existingById.get(p.id)
      let next = p
      if (typeof stored?.lastMovedRound === 'number' && !(p.lastMovedRound >= stored.lastMovedRound)) next = { ...next, lastMovedRound: stored.lastMovedRound }
      if (typeof stored?.turnsStarted === 'number' && !(p.turnsStarted >= stored.turnsStarted)) next = { ...next, turnsStarted: stored.turnsStarted }
      if (stored) {
        // These are server-owned declarations/passives. A stale turn-save cannot restore a spent order.
        next = { ...next }
        for (const field of ['lastMovedTurnKey', 'strikeFastReady', 'strikeFastTurnKey', 'finishingTouchReady', 'decimationReady',
          'enduringSoulAvailable', 'enduringSoulUsed', 'strikeLastCounter', 'fatefulSpentRollIds', 'quickReactionDiceBonus', 'lastShieldRound', 'lagBaseOrder', 'lagOrderRound']) {
          if (Object.prototype.hasOwnProperty.call(stored, field)) next[field] = stored[field]
          else delete next[field]
        }
        const incomingTurnKey = combatTurnKey(incomingRound, body.currentTurnIndex ?? existing.currentTurnIndex ?? 0)
        if (next.strikeFastReady && next.strikeFastTurnKey !== incomingTurnKey) next.strikeFastReady = false
        if (isNewRound) {
          next.activeEffects = [...(next.activeEffects ?? []).filter((effect: any) => effect.name !== 'Lag'),
            ...(stored.activeEffects ?? []).filter((effect: any) => effect.name === 'Lag')]
        }
      }
      return next
    })

    // Card-view movement has no map path, but still proves movement in this turn.
    if (movementActionParticipantId) {
      const mover = participants.find(p => p.id === movementActionParticipantId)
      const stored = existingById.get(movementActionParticipantId)
      const active = existingById.get(existing.turnOrder?.[existing.currentTurnIndex ?? 0])
      let canMove = !!mover && !!stored && !stored.inReserve && stored.id === active?.id
      if (!canMove && mover?.type === 'digimon' && !stored?.inReserve && active?.type === 'tamer') {
        const record = await readCombatRecord('digimon', mover.entityId,
          () => db.select().from(digimon).where(eq(digimon.id, mover.entityId)))
        canMove = record?.partnerId === active.entityId
      }
      if (!canMove || !stored || (stored.actionsRemaining?.simple ?? 0) - (mover?.actionsRemaining?.simple ?? 0) !== 1) {
        throw createError({ statusCode: 400, message: 'Movement requires one action from a character acting this turn' })
      }
      participants = participants.map(p => p.id === movementActionParticipantId ? {
        ...p, lastMovedRound: existingRound, lastMovedTurnKey: combatTurnKey(existingRound, existing.currentTurnIndex ?? 0),
      } : p)
    }

    // Enemies the client sent already knocked out are the GM's call (the GM page removes the ones it
    // knocks out itself); only the ones this request knocks out are resolved below.
    const knockedOutInBody = new Set(knockedOutEnemyIds(participants))

    // End-of-turn gravity: on a real turn advance (a new participant becomes active, or a new round),
    // drop airborne non-flyers and apply fall damage BEFORE the KO/auto-devolve checks below.
    const isTurnAdvance = typeof body.currentTurnIndex === 'number'
      && (body.currentTurnIndex !== existing.currentTurnIndex || incomingRound > existingRound)
    if (isTurnAdvance) {
      const { campaignLevel, houseRules } = await getCampaignRules()
      const gravity = await applyEndOfTurnGravity(id, (existing as any).mapId, participants, incomingRound, campaignLevel, houseRules)
      participants = gravity.participants
      if (gravity.logEntries.length > 0) {
        updateData.battleLog = [...(((body.battleLog as any[]) ?? existing.battleLog ?? []) as any[]), ...gravity.logEntries]
      }
    }

    // Poison/Burn (damage over time): first the turn that just ended (EddySoul turn-end Poison),
    // then the round that just ended. A turn has ended only when the active participant changes
    // (or the round advances) — rebuildTurnOrder() re-anchors on whoever is active, so adding or
    // re-sorting participants doesn't count — and the outgoing participant is still here (removing
    // the active participant ends nobody's turn). Runs before the KO/auto-devolve check below so a
    // partner knocked out by Poison devolves in this same request.
    if (existing.phase === 'combat') {
      const prevTurnOrder = (existing.turnOrder as string[]) || []
      const outgoingId = prevTurnOrder[existing.currentTurnIndex ?? 0]
      const nextTurnOrder = (body.turnOrder as string[] | undefined) ?? prevTurnOrder
      const incomingActiveId = typeof body.currentTurnIndex === 'number' ? nextTurnOrder[body.currentTurnIndex] : outgoingId
      const turnEnded = typeof body.currentTurnIndex === 'number'
        && !!outgoingId
        && (incomingActiveId !== outgoingId || isNewRound)
        && participants.some((p: any) => p.id === outgoingId)
      const roundEnded = isNewRound && existingRound >= 1

      if (turnEnded || roundEnded) {
        const { dotRules } = await getCampaignRules()
        const dotLogEntries: any[] = []
        if (turnEnded) {
          const turnEnd = await applyTurnEndEffects({
            participants, endedParticipantId: outgoingId!, turnOrder: nextTurnOrder, round: existingRound, rules: dotRules,
          })
          participants = turnEnd.participants
          dotLogEntries.push(...turnEnd.logEntries)
        }
        if (roundEnded) {
          const positions = await loadStationaryBurnPositions(id, (existing as any).mapId, participants, dotRules)
          const roundEnd = await applyRoundEndEffects({ participants, endingRound: existingRound, rules: dotRules, positions })
          participants = roundEnd.participants
          dotLogEntries.push(...roundEnd.logEntries)
        }
        if (dotLogEntries.length > 0) {
          updateData.battleLog = [...((updateData.battleLog ?? (body.battleLog as any[]) ?? existing.battleLog ?? []) as any[]), ...dotLogEntries]
        }
      }
    }

    participants = preserveEnduringSouls(participants, existing.participants)

    // Restore one form after direct wound edits or this turn change's damage. The PUT historically
    // saves the new form without adding an Auto-Devolve log entry.
    const autoDevolvedIds = new Set<string>()
    for (const p of participants) {
      if (p.currentWounds >= p.maxWounds && p.evolutionLineId) {
        const devolved = await autoDevolveParticipant(p, participants, { round: incomingRound, database: db })
        if (devolved) autoDevolvedIds.add(p.id)
      }
    }

    // Enemies knocked out by this turn change (the fall, Poison, Burn) leave the encounter. If the
    // incoming participant is one of them, the next one's turn starts instead. No gravity: it already
    // ran for this turn change above.
    if (existing.phase === 'combat') {
      const knockedOut = knockedOutEnemyIds(participants).filter((pid) => !knockedOutInBody.has(pid) && !autoDevolvedIds.has(pid))
      if (knockedOut.length > 0) {
        const { houseRules } = await getCampaignRules()
        const knockout = await resolveEnemyKnockouts({
          participants,
          turnOrder: (body.turnOrder as string[] | undefined) ?? (existing.turnOrder as string[]) ?? [],
          currentTurnIndex: typeof body.currentTurnIndex === 'number' ? body.currentTurnIndex : (existing.currentTurnIndex ?? 0),
          round: incomingRound,
        }, knockedOut, { encounterId: id, houseRules })
        participants = knockout.participants
        if (knockout.changed) {
          updateData.turnOrder = knockout.turnOrder
          updateData.currentTurnIndex = knockout.currentTurnIndex
          updateData.round = knockout.round
          updateData.battleLog = [...((updateData.battleLog ?? (body.battleLog as any[]) ?? existing.battleLog ?? []) as any[]), ...knockout.logEntries]
        }
      }
    }

    // Round-start quality triggers: Juggernaut stacking bonus, Black/Brown Digizoid Armor resets
    if (isNewRound) {
      participants = await applyRoundStartQualityTriggers(participants)
      if (participants.some(participant => participant.lagBaseOrder !== undefined || participant.activeEffects?.some((effect: any) => effect.name === 'Lag'))) {
        const priorOrder = (existing.turnOrder as string[]) ?? []
        const addedIds = ((body.turnOrder as string[] | undefined) ?? []).filter(participantId => !priorOrder.includes(participantId))
        const lagRound = typeof updateData.round === 'number' ? updateData.round : incomingRound
        const turnOrder = applyLagInitiative(participants, [...priorOrder, ...addedIds], lagRound, await loadParticipantDigimon(participants))
        updateData.turnOrder = turnOrder
        updateData.currentTurnIndex = 0
        participants = participants.map(participant => ({ ...participant, isActive: participant.id === turnOrder[0] }))
      }
    }

    updateData.participants = participants
  }

  // Encounter-start triggers: [Challenger] grants temp wounds (via Shield) to eligible partner
  // digimon the moment the encounter's phase transitions into 'combat' for the first time, and
  // again to any partner digimon added as reinforcements after combat has already begun.
  const isReinforcement = !isCombatStart && existing.phase === 'combat' && !!body.participants

  if (isCombatStart || isReinforcement) {
    if (isCombatStart) {
      const { campaignLevel, houseRules } = await getCampaignRules()
      // A fresh combat restarts at round 1: movement stamps from an earlier one mean nothing to Burn
      const basisParticipants = ((updateData.participants as any[] | undefined) ?? (existing.participants as any[]))
        .map(({ lastMovedRound: _previousCombat, lastShieldRound: _previousShieldRound, lagBaseOrder: _previousOrder, lagOrderRound: _previousLagRound, ...p }: any) => ({
          ...p, activeEffects: (p.activeEffects ?? []).filter((effect: any) => effect.name !== 'Lag'),
        }))
      updateData.participants = await applyEncounterStartTriggers(basisParticipants, campaignLevel, houseRules)
    } else {
      const existingIds = new Set(((existing.participants as any[]) || []).map((p) => p.id))
      const newParticipants = (updateData.participants as any[]).filter(
        (p) => p.type === 'digimon' && !p.isEnemy && !existingIds.has(p.id)
      )
      if (newParticipants.length > 0) {
        const { campaignLevel, houseRules } = await getCampaignRules()
        updateData.participants = await applyEncounterStartTriggers(
          updateData.participants as any[],
          campaignLevel,
          houseRules,
          new Set(newParticipants.map((p) => p.id))
        )
      }
    }

  }

  // A roster edit can remove an aura owner/ally, change allegiance or reserve status, or
  // auto-devolve a knocked-out source without moving it. Recompute from the final roster
  // after gravity, knockouts and encounter-start effects, then persist everything together.
  const resultingPhase = updateData.phase ?? existing.phase
  if (resultingPhase === 'ended') {
    updateData.participants = ((updateData.participants ?? existing.participants) as any[]).map(participant => ({
      ...participant, currentTempWounds: 0, activeEffects: (participant.activeEffects ?? []).filter((effect: any) => effect.name !== 'Shield'),
    }))
  }
  if (resultingPhase === 'combat' && (isCombatStart || !!body.participants)) {
    const { campaignLevel, houseRules } = await getCampaignRules()
    const { participantPositions } = await getRoomSnapshot(id)
    const auraResult = await applyGuidingLightAuras(
      (updateData.participants ?? existing.participants) as any[],
      participantPositions,
      campaignLevel,
      houseRules
    )
    if (auraResult.changed) updateData.participants = auraResult.participants
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, id))

  // Passes are per combat: once the encounter is no longer in combat (ended, reopened for setup)
  // none survives, so a later combat in the same encounter starts with everyone prompted again.
  if (resultingPhase !== 'combat' && Object.keys(existing.intercedeOptOuts?.temporaryPasses || {}).length > 0) {
    await clearTemporaryPasses(id)
  }

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, id))

  const room = await getRoomSnapshot(id)

  return {
    ...updated,
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
  }
}))
