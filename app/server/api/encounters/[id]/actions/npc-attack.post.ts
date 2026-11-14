import { autoDevolveParticipant } from '../../../../utils/partnerDevolution'
import { startCleanseCast, recordCleanseOutcome } from '../../../../utils/cleanse'
import { eq } from 'drizzle-orm'
import { getNaturewalkBonuses } from '../../../../../utils/naturewalk'
import { preserveEnduringSouls } from '../../../../../utils/specialOrderCombat'
import { db, encounters, digimon, tamers, campaigns } from '../../../../db'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { EFFECT_ALIGNMENT, BASIC_ATTACKS } from '../../../../../data/attackConstants'
import { STAGE_CONFIG } from '../../../../../types'
import type { DigimonStage, EddySoulRules, HouseRules } from '../../../../../types'
import { applyDeferredIntercedeCost, recordTurnStart } from '../../../../../utils/intercedeActions'
import { resolveParticipantName } from '../../../../utils/participantName'
import { applyEffectToParticipant } from '../../../../utils/applyEffect'
import { getDigimonDerivedStats, calculateEffectPotency } from '../../../../utils/resolveSupportAttack'
import { applyPushPullDisplacement } from '../../../../utils/pushPull'
import { applyEndOfTurnGravity } from '../../../../utils/endOfTurnGravity'
import { applyRoundStartQualityTriggers } from '../../../../utils/roundStartQualityTriggers'
import { applyRoundEndEffects, loadStationaryBurnPositions, isImmuneToEffect, damageOverTimeRules } from '../../../../utils/damageOverTime'
import { knockedOutEnemyIds, resolveEnemyKnockouts } from '../../../../utils/enemyKnockouts'
import { refreshGuidingLightForParticipants } from '../../../../utils/guidingLight'
import { applyLagInitiative } from '../../../../../utils/lagInitiative'
import { loadParticipantDigimon } from '../../../../utils/combatSpatial'
import { attackActionCost, effectActionError, signatureMoveError } from '../../../../../utils/combatAttackOptions'
import { applyPositiveSupportEffect } from '../../../../utils/positiveSupportEffect'
import { applyWoundDamage } from '../../../../utils/damageOverTime'
import { lifestealHealing } from '../../../../../utils/lifesteal'
import { runAttackCommand } from '../../../../utils/attackCommand'
import { allowFields, finiteNumber } from '../../../../utils/securityValidation'
import { commitAttackMovement, grantChargeAfter, validateAttackTargets, type AttackMovementRequest } from '../../../../utils/attackMovement'

interface NpcAttackBody extends AttackMovementRequest {
  lifestealed?: boolean
  shieldComplex?: boolean
  participantId: string
  attackId: string
  targetId: string
  accuracyDicePool: number
  accuracySuccesses: number
  accuracyDiceResults: number[]
  dodgeDicePool: number
  dodgeSuccesses: number
  dodgeDiceResults: number[]
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<NpcAttackBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.participantId || !body.attackId || !body.targetId ||
      body.accuracyDicePool === undefined || body.accuracySuccesses === undefined || !body.accuracyDiceResults ||
      body.dodgeDicePool === undefined || body.dodgeSuccesses === undefined || !body.dodgeDiceResults) {
    throw createError({
      statusCode: 400,
      message: 'participantId, attackId, targetId, and all accuracy/dodge dice data (dicePool, successes, diceResults) are required',
    })
  }

  allowFields(body, ['participantId', 'attackId', 'targetId', 'accuracyDicePool', 'accuracySuccesses', 'accuracyDiceResults',
    'dodgeDicePool', 'dodgeSuccesses', 'dodgeDiceResults', 'lifestealed', 'shieldComplex', 'operationId', 'expectedRevision', 'chargeTiming', 'movement', 'areaShapeData'])
  return runAttackCommand(event, encounterId, body, 'npc-attack', async ({ encounter, access }) => {
    validateAttackTargets(encounter, body)
    const actor = encounter.participants.find((p: any) => p.id === body.participantId)
    const [record] = actor?.type === 'digimon' ? await db.select().from(digimon).where(eq(digimon.id, actor.entityId)) : []
    const attack = record?.attacks?.find((a: any) => a.id === body.attackId) ?? BASIC_ATTACKS.find(a => a.id === body.attackId)
    if (!attack) throw createError({ statusCode: 400, message: 'Choose an attack from the current character' })
    for (const key of ['accuracyDicePool', 'accuracySuccesses', 'dodgeDicePool', 'dodgeSuccesses'] as const) finiteNumber(body[key], key, { integer: true, min: 0, max: 10000 })
    for (const dice of [body.accuracyDiceResults, body.dodgeDiceResults]) {
      if (!Array.isArray(dice) || dice.length > 10000) throw createError({ statusCode: 400, message: 'Invalid dice' })
      dice.forEach(die => finiteNumber(die, 'die', { integer: true, min: 1, max: 6 }))
    }
    const moved = await commitAttackMovement(encounter, body.participantId, attack, body, access)
    if (!moved.defeated) {
      await resolveNpcAttackBody(encounterId, body)
      await grantChargeAfter(encounterId, body.participantId, attack, body.chargeTiming, encounter)
    }
    const [fresh] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return fresh
  })
})

