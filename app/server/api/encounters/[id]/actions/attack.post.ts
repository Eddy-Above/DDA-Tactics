import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns, type Encounter, type Digimon } from '../../../../db'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { resolveParticipantName } from '../../../../utils/participantName'
import { triggerCounterattack } from '../../../../utils/triggerCounterattack'
import { chebyshev } from '../../../../utils/gridDistance'
import { getFootprintDimensions, getFootprintCells } from '../../../../utils/mapMovement'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'
import { getRoomPositions } from '../../../../utils/encounterRoom'
import type { AreaShapeData } from '~/utils/areaShapes'
import { getAreaShape } from '~/utils/areaShapes'
import { getAttackOrderModifiers, consumeAttackOrders, signatureReadyRound } from '../../../../../utils/specialOrderCombat'
import { combatAttackStats } from '../../../../../utils/combatDice'
import { offerStrikeLastOnMiss } from '../../../../utils/strikeLast'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { effectActionError } from '../../../../../utils/combatAttackOptions'
import { runAttackCommand } from '../../../../utils/attackCommand'
import { allowFields, finiteNumber } from '../../../../utils/securityValidation'
import { commitAttackMovement, grantChargeAfter, finishPassClash, validateAttackTargets, type AttackMovementRequest } from '../../../../utils/attackMovement'
import { resolveAttackOffers } from './intercede-offer.post'
import { BASIC_ATTACKS } from '../../../../../data/attackConstants'

interface AttackActionBody extends AttackMovementRequest {
  participantId: string
  attackId: string
  targetId?: string
  targetIds?: string[]  // Area attack: multiple targets (deducts action once)
  accuracyDicePool: number
  accuracySuccesses: number
  accuracyDiceResults: number[]
  tamerId: string
  attackName?: string
  bolstered?: boolean
  bolsterType?: 'damage-accuracy' | 'bit-cpu'
  lifestealed?: boolean
  shieldComplex?: boolean
  hugePowerUsed?: boolean
  hugePowerRank?: number
  hugePowerTrackAll?: boolean
  hugePowerAttackRange?: 'melee' | 'ranged'
  clashNoInterceptTargetId?: string  // Pass clash attack: this one target (clash opponent) cannot be interceded
  areaShapeData?: AreaShapeData | null  // Snapshot for recomputing AoE cells (Throw Ally Out of Blast)
}

type PreparedAttack =
  | { type: 'resolved'; encounter: Encounter | undefined }
  | { type: 'intercede'; body: Record<string, unknown> }

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<AttackActionBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const hasTarget = !!body.targetId || (body.targetIds && body.targetIds.length > 0)
  if (!body.participantId || !body.attackId || !hasTarget || !body.tamerId ||
      body.accuracyDicePool === undefined || body.accuracySuccesses === undefined ||
      !body.accuracyDiceResults) {
    throw createError({
      statusCode: 400,
      message: 'participantId, attackId, targetId (or targetIds), accuracyDicePool, accuracySuccesses, accuracyDiceResults, and tamerId are required',
    })
  }

  allowFields(body, ['participantId', 'attackId', 'targetId', 'targetIds', 'accuracyDicePool', 'accuracySuccesses', 'accuracyDiceResults', 'tamerId', 'attackName',
    'bolstered', 'bolsterType', 'lifestealed', 'shieldComplex', 'hugePowerUsed', 'hugePowerRank', 'hugePowerTrackAll', 'hugePowerAttackRange',
    'clashNoInterceptTargetId', 'areaShapeData', 'chargeTiming', 'movement', 'operationId', 'expectedRevision'])
  return runAttackCommand(event, encounterId, body, 'attack', async ({ encounter, access }) => {
    validateAttackTargets(encounter, body)
    if (!Array.isArray(body.accuracyDiceResults) || body.accuracyDiceResults.length > 10000) throw createError({ statusCode: 400, message: 'Invalid accuracy dice' })
    body.accuracyDiceResults.forEach(die => finiteNumber(die, 'die', { integer: true, min: 1, max: 6 }))
    finiteNumber(body.accuracyDicePool, 'accuracyDicePool', { integer: true, min: 0, max: 10000 })
    finiteNumber(body.accuracySuccesses, 'accuracySuccesses', { integer: true, min: 0, max: 10000 })
    const actor = encounter.participants.find((p: any) => p.id === body.participantId)
    const [record] = actor?.type === 'digimon' ? await db.select().from(digimon).where(eq(digimon.id, actor.entityId)) : []
    const attack = record?.attacks?.find((a: any) => a.id === body.attackId) ?? BASIC_ATTACKS.find(a => a.id === body.attackId)
    if (!attack) throw createError({ statusCode: 400, message: 'Choose an attack from the current character' })
    const pass = getAreaShape(attack.tags ?? []) === 'pass'
    if (pass && actor?.clash?.isController) body.clashNoInterceptTargetId = actor.clash.opponentParticipantId
    if (body.clashNoInterceptTargetId && (!pass || !actor?.clash?.isController || body.clashNoInterceptTargetId !== actor.clash.opponentParticipantId)) throw createError({ statusCode: 403, message: 'Invalid clash attack context' })
    const moved = await commitAttackMovement(encounter, body.participantId, attack, body, access)
    if (!moved.defeated) {
      const prepared = await prepareAttack(encounterId, body)
      if (prepared.type === 'intercede') await resolveAttackOffers(encounterId, prepared.body as any, { actionsPaid: true })
      await finishPassClash(encounterId, body.participantId, attack)
      await grantChargeAfter(encounterId, body.participantId, attack, body.chargeTiming, encounter)
    }
    const [fresh] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return fresh
  })
})

async function prepareAttack(encounterId: string, body: AttackActionBody): Promise<PreparedAttack> {
  // Fetch encounter only after earlier defense decisions have finished.
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${encounterId} not found`,
    })
  }

  // Fetch campaign to read EddySoul rules
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId!))

  const participants = encounter.participants || []
  const turnOrder = encounter.turnOrder || []
  const battleLog = encounter.battleLog || []
  const pendingRequests = encounter.pendingRequests || []

  // Validate participant exists and is active
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({
      statusCode: 404,
      message: 'Participant not found',
    })
  }

  const orderModifiers = getAttackOrderModifiers(actor)
  if (orderModifiers.suppressPower && body.hugePowerUsed) {
    throw createError({ statusCode: 400, message: 'Huge Power and Overkill cannot trigger with this Special Order' })
  }
  let actorRecord: Digimon | undefined
  if (actor.type === 'digimon') {
    [actorRecord] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    const attack = actorRecord?.attacks?.find((a: any) => a.id === body.attackId)
    if (orderModifiers.successThreshold === 4) body.accuracySuccesses = body.accuracyDiceResults.filter(d => d >= 4).length
      + combatAttackStats(actorRecord, actor, attack).automaticSuccesses
    if (attack?.tags?.some((tag: string) => /signature/i.test(tag)) && encounter.round < signatureReadyRound(actor)) {
      throw createError({ statusCode: 400, message: `Signature Move is available from round ${signatureReadyRound(actor)}` })
    }
  }

  // Check if participant can act (direct turn or partner digimon on tamer's turn)
  const canAct = await canActOnEncounterTurn(actor, {
    participants, turnOrder, currentTurnIndex: encounter.currentTurnIndex,
    actorDigimon: actorRecord ?? null,
  }, id => db.select().from(digimon).where(eq(digimon.id, id)))

  if (!canAct) {
    throw createError({
      statusCode: 403,
      message: 'It is not this participant\'s turn',
    })
  }

  // A Pass clash attack is legitimately made by the clashing controller and routes through this
  // endpoint; it uniquely carries `clashNoInterceptTargetId`. All other attacks by a clashing
  // participant are blocked.
  if (actor.clash && !body.clashNoInterceptTargetId) {
    throw createError({ statusCode: 403, message: 'Cannot use regular attacks while in a clash' })
  }

  // Validate target exists (single-target only; area attack validates targets in intercede-offer)
  const target = body.targetId ? participants.find((p: any) => p.id === body.targetId) : null
  if (body.targetId && !target) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    })
  }

  // === Spatial range validation (skipped if no map attached) ===
  if ((encounter as any).mapId && body.targetId && target && actor.type === 'digimon') {
    const positions: Record<string, { x: number; y: number; z: number }> = await getRoomPositions(encounterId)
    const attackerPos = positions[actor.id]
    const targetPos = positions[target.id]
    if (attackerPos && targetPos) {
      const [attackerDig] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
      if (attackerDig) {
        const derived = await getDigimonDerivedStats(actor.entityId)
        if (!derived) {
          throw createError({ statusCode: 500, message: 'Failed to compute attacker derived stats' })
        }
        const qualities = attackerDig.qualities ?? []
        const reachRanks = (qualities as any[]).find((q: any) => q.id === 'reach')?.ranks ?? 0
        const meleeRange = reachRanks > 0 ? reachRanks * 2 : 1

        // Fetch attack definition to get tags
        const attacks = attackerDig.attacks ?? []
        const attackDef = (attacks as any[]).find((a: any) => a.id === body.attackId)
        const isMelee = attackDef?.range === 'melee'
        const isRanged = attackDef?.range === 'ranged'

        const dist = chebyshev(attackerPos, targetPos)

        if (isMelee) {
          const [targetDig] = target.type === 'digimon'
            ? await db.select().from(digimon).where(eq(digimon.id, target.entityId))
            : []
          const attackerDims = getFootprintDimensions(attackerDig.size as any, (attackerDig as any).giganticDimensions)
          const targetDims = targetDig ? getFootprintDimensions(targetDig.size as any, (targetDig as any).giganticDimensions) : { width: 1, height: 1, depth: 1 }
          const attackerCells = getFootprintCells(attackerPos, attackerDims)
          const targetCells = getFootprintCells(targetPos, targetDims)
          const minMeleeDist = Math.min(...attackerCells.flatMap(a =>
            targetCells.map(t => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y), Math.abs(a.z - t.z)))
          ))
          if (minMeleeDist > meleeRange) {
            throw createError({ statusCode: 400, message: `Target out of melee range (distance: ${minMeleeDist}, reach: ${meleeRange})` })
          }
        }
        if (isRanged && dist > derived.effectiveLimit) {
          throw createError({ statusCode: 400, message: `Target out of effective range (distance: ${dist}, limit: ${derived.effectiveLimit})` })
        }
      }
    }
  }

  // Bolster validation (digimon only)
  if (body.bolstered && actor.type === 'digimon') {
    // Check battle-wide bolster limit (max 2 per digimon per battle)
    if ((actor.digimonBolsterCount ?? 0) >= 2) {
      throw createError({
        statusCode: 403,
        message: 'Digimon has already bolstered the maximum of 2 times this battle',
      })
    }

    // Check BIT/CPU bolster cooldown (once every 2 rounds)
    if (body.bolsterType === 'bit-cpu' && actor.lastBitCpuBolsterRound !== undefined) {
      if (encounter.round - actor.lastBitCpuBolsterRound < 2) {
        throw createError({
          statusCode: 403,
          message: 'BIT/CPU bolster can only be used once every 2 rounds',
        })
      }
    }

    // Check for Signature tag (cannot bolster Signature attacks)
    if (actor.type === 'digimon') {
      const [actorDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
      if (actorDigimon?.attacks) {
        const attacks = actorDigimon.attacks
        const attackDef = attacks?.find((a: any) => a.id === body.attackId)
        if (attackDef?.tags?.some((t: string) => t.toLowerCase().includes('signature'))) {
          throw createError({
            statusCode: 403,
            message: 'Cannot bolster a Signature Move',
          })
        }
      }
    }
  }

  // Cannot bolster and use Lifesteal Complex Action simultaneously
  if (body.bolstered && body.lifestealed) {
    throw createError({
      statusCode: 400,
      message: 'Cannot bolster and use Lifesteal Complex Action simultaneously',
    })
  }

  // Haste/Lag always cost a Complex Action; Shield's optional upgrade also costs two actions.
  let attackHasComplexEffect = false
  let attackIsShield = false
  if (actor.type === 'digimon') {
    const [actorDigimonForHaste] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    if (actorDigimonForHaste?.attacks) {
      const hasteAttacks = actorDigimonForHaste.attacks
      const hasteAttackDef = hasteAttacks?.find((a: any) => a.id === body.attackId)
      const optionError = effectActionError(hasteAttackDef ?? {}, body)
      if (optionError) throw createError({ statusCode: 400, message: optionError })
      attackIsShield = hasteAttackDef?.effect === 'Shield'
      if (attackIsShield && actor.lastShieldRound === encounter.round) {
        throw createError({ statusCode: 403, message: 'Shield can only be used once per round' })
      }
      attackHasComplexEffect = hasteAttackDef?.effect === 'Haste' || hasteAttackDef?.effect === 'Lag'
      if (hasteAttackDef?.effect === 'Haste') {
        if (body.bolstered) {
          throw createError({
            statusCode: 400,
            message: 'Cannot bolster an attack with the Haste effect (already requires Complex Action)',
          })
        }
        if (body.lifestealed) {
          throw createError({
            statusCode: 400,
            message: 'Cannot use Lifesteal Complex Action with Haste (already requires Complex Action)',
          })
        }
      }
    }
  }

  let actionCostSimple = (body.bolstered || body.lifestealed || body.shieldComplex || attackHasComplexEffect) ? 2 : 1
  if (actor.clash) actionCostSimple = Math.max(2, actionCostSimple)

  // EddySoul: Combat Monster + Area Attack requires a Complex Action (unless no bonus)
  const campaignRulesSettings = campaign?.rulesSettings || {}
  const eddySoulRules = campaignRulesSettings?.eddySoulRules
  const houseRules = campaignRulesSettings?.houseRules
  if (eddySoulRules?.combatMonsterAreaAttackRequiresComplex) {
    const combatMonsterBonus = (actor as any).combatMonsterBonus ?? 0
    if (combatMonsterBonus > 0 && actor.type === 'digimon') {
      const [actorDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
      if (actorDigimon?.attacks) {
        const attacks = actorDigimon.attacks
        const attackDef = attacks?.find((a: any) => a.id === body.attackId)
        if (attackDef?.tags?.some((t: string) => t.startsWith('Area Attack'))) {
          if (body.bolstered) {
            throw createError({
              statusCode: 403,
              message: 'Cannot bolster an Area Attack when Combat Monster bonus is active (already requires Complex Action)',
            })
          }
          actionCostSimple = 2
        }
      }
    }
  }

  // [Pass] area attacks require movement, so they cost 2 Simple Actions unless the
  // [Charge Attack] tag is also present (cost 1).
  let isPassWithoutCharge = false
  if (actor.type === 'digimon') {
    const [actorDigimonForPass] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    const attackDef = actorDigimonForPass?.attacks?.find((a: any) => a.id === body.attackId)
    if (attackDef && getAreaShape(attackDef.tags ?? []) === 'pass' && !attackDef.tags?.includes('Charge Attack')) {
      isPassWithoutCharge = true
    }
  }
  if (isPassWithoutCharge) {
    actionCostSimple = Math.max(actionCostSimple, 2)
  }

  // Validate participant has enough actions
  if ((actor.actionsRemaining?.simple || 0) < actionCostSimple) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Detect Signature Move for Battery rule
  let isSignatureMove = false
  let batteryCount = 0
  if (houseRules?.signatureMoveBattery && actor.type === 'digimon') {
    const [actorDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    if (actorDigimon?.attacks) {
      const attacks = actorDigimon.attacks
      const attackDef = attacks?.find((a: any) => a.id === body.attackId)
      if (attackDef?.tags?.some((t: string) => t.toLowerCase().includes('signature'))) {
        isSignatureMove = true
        batteryCount = (actor as any).battery ?? 0
      }
    }
  }

  // Create new participant with decremented actions and tracked used attack
  // Dodge penalty is incremented later when dodge response is processed (responses.post.ts)
  // Also consume any "Directed" effect on the attacker (bonus was applied client-side to accuracy pool)
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      const updated: any = {
        ...consumeAttackOrders(p),
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCostSimple),
        },
        usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
      // Track bolster usage for digimon
      if (attackIsShield) updated.lastShieldRound = encounter.round
      if (body.bolstered && p.type === 'digimon') {
        updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
        if (body.bolsterType === 'bit-cpu') {
          updated.lastBitCpuBolsterRound = encounter.round
        }
      }
      // Track Huge Power usage
      if (body.hugePowerUsed) {
        // Track ranged usage OR EddySoul once-per-turn (any attack)
        if (body.hugePowerAttackRange === 'ranged' || body.hugePowerTrackAll) {
          updated.lastHugePowerRound = encounter.round
        }
        // Track Rank 2 usage (once per round, any attack type)
        if (body.hugePowerRank === 2) {
          updated.lastHugePowerRank2Round = encounter.round
        }
      }
      // Spend Battery if Signature Move
      if (isSignatureMove) {
        updated.battery = 0
        updated.usedSignatureMoveThisTurn = true
      }
      return updated
    }
    return p
  })

  // Resolve actor name
  let actorName = 'Unknown'
  if (actor.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
    actorName = tamerEntity?.name || `Tamer ${actor.entityId}`
  } else if (actor.type === 'digimon') {
    const [actorDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    const baseName = actorDigimon?.name || `Digimon ${actor.entityId}`
    actorName = resolveParticipantName(actor, participants, baseName, actorDigimon?.isEnemy || false)
  }

  // Resolve target name (single-target only)
  let targetName = 'Unknown'
  if (target) {
    if (target.type === 'tamer') {
      const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
      targetName = tamerEntity?.name || `Tamer ${target.entityId}`
    } else if (target.type === 'digimon') {
      const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      const baseName = targetDigimon?.name || `Digimon ${target.entityId}`
      targetName = resolveParticipantName(target, participants, baseName, targetDigimon?.isEnemy || false)
    }
  }

  // Add battle log entry for the attack
  const attackLogEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: actorName,
    action: 'Attack',
    target: body.targetIds ? 'Multiple targets' : targetName,
    result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
    damage: null,
    effects: ['Attack', 'Accuracy Roll'],
    accuracyDicePool: body.accuracyDicePool,
    accuracyDiceResults: body.accuracyDiceResults,
    accuracySuccesses: body.accuracySuccesses,
  }

  const updatedBattleLog = [...battleLog, attackLogEntry]

  // Area attack path: deduct action once, delegate all target resolution to intercede-offer
  if (body.targetIds && body.targetIds.length > 0) {
    if (body.accuracySuccesses === 0) {
      // Auto-miss all targets: save action deduction + log, return without intercede flow
      const missLogEntry = {
        id: `log-${Date.now()}-miss`,
        timestamp: new Date().toISOString(),
        round: encounter.round,
        actorId: actor.id,
        actorName: actorName,
        action: 'Attack Result',
        target: 'Multiple targets',
        result: 'AUTO MISS - 0 accuracy successes',
        damage: 0,
        effects: ['Miss'],
        hit: false,
      }
      updatedBattleLog.push(missLogEntry)
      const missOffers = await offerStrikeLastOnMiss(updatedParticipants, pendingRequests, {
        id: missLogEntry.id, attackerId: actor.id, targetIds: body.targetIds, round: encounter.round,
        attackerName: actorName, attackName: body.attackName || 'Attack',
      }, (campaign?.level ?? 'standard') as any, {
        digimon: async id => (await db.select().from(digimon).where(eq(digimon.id, id)))[0],
        tamer: async id => (await db.select().from(tamers).where(eq(tamers.id, id)))[0],
      })
      await db.update(encounters).set({
        participants: updatedParticipants,
        pendingRequests: missOffers as any,
        battleLog: updatedBattleLog,
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))
      const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      return { type: 'resolved' as const, encounter: updated }
    }

    // Save action deduction and attack log, then delegate to intercede-offer with all targetIds
    await db.update(encounters).set({
      participants: updatedParticipants,
      battleLog: updatedBattleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    return {
      type: 'intercede' as const,
      body: {
        attackerId: body.participantId,
        targetIds: body.targetIds,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDiceResults,
        attackId: body.attackId,
        attackName: body.attackName,
        attackData: { dicePool: body.accuracyDicePool, orderModifiers },
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType,
        lifestealed: body.lifestealed || false,
        shieldComplex: body.shieldComplex || false,
        hugePowerUsed: body.hugePowerUsed || false,
        hugePowerAttackRange: body.hugePowerAttackRange,
        isSignatureMove,
        batteryCount,
        skipActionDeduction: true,
        clashNoInterceptTargetId: body.clashNoInterceptTargetId,
        areaShapeData: body.areaShapeData ?? null,
      },
    }
  }

  // Auto-miss: 0 accuracy successes = automatic miss, no dodge request needed
  if (body.accuracySuccesses === 0) {
    const missLogEntry = {
      id: `log-${Date.now()}-miss`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: actor.id,
      actorName: actorName,
      action: 'Attack Result',
      target: targetName,
      result: 'AUTO MISS - 0 accuracy successes',
      damage: 0,
      effects: ['Miss'],
      hit: false,
    }

    updatedBattleLog.push(missLogEntry)

    const missOffers = await offerStrikeLastOnMiss(updatedParticipants, pendingRequests, {
      id: missLogEntry.id, attackerId: actor.id, targetIds: [body.targetId!], round: encounter.round,
      attackerName: actorName, attackName: body.attackName || 'Attack',
    }, (campaign?.level ?? 'standard') as any, {
      digimon: async id => (await db.select().from(digimon).where(eq(digimon.id, id)))[0],
      tamer: async id => (await db.select().from(tamers).where(eq(tamers.id, id)))[0],
    })

    const updateData: any = {
      participants: updatedParticipants,
      pendingRequests: missOffers,
      battleLog: updatedBattleLog,
      updatedAt: new Date(),
    }

    await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

    // Check for Counterattack quality on the target (the one who was missed)
    if (target && target.type === 'digimon' && !target.usedCounterattackThisCombat) {
      const [tgtDig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      const tgtQualities = tgtDig?.qualities || []
      if ((tgtQualities as any[]).some((q: any) => q.id === 'counterattack')) {
        const freshEnc = await db.select().from(encounters).where(eq(encounters.id, encounterId)).then(r => r[0])
        const caResult = await triggerCounterattack({
          participants: freshEnc.participants,
          battleLog: freshEnc.battleLog,
          pendingRequests: freshEnc.pendingRequests,
          round: encounter.round || 0,
          counterattackerParticipantId: target.id,
          originalAttackerParticipantId: actor.id,
          houseRules,
          turnOrder: freshEnc.turnOrder,
          currentTurnIndex: freshEnc.currentTurnIndex ?? 0,
          encounterId,
        })
        await db.update(encounters).set({
          participants: caResult.participants,
          battleLog: caResult.battleLog,
          pendingRequests: caResult.pendingRequests,
          ...(caResult.turnOrder ? { turnOrder: caResult.turnOrder } : {}),
          ...(caResult.nextTurnIndex !== undefined ? { currentTurnIndex: caResult.nextTurnIndex } : {}),
          ...(caResult.nextRound !== undefined ? { round: caResult.nextRound } : {}),
          updatedAt: new Date(),
        }).where(eq(encounters.id, encounterId))
      }
    }

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

    return { type: 'resolved' as const, encounter: updated }
  }

  // Save validated participants (action deducted) and battle log to DB first
  await db.update(encounters).set({
    participants: updatedParticipants,
    battleLog: updatedBattleLog,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Delegate to intercede-offer endpoint for intercede/dodge/NPC-resolve logic
  // skipActionDeduction=true since we already deducted actions above
  // (clash armor for outside-clash targets is computed at damage time — see utils/clashArmor.ts)
  return {
    type: 'intercede' as const,
    body: {
      attackerId: body.participantId,
      targetId: body.targetId,
      accuracySuccesses: body.accuracySuccesses,
      accuracyDice: body.accuracyDiceResults,
      attackId: body.attackId,
      attackName: body.attackName,
      attackData: {
        dicePool: body.accuracyDicePool,
        orderModifiers,
      },
      bolstered: body.bolstered || false,
      bolsterType: body.bolsterType,
      lifestealed: body.lifestealed || false,
      shieldComplex: body.shieldComplex || false,
      hugePowerUsed: body.hugePowerUsed || false,
      hugePowerAttackRange: body.hugePowerAttackRange,
      isSignatureMove,
      batteryCount,
      skipActionDeduction: true,
    },
  }
}