async function resolveNpcAttackBody(encounterId: string, body: NpcAttackBody) {
  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${encounterId} not found`,
    })
  }

  // Fetch house rules from campaign
  let houseRules: HouseRules | undefined
  let eddySoulRules: EddySoulRules | undefined
  let campaignLevel: 'standard' | 'enhanced' | 'extreme' = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      houseRules = campaign.rulesSettings.houseRules
      eddySoulRules = campaign.rulesSettings.eddySoulRules
      if (campaign.level) campaignLevel = campaign.level
    }
  }

  const participants = encounter.participants || []
  // Enemies already knocked out when the request arrived, which the knockout check before the save
  // leaves alone. Taken here: the round wrap below mutates participant objects in place.
  const knockedOutBefore = new Set(knockedOutEnemyIds(participants))
  const turnOrder = encounter.turnOrder || []
  const battleLog = encounter.battleLog || []

  // Validate attacker
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({
      statusCode: 404,
      message: 'Attacker not found',
    })
  }

  // Validate attacker can act (direct turn or partner digimon on tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const canAct = await canActOnEncounterTurn(actor, {
    participants, turnOrder, currentTurnIndex: currentIndex,
  }, id => db.select().from(digimon).where(eq(digimon.id, id)))

  if (!canAct) {
    throw createError({
      statusCode: 403,
      message: 'It is not this participant\'s turn',
    })
  }

  // Validate target
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    })
  }

  // Check actions
  const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
  const declaredAttack = attackerDigimon?.attacks?.find((attack: any) => attack.id === body.attackId)
  const signatureError = signatureMoveError(actor, declaredAttack, { round: encounter.round, houseRules })
  if (signatureError) throw createError({ statusCode: 400, message: signatureError })
  const isSignatureMove = !!houseRules?.signatureMoveBattery && !!declaredAttack?.tags?.some((tag: string) => /signature/i.test(tag))
  const batteryCount = isSignatureMove ? actor.battery ?? 0 : 0
  const optionError = effectActionError(declaredAttack ?? {}, body)
  if (optionError) throw createError({ statusCode: 400, message: optionError })
  if (declaredAttack?.effect === 'Shield' && actor.lastShieldRound === encounter.round) throw createError({ statusCode: 403, message: 'Shield can only be used once per round' })
  const actionCost = attackActionCost(actor, declaredAttack ?? {}, eddySoulRules, body)
  if ((actor.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Decrement attacker actions, track used attack, and increment target dodge penalty
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost),
        },
        usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
        ...(isSignatureMove ? { battery: 0, usedSignatureMoveThisTurn: true } : {}),
        ...(declaredAttack?.effect === 'Shield' ? { lastShieldRound: encounter.round } : {}),
        // Consume Directed effect on attacker (bonus was applied client-side to accuracy pool by GM)
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
    }
    if (p.id === body.targetId) {
      return {
        ...p,
        dodgePenalty: (p.dodgePenalty ?? 0) + 1,
        // Consume Directed effect (bonus was applied client-side to dodge pool by GM)
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
    }
    return p
  })

  // Compare successes and calculate outcome
  const netSuccesses = body.accuracySuccesses - body.dodgeSuccesses
  const hit = netSuccesses >= 0

  // Look up attacker's digimon to get base damage and attack definition
  let attackBaseDamage = 0
  let armorPiercing = 0
  let npcAttackDef: any = null
  if (attackerDigimon) {
    const baseStats = attackerDigimon.baseStats
    const bonusStats = (attackerDigimon as any).bonusStats

    // Base damage comes from digimon stats
    attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0) + batteryCount

    // Parse attacks array to get tag bonuses
    if (attackerDigimon.attacks) {
      const attacks = attackerDigimon.attacks

      const attackDef = attacks?.find((a: any) => a.id === body.attackId)
      npcAttackDef = attackDef

      if (attackDef?.tags && Array.isArray(attackDef.tags)) {
        for (const tag of attackDef.tags) {
          // Weapon tags add to both accuracy AND damage
          const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
          if (weaponMatch) {
            const rankStr = weaponMatch[1]
            const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
            const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
            attackBaseDamage += rank  // Add weapon rank to damage
          }

          // Extract Armor Piercing from tags
          const apMatch = tag.match(/^Armor Piercing\s+(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)$/i)
          if (apMatch) {
            const rankStr = apMatch[1]
            const romanMap: Record<string, number> = {
              'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
              'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
            }
            const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 0
            armorPiercing = rank * 2  // Each rank ignores 2 armor
          }
        }
      }
    }
  }

  const targetDigimon: any = target.type === 'digimon'
    ? (await db.select().from(digimon).where(eq(digimon.id, target.entityId)))[0] : null
  const targetQualities = targetDigimon?.qualities ?? []
  const effectBlocked = targetQualities.some((quality: any) => quality.id === 'immunity')
    || !!(npcAttackDef?.effect && isImmuneToEffect(npcAttackDef.effect, targetQualities))

  const sourceEffectPotency = ['Taunt', 'Fear', 'Lifesteal', 'Shield', 'Lag'].includes(npcAttackDef?.effect)
    ? calculateEffectPotency(npcAttackDef.effect, await getDigimonDerivedStats(actor.entityId, actor), null)
    : null
  if (npcAttackDef?.effect === 'Shield' && body.shieldComplex && sourceEffectPotency) sourceEffectPotency.potency *= 3
  if (sourceEffectPotency) sourceEffectPotency.potency += batteryCount

  const pendingRequests = [...(encounter.pendingRequests ?? [])]
  const cleanseCastId = npcAttackDef?.effect === 'Cleanse' && hit && !effectBlocked ? startCleanseCast(pendingRequests, {
    attackerId: actor.id, attackerName: attackerDigimon?.name ?? 'Digimon', attackName: npcAttackDef.name,
    attackerIsEnemy: !!actor.isEnemy, potency: Math.max(0, (await getDigimonDerivedStats(actor.entityId, actor))?.bit ?? 0),
    isArea: false, selectiveTargeting: false, targetIds: [target.id], ownerId: attackerDigimon?.partnerId ?? 'GM',
  }) : undefined

  // Support attack: skip damage, apply effect only, return early
  if (npcAttackDef?.type === 'support') {
    recordCleanseOutcome(pendingRequests, cleanseCastId, target.id, target, netSuccesses, hit && !effectBlocked)
    let appliedEffectName: string | null = null
    // Digimon are not in turnOrder — use their partner Tamer's position instead.
    const targetParticipantForTurn = participants.find((p: any) => p.id === body.targetId)
    let targetHasGone = false
    if (targetParticipantForTurn?.type === 'tamer') {
      const idx = turnOrder.indexOf(targetParticipantForTurn.id)
      targetHasGone = idx >= 0 && idx < currentIndex
    } else if (targetParticipantForTurn?.type === 'digimon') {
      const targetDigimonForTurn = targetDigimon
      if (targetDigimonForTurn?.partnerId) {
        const tamerOfTarget = participants.find((p: any) => p.type === 'tamer' && p.entityId === targetDigimonForTurn.partnerId)
        if (tamerOfTarget) {
          const idx = turnOrder.indexOf(tamerOfTarget.id)
          targetHasGone = idx >= 0 && idx < currentIndex
        }
      } else {
        // NPC digimon — appears in turnOrder directly
        const idx = turnOrder.indexOf(targetParticipantForTurn.id)
        targetHasGone = idx >= 0 && idx < currentIndex
      }
    }
    let supportParticipants = updatedParticipants.map((p: any) => {
      if (p.id === body.targetId && hit && npcAttackDef.effect && !effectBlocked) {
        const effectDuration = Math.max(1, netSuccesses)
        const alignment = EFFECT_ALIGNMENT[npcAttackDef.effect]
        const effectType: 'buff' | 'debuff' | 'status' = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
        const newEffect = {
          id: `effect-${Date.now()}`,
          name: npcAttackDef.effect,
          type: effectType,
          duration: effectDuration,
          source: ['Taunt', 'Fear'].includes(npcAttackDef.effect) ? actor.id : 'Attack',
          description: '',
          ...(sourceEffectPotency ?? {}),
        }
        appliedEffectName = npcAttackDef.effect
        const stunImmediate = npcAttackDef.effect === 'Stun' && !targetHasGone
        const stunDeferred = npcAttackDef.effect === 'Stun' && targetHasGone
        if (newEffect.name === 'Shield' || newEffect.name === 'Haste') return applyPositiveSupportEffect(p, newEffect, houseRules, targetQualities)
        return {
          ...p,
          activeEffects: applyEffectToParticipant(p.activeEffects || [], newEffect, houseRules, targetQualities, encounter.round, p.naturewalkActiveElements),
          ...(stunImmediate
            ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }, stunActionReducedThisRound: true }
            : stunDeferred
              ? { interceptPenalty: (p.interceptPenalty || 0) + 1, stunActionReducedThisRound: true }
              : {}),
        }
      }
      return p
    })

    // Knockback / Pull: displace the target on the map (support-attack path).
    let supportPushLogNote: string | null = null
    if ((appliedEffectName === 'Knockback' || appliedEffectName === 'Pull') && (encounter as any).mapId) {
      const atkDerived = actor.type === 'digimon' ? await getDigimonDerivedStats(actor.entityId) : null
      const { potency } = calculateEffectPotency(appliedEffectName, atkDerived, null)
      const disp = await applyPushPullDisplacement({
        encounterId,
        mapId: (encounter as any).mapId,
        participants: supportParticipants,
        attackerParticipantId: actor.id,
        targetParticipantId: body.targetId,
        effect: appliedEffectName,
        distance: potency + batteryCount,
        campaignLevel,
        houseRules,
      })
      supportParticipants = disp.participants
      supportPushLogNote = disp.logNote
    }

    // Resolve names
    let supportAttackerName = 'Unknown'
    if (actor.type === 'tamer') {
      const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
      supportAttackerName = tamerEntity?.name || `Tamer ${actor.entityId}`
    } else if (actor.type === 'digimon') {
      const baseDigimonName = attackerDigimon?.name || `Digimon ${actor.entityId}`
      supportAttackerName = resolveParticipantName(actor, participants, baseDigimonName, attackerDigimon?.isEnemy || false)
    }

    let supportTargetName = 'Unknown'
    if (target.type === 'tamer') {
      const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
      supportTargetName = targetTamer?.name || `Tamer ${target.entityId}`
    } else if (target.type === 'digimon') {
      const [tgt] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      const baseName = tgt?.name || `Digimon ${target.entityId}`
      supportTargetName = resolveParticipantName(target, participants, baseName, tgt?.isEnemy || false)
    }

    const supportAttackLog = {
      id: `log-${Date.now()}-attack`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: actor.id,
      actorName: supportAttackerName,
      action: 'Attack',
      target: supportTargetName,
      result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
      damage: null,
      effects: ['Attack'],
    }

    const supportDodgeLog = {
      id: `log-${Date.now() + 1}-dodge`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: target.id,
      actorName: supportTargetName,
      action: 'Dodge (Support)',
      target: null,
      result: `${body.dodgeDicePool}d6 => [${body.dodgeDiceResults.join(',')}] = ${body.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
      damage: 0,
      effects: [
        'Dodge',
        ...(appliedEffectName ? [`Applied: ${appliedEffectName}`] : []),
        ...(supportPushLogNote ? [supportPushLogNote] : []),
      ],
      hit,
    }

    await db.update(encounters).set({
      pendingRequests,
      participants: supportParticipants,
      battleLog: [...battleLog, supportAttackLog, supportDodgeLog],
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [supportUpdated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return supportUpdated
  }

  // Combat Monster for attacker
  let attackerHasCombatMonster = false
  let attackerHealthStat = 0
  let attackerCombatMonsterBonus = 0
  if (attackerDigimon) {
    const baseStats = attackerDigimon.baseStats
    const bonusStats = (attackerDigimon as any).bonusStats
    attackerHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

    const attackerQualities = attackerDigimon.qualities
    attackerHasCombatMonster = (attackerQualities || []).some((q: any) => q.id === 'combat-monster')
    attackerCombatMonsterBonus = actor.combatMonsterBonus ?? 0
  }

  // Use the same target record for armor and incoming-effect immunity.
  let targetArmor = 0
  if (target.type === 'digimon') {
    if (targetDigimon) {
      const targetBaseStats = targetDigimon.baseStats
      const targetBonusStats = (targetDigimon as any).bonusStats

      targetArmor = (targetBaseStats?.armor ?? 0) + (targetBonusStats?.armor ?? 0)

      // Add Guardian data optimization bonus (+2 armor)
      const targetQualities = targetDigimon.qualities
      const targetDataOpt = targetQualities?.find((q: any) => q.id === 'data-optimization')
      if (targetDataOpt?.choiceId === 'guardian') {
        targetArmor += 2
      }

      // Store for Combat Monster
      targetDigimon._hasComputedHealthAndQualities = true
      targetDigimon._healthStat = (targetBaseStats?.health ?? 0) + (targetBonusStats?.health ?? 0)
      targetDigimon._hasCombatMonster = (targetQualities || []).some((q: any) => q.id === 'combat-monster')
    }
  } else if (target.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    if (targetTamer) {
      const attrs = targetTamer.attributes
      const skills = targetTamer.skills
      targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
    }
  }

  // Calculate damage with armor and minimum damage of 1 on successful hits
  const attackerNaturewalk = getNaturewalkBonuses(attackerDigimon?.qualities, actor.naturewalkActiveElements)
  attackBaseDamage += attackerNaturewalk.damageBonus
  armorPiercing += attackerNaturewalk.armorPiercingRanks * 2
  targetArmor += target.type === 'digimon' ? getNaturewalkBonuses(targetDigimon?.qualities, target.naturewalkActiveElements).armorBonus : 0
  let damageDealt = 0
  if (hit) {
    // Apply Combat Monster bonus from attacker
    if (attackerHasCombatMonster && attackerCombatMonsterBonus > 0) {
      attackBaseDamage += attackerCombatMonsterBonus
    }

    const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
    damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
  }

  // Apply damage to target and auto-apply attack effects
  recordCleanseOutcome(pendingRequests, cleanseCastId, target.id, target, netSuccesses, hit && damageDealt >= 2 && !effectBlocked)
  let appliedEffectName: string | null = null
  let finalParticipants = updatedParticipants.map((p: any) => {
    // Handle attacker: reset Combat Monster bonus on hit
    if (p.id === body.participantId && p.id !== body.targetId && hit) {
      const healing = npcAttackDef?.effect === 'Lifesteal' && !effectBlocked ? lifestealHealing(damageDealt, sourceEffectPotency?.potency ?? 0, body.lifestealed) : 0
      return { ...p, ...(attackerHasCombatMonster ? { combatMonsterBonus: 0 } : {}), currentWounds: Math.max(0, (p.currentWounds ?? 0) - healing) }
    }

    // Handle target: apply damage and Combat Monster accumulation
    if (p.id === body.targetId && hit) {
      const updated: any = { ...p }
      const woundDamage = Math.max(0, damageDealt - (p.currentTempWounds ?? 0))
      applyWoundDamage(updated, damageDealt)

      // Accumulate Combat Monster bonus for target
      if (targetDigimon?._hasCombatMonster) {
        updated.combatMonsterBonus = Math.min(
          p.totalHealth ?? p.maxWounds,
          (p.combatMonsterBonus ?? 0) + woundDamage
        )
      }

      // Immunity also blocks instant-effect side effects such as displacement and Stun action costs.
      if (npcAttackDef?.effect && !effectBlocked) {
        const shouldApply = npcAttackDef.type === 'damage' ? damageDealt >= 2 : true
        if (shouldApply) {
          const effectDuration = Math.max(1, netSuccesses)
          const alignment = EFFECT_ALIGNMENT[npcAttackDef.effect]
          const effectType: 'buff' | 'debuff' | 'status' = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
          const newEffect = {
            id: `effect-${Date.now()}`,
            name: npcAttackDef.effect,
            type: effectType,
            duration: effectDuration,
            source: ['Taunt', 'Fear'].includes(npcAttackDef.effect) ? actor.id : 'Attack',
            description: '',
            ...(sourceEffectPotency ?? {}),
          }
          if (newEffect.name === 'Shield' || newEffect.name === 'Haste') Object.assign(updated, applyPositiveSupportEffect(updated, newEffect, houseRules, targetQualities))
          else updated.activeEffects = applyEffectToParticipant(updated.activeEffects || [], newEffect, houseRules, targetQualities, encounter.round, p.naturewalkActiveElements)
          appliedEffectName = npcAttackDef.effect
          // Stun: immediately reduce actions if target hasn't taken their turn yet this round
          if (npcAttackDef.effect === 'Stun' && !p.hasActed) {
            updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
            updated.stunActionReducedThisRound = true
          }
        }
      }

      return updated
    }
    return p
  })

  finalParticipants = preserveEnduringSouls(finalParticipants, participants)

  // Knockback / Pull: displace the target on the map (damage-attack path). Runs before the
  // auto-devolve / defeat / gravity checks so those see the post-displacement state.
  let npcPushLogNote: string | null = null
  if (hit && (appliedEffectName === 'Knockback' || appliedEffectName === 'Pull') && (encounter as any).mapId) {
    const atkDerived = actor.type === 'digimon' ? await getDigimonDerivedStats(actor.entityId) : null
    const { potency } = calculateEffectPotency(appliedEffectName, atkDerived, null)
    const disp = await applyPushPullDisplacement({
      encounterId,
      mapId: (encounter as any).mapId,
      participants: finalParticipants,
      attackerParticipantId: actor.id,
      targetParticipantId: body.targetId,
      effect: appliedEffectName,
      distance: potency + batteryCount,
      campaignLevel,
      houseRules,
    })
    finalParticipants = disp.participants
    npcPushLogNote = disp.logNote
  }

  const damagedTarget = finalParticipants.find((p: any) => p.id === body.targetId)
  const autoDevolveLog = damagedTarget && hit
    ? await autoDevolveParticipant(damagedTarget, finalParticipants, { round: encounter.round, database: db })
    : null

  // Remove defeated NPC from encounter
  let npcDefeatedLog: any = null
  let updatedTurnOrder = turnOrder
  let finalParticipantsAfterDefeat = finalParticipants
  let npcDefeatNextTurnIndex: number | undefined
  let npcDefeatNextRound: number | undefined
  let gravityLogEntries: any[] = []
  let roundEndLogEntries: any[] = []
  if (damagedTarget && hit &&
      damagedTarget.currentWounds >= damagedTarget.maxWounds &&
      damagedTarget.isEnemy &&
      !autoDevolveLog) {
    const currentTurnIndex = encounter.currentTurnIndex ?? 0
    const defeatedIndexInTurnOrder = turnOrder.indexOf(body.targetId)
    const defeatedWasCurrentTurn = defeatedIndexInTurnOrder !== -1 && defeatedIndexInTurnOrder === currentTurnIndex

    // Filter out defeated NPC from participants
    finalParticipantsAfterDefeat = finalParticipants.filter((p: any) => p.id !== body.targetId)
    // Clear clash state for any participant whose opponent was just removed
    finalParticipantsAfterDefeat = finalParticipantsAfterDefeat.map((p: any) =>
      p.clash?.opponentParticipantId === body.targetId ? { ...p, clash: null } : p
    )
    // Filter out defeated NPC from turn order
    updatedTurnOrder = turnOrder.filter((id: string) => id !== body.targetId)

    // If defeated NPC was the active turn participant, auto-advance to the next
    if (defeatedWasCurrentTurn && updatedTurnOrder.length > 0) {
      const isRoundWrap = currentTurnIndex >= updatedTurnOrder.length
      npcDefeatNextTurnIndex = isRoundWrap ? 0 : currentTurnIndex
      npcDefeatNextRound = isRoundWrap ? (encounter.round ?? 0) + 1 : undefined

      if (isRoundWrap) {
        // Round end: Poison/Burn for the round that just finished, before the reset
        const dotRules = damageOverTimeRules({ houseRules, eddySoulRules })
        const roundEnd = await applyRoundEndEffects({
          participants: finalParticipantsAfterDefeat,
          endingRound: encounter.round ?? 0,
          rules: dotRules,
          positions: await loadStationaryBurnPositions(encounterId, (encounter as any).mapId, finalParticipantsAfterDefeat, dotRules),
        })
        finalParticipantsAfterDefeat = roundEnd.participants
        roundEndLogEntries = roundEnd.logEntries

        finalParticipantsAfterDefeat.forEach((p: any) => {
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
            const opponent = finalParticipantsAfterDefeat.find((o: any) => o.id === p.clash?.opponentParticipantId)
            const eitherPinned = p.clash.isPinned || opponent?.clash?.isPinned
            p.clash.clashCheckNeeded = !eitherPinned
            p.clash.isPinned = false
          }
          p.usedFreeClashThisRound = false
        })

        // Round-start quality triggers: Juggernaut stacking bonus, Black/Brown Digizoid Armor resets
        if (finalParticipantsAfterDefeat.some((participant: any) => participant.lagBaseOrder !== undefined || participant.activeEffects?.some((effect: any) => effect.name === 'Lag'))) {
          updatedTurnOrder = applyLagInitiative(finalParticipantsAfterDefeat, updatedTurnOrder, npcDefeatNextRound!, await loadParticipantDigimon(finalParticipantsAfterDefeat))
        }
        finalParticipantsAfterDefeat = await applyRoundStartQualityTriggers(finalParticipantsAfterDefeat)
      }

      const nextParticipantId = updatedTurnOrder[npcDefeatNextTurnIndex]
      const nextParticipant = finalParticipantsAfterDefeat.find((p: any) => p.id === nextParticipantId)
      if (nextParticipant) {
        nextParticipant.isActive = true
        nextParticipant.dodgePenalty = 0
        nextParticipant.hasDirectedThisTurn = false
        applyDeferredIntercedeCost(nextParticipant, npcDefeatNextRound ?? encounter.round ?? 0)
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
          for (const p of finalParticipantsAfterDefeat.filter((p: any) => p.type === 'digimon')) {
            const [dig] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
            if (dig?.partnerId === nextParticipant.entityId) {
              p.dodgePenalty = 0
              applyDeferredIntercedeCost(p, npcDefeatNextRound ?? encounter.round ?? 0)
              p.hasActed = false
              break
            }
          }
        }
      }

      // True turn boundary: the defeated NPC's turn ended and a new participant is active.
      // Drop airborne non-flyers and apply fall damage.
      const npcGravity = await applyEndOfTurnGravity(
        encounterId,
        (encounter as any).mapId,
        finalParticipantsAfterDefeat,
        npcDefeatNextRound ?? encounter.round ?? 0,
        campaignLevel,
        houseRules,
      )
      finalParticipantsAfterDefeat = npcGravity.participants
      gravityLogEntries = npcGravity.logEntries
    } else if (defeatedIndexInTurnOrder !== -1 && defeatedIndexInTurnOrder < currentTurnIndex) {
      // The active participant shifted left by one slot; same person remains active
      npcDefeatNextTurnIndex = currentTurnIndex - 1
    }

    const targetNameForLog = target.type === 'digimon'
      ? resolveParticipantName(target, participants, targetDigimon?.name || 'Digimon', targetDigimon?.isEnemy || false)
      : (target.type === 'tamer' ? targetDigimon?.name || 'Tamer' : 'Unknown')
    npcDefeatedLog = {
      id: `log-${Date.now()}-defeated`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: body.targetId,
      actorName: targetNameForLog,
      action: 'was defeated and removed from the encounter!',
      target: null,
      result: 'Defeated',
      damage: null,
      effects: ['Defeated'],
    }
  }

  // Get attacker name
  let attackerName = 'Unknown'
  if (actor.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
    attackerName = tamerEntity?.name || `Tamer ${actor.entityId}`
  } else if (actor.type === 'digimon') {
    // We already queried attackerDigimon above, reuse it
    const baseDigimonName = attackerDigimon?.name || `Digimon ${actor.entityId}`
    attackerName = resolveParticipantName(actor, participants, baseDigimonName, attackerDigimon?.isEnemy || false)
  }

  // Get target name
  let targetName = 'Unknown'
  if (target.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    targetName = targetTamer?.name || `Tamer ${target.entityId}`
  } else if (target.type === 'digimon') {
    // Query target digimon for name
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    const baseDigimonName = targetDigimon?.name || `Digimon ${target.entityId}`
    targetName = resolveParticipantName(target, participants, baseDigimonName, targetDigimon?.isEnemy || false)
  }

  // Add battle log entries
  const attackLogEntry = {
    id: `log-${Date.now()}-attack`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: attackerName,
    action: 'Attack',
    target: targetName,
    result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
    damage: null,
    effects: ['Attack'],
  }

  const dodgeLogEntry = {
    id: `log-${Date.now()}-dodge`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: target.id,
    actorName: targetName,
    action: 'Dodge',
    target: null,
    result: `${body.dodgeDicePool}d6 => [${body.dodgeDiceResults.join(',')}] = ${body.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
    damage: hit ? damageDealt : 0,
    effects: [
      'Dodge',
      ...(appliedEffectName ? [`Applied: ${appliedEffectName}`] : []),
      ...(npcPushLogNote ? [npcPushLogNote] : []),
    ],
    attackerParticipantId: actor.id,

    // Damage calculation breakdown
    baseDamage: attackBaseDamage,
    netSuccesses: netSuccesses,
    targetArmor: targetArmor,
    armorPiercing: armorPiercing,
    effectiveArmor: hit ? Math.max(0, targetArmor - armorPiercing) : undefined,
    finalDamage: hit ? damageDealt : 0,
    hit: hit,
  }

  const updatedBattleLog = [...battleLog, attackLogEntry, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : []), ...(npcDefeatedLog ? [npcDefeatedLog] : []), ...roundEndLogEntries, ...gravityLogEntries]

  // Any other enemy this request knocked out (Burn on the Knockback, the wrap's Poison/Burn, the
  // fall at the turn change) leaves the encounter too
  const knockout = await resolveEnemyKnockouts({
    participants: finalParticipantsAfterDefeat,
    turnOrder: updatedTurnOrder,
    currentTurnIndex: npcDefeatNextTurnIndex ?? (encounter.currentTurnIndex ?? 0),
    round: npcDefeatNextRound ?? (encounter.round ?? 0),
  }, knockedOutEnemyIds(finalParticipantsAfterDefeat).filter((pid) => !knockedOutBefore.has(pid) && !(autoDevolveLog && pid === body.targetId)),
  { encounterId, houseRules, campaignLevel, mapId: (encounter as any).mapId, gravity: 'room' })
  const turnStateChanged = !!npcDefeatedLog || knockout.changed

  // This legacy path handles the primary target's devolution/removal before the shared
  // knockout resolver sees it. Refresh from that final roster before the existing save.
  const participantsForSave = autoDevolveLog || npcDefeatedLog
    ? await refreshGuidingLightForParticipants(encounterId, knockout.participants)
    : knockout.participants

  // Update encounter
  const updateData: any = {
    pendingRequests,
    participants: participantsForSave,
    battleLog: [...updatedBattleLog, ...knockout.logEntries],
    ...(turnStateChanged ? { turnOrder: knockout.turnOrder, currentTurnIndex: knockout.currentTurnIndex, round: knockout.round } : {}),
    updatedAt: new Date(),
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
}
