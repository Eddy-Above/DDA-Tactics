import { eq, inArray } from 'drizzle-orm'
import { db, encounters, digimon, tamers, evolutionLines, campaigns, maps } from '../../../db'
import { applyPositionPatch, broadcast, getRoomPositions } from '../../../utils/encounterRoom'
import {
  getFootprintDimsForParticipant,
  buildFootprintOccupiedSet,
  isPositionInAir,
  findPushPullLandingCell,
} from '../../../utils/mapMovement'
import { EFFECT_ALIGNMENT, getEffectStatModifiers, CLASH_ENDING_EFFECTS } from '../../../../data/attackConstants'
import { applyEffectToParticipant } from '../../../utils/applyEffect'
import { getDigimonDerivedStats, calculateEffectPotency } from '../../../utils/resolveSupportAttack'
import { triggerCounterattack } from '../../../utils/triggerCounterattack'
import { resolveNpcAttack } from '../../../utils/resolveNpcAttack'
import { applyStanceToDodge } from '../../../../utils/stanceModifiers'
import { getSelectiveTargetingFilter, selectiveTargetingBlocksDamage, selectiveTargetingBlocksEffect } from '../../../utils/selectiveTargeting'

interface SubmitResponseBody {
  requestId: string
  tamerId: string
  response: {
    type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled' | 'health-rolled' | 'counterattack-declined' | 'counterattack-triggered' | 'recovery-rolled' | 'divine-protection-used' | 'divine-protection-declined'
    digimonId?: string
    initiative?: number
    initiativeRoll?: number
    dodgeDicePool?: number
    dodgeSuccesses?: number
    dodgeDiceResults?: number[]
    healthDicePool?: number
    healthSuccesses?: number
    healthDiceResults?: number[]
    attackId?: string
    attackName?: string
    accuracyDicePool?: number
    accuracySuccesses?: number
    accuracyDiceResults?: number[]
    tamerSuccesses?: number
    digimonSuccesses?: number
    tamerDiceResults?: number[]
    digimonDiceResults?: number[]
  }
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SubmitResponseBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.requestId || !body.tamerId || !body.response) {
    throw createError({
      statusCode: 400,
      message: 'requestId, tamerId, and response are required',
    })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${encounterId} not found`,
    })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = campaign.rulesSettings || {}
      houseRules = rulesSettings.houseRules
    }
  }

  const pendingRequests = encounter.pendingRequests
  const currentResponses = encounter.requestResponses

  // Validate request exists and belongs to this tamer
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request) {
    throw createError({
      statusCode: 404,
      message: 'Request not found',
    })
  }

  if (request.targetTamerId !== body.tamerId) {
    throw createError({
      statusCode: 403,
      message: 'This request is not for you',
    })
  }

  // Validate response type matches request type
  if (body.response.type === 'digimon-selected') {
    if (request.type !== 'digimon-selection') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    // Allow null for tamer-only selection, or a string for digimon selection
    // No validation needed - both are valid
  } else if (body.response.type === 'initiative-rolled') {
    if (request.type !== 'initiative-roll') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (!Number.isInteger(body.response.initiative) || !Number.isInteger(body.response.initiativeRoll)) {
      throw createError({
        statusCode: 400,
        message: 'initiative and initiativeRoll are required for initiative-rolled response',
      })
    }
    // Validate realistic initiative roll (3d6 = 3-18)
    if (body.response.initiativeRoll! < 3 || body.response.initiativeRoll! > 18) {
      throw createError({
        statusCode: 400,
        message: 'Initiative roll must be between 3 and 18 (3d6)',
      })
    }
  } else if (body.response.type === 'dodge-rolled') {
    if (request.type !== 'dodge-roll') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (body.response.dodgeDicePool === undefined || body.response.dodgeSuccesses === undefined || !body.response.dodgeDiceResults) {
      throw createError({
        statusCode: 400,
        message: 'dodgeDicePool, dodgeSuccesses, and dodgeDiceResults are required for dodge-rolled response',
      })
    }
  } else if (body.response.type === 'health-rolled') {
    if (request.type !== 'health-roll') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (body.response.healthDicePool === undefined || body.response.healthSuccesses === undefined || !body.response.healthDiceResults) {
      throw createError({
        statusCode: 400,
        message: 'healthDicePool, healthSuccesses, and healthDiceResults are required for health-rolled response',
      })
    }
  } else if (body.response.type === 'counterattack-declined') {
    if (request.type !== 'counterattack-prompt') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
  } else if (body.response.type === 'counterattack-triggered') {
    if (request.type !== 'counterattack-prompt') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (!body.response.attackId || body.response.accuracySuccesses === undefined || !body.response.accuracyDiceResults || body.response.accuracyDicePool === undefined) {
      throw createError({
        statusCode: 400,
        message: 'attackId, accuracyDicePool, accuracySuccesses, and accuracyDiceResults are required for counterattack-triggered response',
      })
    }
  } else if (body.response.type === 'divine-protection-used' || body.response.type === 'divine-protection-declined') {
    if (request.type !== 'divine-protection-offer') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
  }

  // Auto-process digimon-selected: immediately create initiative-roll request
  if (body.response.type === 'digimon-selected') {
    // Remove the original digimon-selection request
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    // Create initiative-roll request
    const initiativeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'initiative-roll',
      targetTamerId: body.tamerId,
      targetParticipantId: undefined,
      timestamp: new Date().toISOString(),
      data: body.response.digimonId ? { digimonId: body.response.digimonId } : {},
    }
    filteredRequests.push(initiativeRequest)

    await db.update(encounters).set({
      pendingRequests: filteredRequests,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // Create response
  const newResponse = {
    id: `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    requestId: body.requestId,
    tamerId: body.tamerId,
    participantId: body.response.type === 'dodge-rolled' ? request.targetParticipantId : undefined,
    // Store attacker info for client-side direct response matching (request may be deleted)
    attackerParticipantId: body.response.type === 'dodge-rolled' ? request.data?.attackerParticipantId : undefined,
    attackerName: body.response.type === 'dodge-rolled' ? request.data?.attackerName : undefined,
    response: {
      ...body.response,
      timestamp: new Date().toISOString(),
    },
  }

  currentResponses.push(newResponse)

  // If this is a dodge-roll response to a player attack, calculate damage and update battle log
  let updateData: any = {
    requestResponses: currentResponses,
    pendingRequests: pendingRequests,
    updatedAt: new Date(),
  }

  if (body.response.type === 'dodge-rolled' && request.data?.attackId) {
    let participants = encounter.participants
    let battleLog = encounter.battleLog
    const turnOrder = encounter.turnOrder
    const currentTurnIndex = encounter.currentTurnIndex ?? 0
    // Determine if target has already gone this round.
    // Digimon are not in turnOrder — use their partner Tamer's position instead.
    const targetParticipantForTurn = participants.find((p: any) => p.id === request.targetParticipantId)
    let targetHasGone = false
    if (targetParticipantForTurn?.type === 'tamer') {
      const idx = turnOrder.indexOf(targetParticipantForTurn.id)
      targetHasGone = idx >= 0 && idx < currentTurnIndex
    } else if (targetParticipantForTurn?.type === 'digimon') {
      const [targetDigimonForTurn] = await db.select().from(digimon).where(eq(digimon.id, targetParticipantForTurn.entityId))
      if (targetDigimonForTurn?.partnerId) {
        const tamerOfTarget = participants.find((p: any) => p.type === 'tamer' && p.entityId === targetDigimonForTurn.partnerId)
        if (tamerOfTarget) {
          const idx = turnOrder.indexOf(tamerOfTarget.id)
          targetHasGone = idx >= 0 && idx < currentTurnIndex
        }
      } else {
        // NPC digimon — appears in turnOrder directly
        const idx = turnOrder.indexOf(targetParticipantForTurn.id)
        targetHasGone = idx >= 0 && idx < currentTurnIndex
      }
    }

    // Calculate hit/miss
    const accuracySuccesses = request.data.accuracySuccesses
    let dodgeSuccesses = body.response.dodgeSuccesses ?? 0

    // Attacked from OUTSIDE the clash: the clashing target cannot dodge at all (server-enforced
    // even if a dodge roll was somehow submitted).
    if (request.data.cannotDodge) {
      dodgeSuccesses = 0
    } else if (request.data.clashAttack || request.data.halfDodge) {
      // Clash Attack / Counterattack halfDodge: target may only use half their dodge pool — recount successes from capped dice
      const targetParticipantForDodge = participants.find((p: any) => p.id === request.targetParticipantId)
      let fullDodgePool = 3
      if (targetParticipantForDodge?.type === 'digimon') {
        const [targetDigimonForDodge] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
        if (targetDigimonForDodge) {
          const baseStats = targetDigimonForDodge.baseStats
          const bonusStats = (targetDigimonForDodge as any).bonusStats
          fullDodgePool = (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0) || 3
        }
      } else if (targetParticipantForDodge?.type === 'tamer') {
        const [targetTamerForDodge] = await db.select().from(tamers).where(eq(tamers.id, request.data.targetEntityId))
        if (targetTamerForDodge) {
          const attrs = targetTamerForDodge.attributes
          const skills = targetTamerForDodge.skills
          fullDodgePool = (attrs?.agility ?? 0) + (skills?.dodge ?? 0) || 3
        }
      }
      fullDodgePool = applyStanceToDodge(fullDodgePool, targetParticipantForDodge?.currentStance)
      fullDodgePool = Math.max(1, fullDodgePool - (targetParticipantForDodge?.dodgePenalty ?? 0))
      const targetEffectModsForDodge = getEffectStatModifiers(targetParticipantForDodge?.activeEffects || [])
      fullDodgePool += targetEffectModsForDodge.dodge
      const maxClashPool = Math.max(1, Math.floor(fullDodgePool / 2))
      const clashDiceResults = (body.response.dodgeDiceResults ?? []).slice(0, maxClashPool)
      dodgeSuccesses = clashDiceResults.filter((d: number) => d >= 5).length
    }

    const netSuccesses = accuracySuccesses - dodgeSuccesses
    const hit = netSuccesses >= 0

    const attackerParticipant = participants.find((p: any) => p.id === request.data.attackerParticipantId)

    // Look up attack definition
    let attackDef: any = null
    let attackerQualitiesForST: any[] = []
    if (attackerParticipant?.type === 'digimon') {
      const [attackerDigimonForDef] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))
      if (attackerDigimonForDef?.attacks) {
        const attacksList = attackerDigimonForDef.attacks
        attackDef = attacksList?.find((a: any) => a.id === request.data.attackId)
      }
      attackerQualitiesForST = attackerDigimonForDef?.qualities || []
    }

    const isSupportAttack = request.data?.isSupportAttack || attackDef?.type === 'support'

    // Selective Targeting: filter applies only for [Area] attacks with multiple total targets
    const attackerHasSelectiveTargeting = attackerQualitiesForST.some((q: any) => q.id === 'selective-targeting')
    const isAreaAttack = attackDef?.tags?.some((t: string) => t.startsWith('Area Attack')) ?? false
    const targetParticipantForST = participants.find((p: any) => p.id === request.targetParticipantId)
    const selectiveTargetingFilter = getSelectiveTargetingFilter(
      attackerHasSelectiveTargeting, isAreaAttack, request.data.totalTargetCount ?? 1,
      !!attackerParticipant?.isEnemy, !!targetParticipantForST?.isEnemy,
    )

    if (isSupportAttack) {
      // === SUPPORT ATTACK: no damage, only debuff on hit ===
      let appliedEffectName: string | null = null

      // Pre-calculate potency outside map (async not allowed in map callback)
      let potency = 0
      let potencyStat = 'bit'
      if (hit && attackDef?.effect) {
        const attackerDerived = attackerParticipant?.type === 'digimon'
          ? await getDigimonDerivedStats(request.data.attackerEntityId) : null
        const dodgeTargetParticipant = participants.find((p: any) => p.id === request.targetParticipantId)
        const targetDerived = dodgeTargetParticipant?.type === 'digimon'
          ? await getDigimonDerivedStats(request.data.targetEntityId) : null
        const result = calculateEffectPotency(attackDef.effect, attackerDerived, targetDerived)
        potency = result.potency
        potencyStat = result.potencyStat
        // Apply Signature Move Battery SPEC bonus
        if (request.data.isSignatureMove && request.data.batteryCount) {
          potency += request.data.batteryCount
        }
      }

      participants = participants.map((p: any) => {
        if (p.id === request.targetParticipantId) {
          const updated = {
            ...p,
            dodgePenalty: (p.dodgePenalty ?? 0) + 1,
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }

          const supportAlignment = attackDef?.effect ? EFFECT_ALIGNMENT[attackDef.effect] : undefined
          if (hit && attackDef?.effect && !selectiveTargetingBlocksEffect(selectiveTargetingFilter, supportAlignment)) {
            const effectDuration = Math.max(1, netSuccesses)
            const alignment = supportAlignment
            const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'

            const effectData = {
              name: attackDef.effect,
              type: effectType as 'buff' | 'debuff' | 'status',
              duration: effectDuration,
              source: request.data.attackerName || 'Attack',
              description: '',
              potency,
              potencyStat,
            }
            updated.activeEffects = applyEffectToParticipant(updated.activeEffects || [], effectData, houseRules)
            appliedEffectName = attackDef.effect
            // Stun: immediately reduce actions if target hasn't taken their turn yet this round
            if (attackDef.effect === 'Stun' && !targetHasGone) {
              updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
              updated.stunActionReducedThisRound = true
            } else if (attackDef.effect === 'Stun' && targetHasGone) {
              // Target already went — reduce intercede capacity this round and carry -1 action to next round
              updated.interceptPenalty = (p.interceptPenalty || 0) + 1
              updated.stunActionReducedThisRound = true
            }
          }

          return updated
        }
        return p
      })

      // Clash-ending effect: if Fear/Stun/Paralysis was applied, end the target's clash
      if (hit && appliedEffectName && CLASH_ENDING_EFFECTS.has(appliedEffectName)) {
        const clashTarget = participants.find((p: any) => p.id === request.targetParticipantId)
        if (clashTarget?.clash?.clashId) {
          const clashEndLog = {
            id: `log-${Date.now()}-clashend-effect`,
            timestamp: new Date().toISOString(),
            round: encounter.round,
            actorId: request.targetParticipantId,
            actorName: request.data.targetName,
            action: 'Clash Ended',
            target: null,
            result: `${appliedEffectName} forces ${request.data.targetName} out of their clash.`,
            damage: null,
            effects: ['Clash Ended', appliedEffectName],
          }
          participants = participants.map((p: any) => {
            if (p.clash?.clashId === clashTarget.clash.clashId) {
              const { clash, ...rest } = p
              return { ...rest, clashCooldownUntilRound: (encounter.round || 0) + 1 }
            }
            return p
          })
          battleLog = [...battleLog, clashEndLog]
        }
      }

      const dodgeLogEntry = {
        id: `log-${Date.now()}-dodge`,
        timestamp: new Date().toISOString(),
        round: encounter.round,
        actorId: request.targetParticipantId,
        actorName: request.data.targetName,
        action: 'Dodge (Support)',
        target: null,
        result: `${body.response.dodgeDicePool}d6 => [${(body.response.dodgeDiceResults ?? []).join(',')}] = ${body.response.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
        damage: 0,
        effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
        hit,
        dodgeDicePool: body.response.dodgeDicePool,
        dodgeDiceResults: body.response.dodgeDiceResults ?? [],
        dodgeSuccesses: body.response.dodgeSuccesses,
        netSuccesses,
      }

      battleLog = [...battleLog, dodgeLogEntry]
      updateData.participants = participants
      updateData.battleLog = battleLog

      // Check for Counterattack on miss (support branch)
      if (!hit && request.targetParticipantId) {
        const targetParticipantForCA = participants.find((p: any) => p.id === request.targetParticipantId)
        if (targetParticipantForCA?.type === 'digimon' && !targetParticipantForCA.usedCounterattackThisCombat) {
          const [tgtDig] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
          const tgtQ = tgtDig?.qualities || []
          if ((tgtQ as any[]).some((q: any) => q.id === 'counterattack')) {
            const caResult = await triggerCounterattack({
              participants,
              battleLog,
              pendingRequests: pendingRequests.filter((r: any) => r.id !== body.requestId),
              round: encounter.round || 0,
              counterattackerParticipantId: request.targetParticipantId,
              originalAttackerParticipantId: request.data.attackerParticipantId,
              houseRules,
              turnOrder: encounter.turnOrder,
              currentTurnIndex: encounter.currentTurnIndex ?? 0,
            })
            participants = caResult.participants
            battleLog = caResult.battleLog
            updateData.participants = participants
            updateData.battleLog = battleLog
            updateData.pendingRequests = caResult.pendingRequests
            if (caResult.nextTurnIndex !== undefined) updateData.currentTurnIndex = caResult.nextTurnIndex
            if (caResult.nextRound !== undefined) updateData.round = caResult.nextRound
          }
        }
      }

    } else {
      // === DAMAGE ATTACK: existing damage calculation flow ===
      let attackBaseDamage = 0
      let armorPiercing = 0

      if (attackerParticipant?.type === 'digimon') {
        const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))

        if (attackerDigimon) {
          const baseStats = attackerDigimon.baseStats
          const bonusStats = (attackerDigimon as any).bonusStats

          attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

          if (attackerDigimon.attacks) {
            const attacks = attackerDigimon.attacks

            const aDef = attacks?.find((a: any) => a.id === request.data.attackId)

            if (aDef?.tags && Array.isArray(aDef.tags)) {
              for (const tag of aDef.tags) {
                const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
                if (weaponMatch) {
                  const rankStr = weaponMatch[1]
                  const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
                  const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
                  attackBaseDamage += rank
                }

                const apMatch = tag.match(/^Armor Piercing\s+(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)$/i)
                if (apMatch) {
                  const rankStr = apMatch[1]
                  const romanMap: Record<string, number> = {
                    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
                    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
                  }
                  const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 0
                  armorPiercing = rank * 2
                }
              }
            }
          }
        }
      }

      // Combat Monster for attacker
      let attackerHasCombatMonster = false
      let attackerHealthStat = 0
      let attackerCombatMonsterBonus = 0
      let attackerHasPositiveReinforcement = false
      let attackerMoodValue = 3
      if (attackerParticipant?.type === 'digimon') {
        const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))
        if (attackerDigimon) {
          const baseStats = attackerDigimon.baseStats
          const bonusStats = (attackerDigimon as any).bonusStats
          attackerHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

          const attackerQualities = attackerDigimon.qualities
          attackerHasCombatMonster = (attackerQualities || []).some((q: any) => q.id === 'combat-monster')
          attackerCombatMonsterBonus = attackerParticipant.combatMonsterBonus ?? 0
          attackerHasPositiveReinforcement = (attackerQualities || []).some((q: any) => q.id === 'positive-reinforcement')
          attackerMoodValue = attackerParticipant.moodValue ?? 3
        }
      }

      // Get target armor
      let targetArmor = 0
      const targetParticipant = participants.find((p: any) => p.id === request.targetParticipantId)

      let targetHasCombatMonster = false
      let targetHealthStat = 0
      let targetDigimonRef: any = null
      let targetHasPositiveReinforcement = false
      let targetMoodValue = 3
      if (targetParticipant?.type === 'digimon') {
        const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
        targetDigimonRef = targetDigimon
        if (targetDigimon) {
          const targetBaseStats = targetDigimon.baseStats
          const targetBonusStats = (targetDigimon as any).bonusStats

          targetArmor = (targetBaseStats?.armor ?? 0) + (targetBonusStats?.armor ?? 0)
          targetHealthStat = (targetBaseStats?.health ?? 0) + (targetBonusStats?.health ?? 0)

          const targetQualities = targetDigimon.qualities
          const targetDataOpt = targetQualities?.find((q: any) => q.id === 'data-optimization')
          if (targetDataOpt?.choiceId === 'guardian') {
            targetArmor += 2
          }
          targetHasCombatMonster = (targetQualities || []).some((q: any) => q.id === 'combat-monster')
          targetHasPositiveReinforcement = (targetQualities || []).some((q: any) => q.id === 'positive-reinforcement')
          targetMoodValue = targetParticipant.moodValue ?? 3
        }
      } else if (targetParticipant?.type === 'tamer') {
        const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, request.data.targetEntityId))
        if (targetTamer) {
          const attrs = targetTamer.attributes
          const skills = targetTamer.skills
          targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
        }
      }

      // Apply bolster damage bonus
      if (request.data.bolsterDamageBonus) {
        attackBaseDamage += request.data.bolsterDamageBonus
      }

      // Apply Signature Move Battery damage bonus
      if (request.data.isSignatureMove && request.data.batteryCount) {
        attackBaseDamage += request.data.batteryCount
      }

      // outsideClashCpuPenalty is applied after damage calculation below

      // Apply Combat Monster bonus to attacker's damage on hit
      if (hit && attackerHasCombatMonster && attackerCombatMonsterBonus > 0) {
        attackBaseDamage += attackerCombatMonsterBonus
      }

      // Apply active effect modifiers to attacker damage and target armor
      const attackerEffectMods = getEffectStatModifiers(attackerParticipant?.activeEffects || [])
      attackBaseDamage += attackerEffectMods.damage
      const targetEffectMods = getEffectStatModifiers(targetParticipant?.activeEffects || [])
      targetArmor += targetEffectMods.armor

      // Apply Positive Reinforcement mood modifiers to damage and armor
      if (attackerHasPositiveReinforcement && attackerMoodValue >= 5) {
        attackBaseDamage += attackerMoodValue - 4  // Mood 5 → +1, Mood 6 → +2
      }
      if (targetHasPositiveReinforcement && targetMoodValue <= 2) {
        targetArmor -= (3 - targetMoodValue)  // Mood 2 → –1, Mood 1 → –2
      }

      // Calculate final damage
      let damageDealt = 0
      if (hit) {
        const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
        damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
        // Outside-clash penalty: outsider attacks deal reduced damage
        if (request.data.outsideClashCpuPenalty && request.data.outsideClashCpuPenalty > 0) {
          damageDealt = Math.max(1, damageDealt - request.data.outsideClashCpuPenalty)
        }
        // Selective Targeting: area attacks don't damage allies
        if (selectiveTargetingBlocksDamage(selectiveTargetingFilter)) damageDealt = 0
      }

      // === DIVINE PROTECTION: offer to tamer targets before applying damage ===
      if (hit && targetParticipant?.type === 'tamer' && damageDealt > 0) {
        const dpUses = targetParticipant.divineProtectionUsesThisBattle ?? 0
        const currentInsp = targetParticipant.currentInspiration ?? 0
        const firstUse = dpUses === 0
        const eligible = firstUse || currentInsp >= 2

        if (eligible) {
          // Store pending damage on participant (do NOT apply wounds yet)
          const updatedWithPending = participants.map((p: any) =>
            p.id === request.targetParticipantId
              ? { ...p, pendingDivineProtectionDamage: damageDealt }
              : p,
          )

          const dpRequest = {
            id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'divine-protection-offer',
            targetTamerId: request.data.targetEntityId,
            targetParticipantId: request.targetParticipantId,
            timestamp: new Date().toISOString(),
            data: {
              pendingDamage: damageDealt,
              targetName: request.data.targetName,
              attackerName: request.data.attackerName,
              targetParticipantId: request.targetParticipantId,
              firstUse,
              inspirationCost: firstUse ? 0 : 2,
            },
          }

          const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

          await db.update(encounters).set({
            participants: updatedWithPending,
            pendingRequests: [...filteredRequests, dpRequest],
            requestResponses: currentResponses,
            updatedAt: new Date(),
          }).where(eq(encounters.id, encounterId))

          const [earlyUpdated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
          return earlyUpdated
        }
      }

      // Apply damage to target and auto-apply attack effects
      let appliedEffectName: string | null = null

      // Pre-calculate effect potency (async, can't be inside .map())
      let damageEffectPotency = 0
      let damageEffectPotencyStat = 'bit'
      if (hit && attackDef?.effect) {
        const atkDerived = attackerParticipant?.type === 'digimon'
          ? await getDigimonDerivedStats(request.data.attackerEntityId) : null
        const tgtDerived = targetParticipant?.type === 'digimon'
          ? await getDigimonDerivedStats(request.data.targetEntityId) : null
        const result = calculateEffectPotency(attackDef.effect, atkDerived, tgtDerived)
        damageEffectPotency = result.potency
        damageEffectPotencyStat = result.potencyStat
      }

      let lifestealHealAmount = 0
      participants = participants.map((p: any) => {
        // Handle attacker: reset Combat Monster bonus on hit + Lifesteal healing + Positive Reinforcement mood
        if (p.id === request.data.attackerParticipantId) {
          const attackerUpdates: any = {}
          if (hit && attackerHasCombatMonster) {
            attackerUpdates.combatMonsterBonus = 0
          }
          if (hit && attackDef?.effect === 'Lifesteal' && damageDealt >= 2) {
            const lifestealPotency = request.data.lifestealed
              ? damageEffectPotency * 2
              : damageEffectPotency
            lifestealHealAmount = Math.min(damageDealt, lifestealPotency)
            attackerUpdates.currentWounds = Math.max(0, (p.currentWounds || 0) - lifestealHealAmount)
          }
          if (attackerHasPositiveReinforcement) {
            // Land attack → +1 Mood; Miss → –1 Mood
            attackerUpdates.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? 1 : -1)))
          }
          if (Object.keys(attackerUpdates).length > 0) {
            return { ...p, ...attackerUpdates }
          }
        }

        if (p.id === request.targetParticipantId) {
          const updated: any = {
            ...p,
            dodgePenalty: (p.dodgePenalty ?? 0) + 1,
            // Consume Directed effect (bonus was applied client-side to dodge pool)
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }
          // Positive Reinforcement: get hit → –1 Mood; successfully dodge → +1 Mood
          if (targetHasPositiveReinforcement) {
            updated.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? -1 : 1)))
          }

          // Apply damage and effects only if hit
          if (hit) {
            const tempAvailable = p.currentTempWounds ?? 0
            const tempAbsorb = Math.min(tempAvailable, damageDealt)
            const remainder = damageDealt - tempAbsorb
            updated.currentTempWounds = tempAvailable - tempAbsorb
            if (tempAbsorb > 0 && updated.currentTempWounds === 0) {
              updated.activeEffects = (updated.activeEffects || []).filter((e: any) => e.name !== 'Shield')
            }
            updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + remainder)

            // Accumulate Combat Monster bonus for target (only from real wound damage)
            if (targetHasCombatMonster && remainder > 0) {
              updated.combatMonsterBonus = Math.min(
                p.totalHealth ?? p.maxWounds,
                (p.combatMonsterBonus ?? 0) + remainder
              )
            }

            // Auto-apply effect if attack has one and conditions are met
            if (attackDef?.effect) {
              const alignment = EFFECT_ALIGNMENT[attackDef.effect]
              const shouldApply = (attackDef.type === 'damage' ? damageDealt >= 2 : true)
                && !selectiveTargetingBlocksEffect(selectiveTargetingFilter, alignment)
              if (shouldApply) {
                const effectDuration = Math.max(1, netSuccesses)
                const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
                const newEffect = {
                  name: attackDef.effect,
                  type: effectType as 'buff' | 'debuff' | 'status',
                  duration: effectDuration,
                  source: request.data.attackerName || 'Attack',
                  description: '',
                  potency: damageEffectPotency,
                  potencyStat: damageEffectPotencyStat,
                }
                updated.activeEffects = applyEffectToParticipant(updated.activeEffects || [], newEffect, houseRules)
                appliedEffectName = attackDef.effect
                // Stun: immediately reduce actions if target hasn't taken their turn yet this round
                if (attackDef.effect === 'Stun' && !targetHasGone) {
                  updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
                  updated.stunActionReducedThisRound = true
                } else if (attackDef.effect === 'Stun' && targetHasGone) {
                  // Target already went — reduce intercede capacity this round and carry -1 action to next round
                  updated.interceptPenalty = (p.interceptPenalty || 0) + 1
                  updated.stunActionReducedThisRound = true
                }
              }
            }
          }

          return updated
        }
        return p
      })

      // Clash-ending effect: if Fear/Stun/Paralysis was applied, end the target's clash
      if (hit && appliedEffectName && CLASH_ENDING_EFFECTS.has(appliedEffectName)) {
        const clashTarget = participants.find((p: any) => p.id === request.targetParticipantId)
        if (clashTarget?.clash?.clashId) {
          const clashEndLog = {
            id: `log-${Date.now()}-clashend-effect`,
            timestamp: new Date().toISOString(),
            round: encounter.round,
            actorId: request.targetParticipantId,
            actorName: request.data.targetName,
            action: 'Clash Ended',
            target: null,
            result: `${appliedEffectName} forces ${request.data.targetName} out of their clash.`,
            damage: null,
            effects: ['Clash Ended', appliedEffectName],
          }
          battleLog = [...battleLog, clashEndLog]
          participants = participants.map((p: any) => {
            if (p.clash?.clashId === clashTarget.clash.clashId) {
              const { clash, ...rest } = p
              return { ...rest, clashCooldownUntilRound: (encounter.round || 0) + 1 }
            }
            return p
          })
        }
      }

      // Push/Pull map displacement (map mode only)
      let pushPullLogNote: string | null = null
      if (hit && (appliedEffectName === 'Knockback' || appliedEffectName === 'Pull') && encounter.mapId) {
        const [mapRow] = await db.select().from(maps).where(eq(maps.id, encounter.mapId))
        if (mapRow) {
          const pushPullMap: import('../../../../types').GameMap = {
            groundTiles: mapRow.groundTiles ?? [],
            voxels: mapRow.voxels ?? [],
            stairs: mapRow.stairs ?? [],
            walls: mapRow.walls ?? [],
            doors: mapRow.doors ?? [],
          }
          const positions = await getRoomPositions(encounterId!)
          const targetPos = positions[request.targetParticipantId]
          const attackerPos = positions[request.data.attackerParticipantId]

          if (targetPos && attackerPos) {
            const entityIds = [...new Set(
              (participants as any[]).filter((p: any) => p.type === 'digimon').map((p: any) => p.entityId),
            )] as string[]
            const digimonRows = entityIds.length
              ? await db.select().from(digimon).where(inArray(digimon.id, entityIds))
              : []
            const digimonById = new Map(digimonRows.map((d: any) => [d.id, d]))

            const targetPart = (participants as any[]).find((p: any) => p.id === request.targetParticipantId)
            const targetDims = getFootprintDimsForParticipant(targetPart, digimonById as any)
            const attackerPart = (participants as any[]).find((p: any) => p.id === request.data.attackerParticipantId)
            const attackerDims = getFootprintDimsForParticipant(attackerPart, digimonById as any)
            const occupiedSet = buildFootprintOccupiedSet(
              positions,
              participants as any[],
              digimonById as any,
              new Set([request.targetParticipantId]),
            )

            const landingCell = findPushPullLandingCell(
              targetPos,
              attackerPos,
              appliedEffectName === 'Knockback' ? 'push' : 'pull',
              damageEffectPotency,
              targetDims,
              attackerDims,
              pushPullMap,
              occupiedSet,
            )

            if (landingCell) {
              let pushFallDamage = 0
              let finalY = landingCell.y
              if (isPositionInAir(landingCell, pushPullMap)) {
                let groundY = landingCell.y
                while (groundY > 0 && isPositionInAir({ x: landingCell.x, y: groundY - 1, z: landingCell.z }, pushPullMap)) {
                  groundY--
                }
                finalY = groundY
                const fallHeight = landingCell.y - groundY
                pushFallDamage = Math.max(0, fallHeight - 1)
                if (pushFallDamage > 0 && targetPart?.type === 'digimon') {
                  const targetDigRec = digimonById.get(targetPart.entityId) as any
                  const quals = targetDigRec?.qualities ?? []
                  if (quals.some((q: any) => q.id === 'tumbler')) {
                    const hasAdvJumper = quals.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
                    if (hasAdvJumper) {
                      pushFallDamage = 0
                    } else {
                      const td = await getDigimonDerivedStats(targetPart.entityId)
                      pushFallDamage = Math.max(0, pushFallDamage - (td?.ram ?? 0) * 2)
                    }
                  }
                }
              }

              if (pushFallDamage > 0) {
                participants = (participants as any[]).map((p: any) => {
                  if (p.id === request.targetParticipantId) {
                    return { ...p, currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + pushFallDamage) }
                  }
                  return p
                })
              }

              const finalPos = { x: landingCell.x, y: finalY, z: landingCell.z }
              const patch = { [request.targetParticipantId]: finalPos }
              const version = await applyPositionPatch(encounterId!, patch)
              broadcast(encounterId!, { type: 'position-patch', encounterId: encounterId!, patch, version })

              const moveLabel = appliedEffectName === 'Knockback' ? 'Knockback' : 'Pull'
              const pushFallNote = pushFallDamage > 0 ? ` + ${pushFallDamage} fall damage` : ''
              pushPullLogNote = `${moveLabel}: displaced ${damageEffectPotency} cell(s)${pushFallNote}`
            }
          }
        }
      }

      // Auto-devolve check: if target is KO'd but has evolution history, devolve instead
      let autoDevolveLog: any = null
      const damagedTarget = participants.find((p: any) => p.id === request.targetParticipantId)
      if (damagedTarget && hit &&
          damagedTarget.currentWounds >= damagedTarget.maxWounds &&
          damagedTarget.evolutionLineId &&
          damagedTarget.woundsHistory?.length > 0) {
        const previousState = damagedTarget.woundsHistory.pop()
        if (previousState) {
          const oldEntityId = damagedTarget.entityId
          damagedTarget.entityId = previousState.entityId
          damagedTarget.maxWounds = previousState.maxWounds
          damagedTarget.currentWounds = previousState.wounds

          await db.update(evolutionLines).set({
            currentStageIndex: previousState.stageIndex,
            updatedAt: new Date(),
          }).where(eq(evolutionLines.id, damagedTarget.evolutionLineId))

          const [oldDigimon] = await db.select().from(digimon).where(eq(digimon.id, oldEntityId))
          const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))

          const devolvedQualities = newDigimon?.qualities || []
          const devolvedHasCombatMonster = (devolvedQualities as any[]).some((q: any) => q.id === 'combat-monster')
          damagedTarget.combatMonsterBonus = devolvedHasCombatMonster
            ? Math.min((damagedTarget as any).combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
            : 0

          autoDevolveLog = {
            id: `log-${Date.now()}-autodevolve`,
            timestamp: new Date().toISOString(),
            round: encounter.round,
            actorId: damagedTarget.id,
            actorName: oldDigimon?.name || 'Digimon',
            action: `was knocked out and devolved to ${newDigimon?.name || 'previous form'}!`,
            target: null,
            result: `Wounds restored to ${previousState.wounds}`,
            damage: null,
            effects: ['Auto-Devolve'],
          }
        }
      }

      // Add dodge battle log entry with damage breakdown
      const dodgeLogEntry = {
        id: `log-${Date.now()}-dodge`,
        timestamp: new Date().toISOString(),
        round: encounter.round,
        actorId: request.targetParticipantId,
        actorName: request.data.targetName,
        action: 'Dodge',
        target: null,
        result: `${body.response.dodgeDicePool}d6 => [${(body.response.dodgeDiceResults ?? []).join(',')}] = ${body.response.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
        damage: hit ? damageDealt : 0,
        effects: [
          'Dodge',
          ...(appliedEffectName ? [`Applied: ${appliedEffectName}`] : []),
          ...(lifestealHealAmount > 0 ? [`Lifesteal: healed ${lifestealHealAmount}`] : []),
          ...(pushPullLogNote ? [pushPullLogNote] : []),
        ],
        attackerParticipantId: request.data.attackerParticipantId,
        baseDamage: attackBaseDamage,
        netSuccesses: netSuccesses,
        targetArmor: targetArmor,
        armorPiercing: armorPiercing,
        effectiveArmor: hit ? Math.max(0, targetArmor - armorPiercing) : undefined,
        finalDamage: hit ? damageDealt : 0,
        hit: hit,
        dodgeDicePool: body.response.dodgeDicePool,
        dodgeDiceResults: body.response.dodgeDiceResults ?? [],
        dodgeSuccesses: body.response.dodgeSuccesses,
      }

      battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : [])]

      updateData.participants = participants
      updateData.battleLog = battleLog

      // Check for Counterattack on miss (damage branch)
      if (!hit && request.targetParticipantId) {
        const targetParticipantForCA = participants.find((p: any) => p.id === request.targetParticipantId)
        if (targetParticipantForCA?.type === 'digimon' && !targetParticipantForCA.usedCounterattackThisCombat) {
          const [tgtDig] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
          const tgtQ = tgtDig?.qualities || []
          if ((tgtQ as any[]).some((q: any) => q.id === 'counterattack')) {
            const caResult = await triggerCounterattack({
              participants,
              battleLog,
              pendingRequests: pendingRequests.filter((r: any) => r.id !== body.requestId),
              round: encounter.round || 0,
              counterattackerParticipantId: request.targetParticipantId,
              originalAttackerParticipantId: request.data.attackerParticipantId,
              houseRules,
              turnOrder: encounter.turnOrder,
              currentTurnIndex: encounter.currentTurnIndex ?? 0,
            })
            participants = caResult.participants
            battleLog = caResult.battleLog
            updateData.participants = participants
            updateData.battleLog = battleLog
            updateData.pendingRequests = caResult.pendingRequests
            if (caResult.nextTurnIndex !== undefined) updateData.currentTurnIndex = caResult.nextTurnIndex
            if (caResult.nextRound !== undefined) updateData.round = caResult.nextRound
          }
        }
      }

    } // end damage attack branch
  }

  // === HEALTH-ROLLED: Positive [P] effect duration from Health roll ===
  if (body.response.type === 'health-rolled' && request.data?.attackId) {
    let participants = encounter.participants
    let battleLog = encounter.battleLog

    const accuracySuccesses = request.data.accuracySuccesses
    const healthSuccesses = body.response.healthSuccesses!
    const isAoe = request.data.isAoe || false
    const buffingContested = request.data.buffingContested || false

    // Calculate duration
    let duration: number
    if (isAoe) {
      duration = buffingContested
        ? accuracySuccesses - healthSuccesses
        : healthSuccesses - accuracySuccesses
    } else {
      duration = buffingContested
        ? Math.max(1, accuracySuccesses - healthSuccesses)
        : Math.max(1, healthSuccesses - accuracySuccesses + 1)
    }

    const effectName = request.data.effectName
    let appliedEffectName: string | null = null

    if (duration > 0 && effectName) {
      const alignment = EFFECT_ALIGNMENT[effectName]
      const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
      // Calculate potency from attacker's derived stats (or target's for target-based effects)
      let potency = 0
      let potencyStat = 'bit'
      if (request.data.attackerEntityId) {
        const attackerDerived = await getDigimonDerivedStats(request.data.attackerEntityId)
        const healthTargetParticipant = participants.find((p: any) => p.id === request.targetParticipantId)
        const targetDerived = healthTargetParticipant?.type === 'digimon' && request.data.targetEntityId
          ? await getDigimonDerivedStats(request.data.targetEntityId) : null
        const result = calculateEffectPotency(effectName, attackerDerived, targetDerived)
        potency = result.potency
        potencyStat = result.potencyStat
      }

      const effectData = {
        name: effectName,
        type: effectType as 'buff' | 'debuff' | 'status',
        duration,
        source: request.data.attackerName || 'Attack',
        description: '',
        potency,
        potencyStat,
      }

      participants = participants.map((p: any) => {
        if (p.id === request.targetParticipantId) {
          return {
            ...p,
            activeEffects: applyEffectToParticipant(p.activeEffects || [], effectData, houseRules),
          }
        }
        return p
      })
      appliedEffectName = effectName
    }

    const healthLogEntry = {
      id: `log-${Date.now()}-health`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: request.targetParticipantId,
      actorName: request.data.targetName,
      action: 'Health Roll (Support)',
      target: null,
      result: duration > 0
        ? `${body.response.healthDicePool}d6 => [${body.response.healthDiceResults!.join(',')}] = ${healthSuccesses} successes — ${effectName} applied for ${duration} rounds`
        : `${body.response.healthDicePool}d6 => [${body.response.healthDiceResults!.join(',')}] = ${healthSuccesses} successes — Buff failed (needed > ${accuracySuccesses})`,
      damage: 0,
      effects: appliedEffectName ? ['Support', `Applied: ${appliedEffectName}`] : ['Support', 'Buff Failed'],
      hit: duration > 0,
    }

    battleLog = [...battleLog, healthLogEntry]

    updateData.participants = participants
    updateData.battleLog = battleLog
  }

  // === COUNTERATTACK-DECLINED: player declines the free retaliation ===
  if (body.response.type === 'counterattack-declined') {
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)
    const battleLog = encounter.battleLog

    const declineLog = {
      id: `log-${Date.now()}-ca-decline`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: request.targetParticipantId,
      actorName: request.data?.counterattackerName || 'Digimon',
      action: 'Counterattack',
      target: request.data?.originalAttackerName || 'Unknown',
      result: 'Counterattack declined',
      damage: 0,
      effects: ['Counterattack', 'Declined'],
    }

    await db.update(encounters).set({
      pendingRequests: filteredRequests,
      battleLog: [...battleLog, declineLog],
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // === COUNTERATTACK-TRIGGERED: player submits their chosen attack + accuracy roll ===
  if (body.response.type === 'counterattack-triggered') {
    let participants = encounter.participants
    let battleLog = encounter.battleLog
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    const counterattackerParticipantId = request.data?.counterattackerParticipantId
    const originalAttackerParticipantId = request.data?.originalAttackerParticipantId
    const counterattackerName = request.data?.counterattackerName || 'Digimon'
    const originalAttackerName = request.data?.originalAttackerName || 'Unknown'

    const accuracySuccesses = body.response.accuracySuccesses!
    const accuracyDiceResults = body.response.accuracyDiceResults!
    const accuracyDicePool = body.response.accuracyDicePool!
    const attackId = body.response.attackId!
    const attackName = body.response.attackName || 'Counterattack'

    // Mark used
    participants = participants.map((p: any) =>
      p.id === counterattackerParticipantId
        ? { ...p, usedCounterattackThisCombat: true }
        : p,
    )

    // Log accuracy roll
    battleLog = [
      ...battleLog,
      {
        id: `log-${Date.now()}-ca-accuracy`,
        timestamp: new Date().toISOString(),
        round: encounter.round,
        actorId: counterattackerParticipantId,
        actorName: counterattackerName,
        action: 'Counterattack Accuracy',
        target: originalAttackerName,
        result: `${accuracyDicePool}d6 => [${accuracyDiceResults.join(',')}] = ${accuracySuccesses} successes`,
        damage: null,
        effects: ['Counterattack', 'Accuracy Roll'],
      },
    ]

    if (accuracySuccesses === 0) {
      battleLog = [
        ...battleLog,
        {
          id: `log-${Date.now()}-ca-miss`,
          timestamp: new Date().toISOString(),
          round: encounter.round,
          actorId: counterattackerParticipantId,
          actorName: counterattackerName,
          action: 'Counterattack Result',
          target: originalAttackerName,
          result: 'AUTO MISS - 0 accuracy successes',
          damage: 0,
          effects: ['Counterattack', 'Miss'],
          hit: false,
        },
      ]

      await db.update(encounters).set({
        participants,
        battleLog,
        pendingRequests: filteredRequests,
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))

      const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      return updated
    }

    // accuracySuccesses > 0 — determine if original attacker is player or NPC
    const originalAttacker = participants.find((p: any) => p.id === originalAttackerParticipantId)
    const counterattacker = participants.find((p: any) => p.id === counterattackerParticipantId)

    let originalAttackerIsPlayer = false
    let originalAttackerTamerId: string | null = null

    if (originalAttacker?.type === 'tamer') {
      originalAttackerIsPlayer = true
      originalAttackerTamerId = originalAttacker.entityId
    } else if (originalAttacker?.type === 'digimon') {
      const [origDig] = await db.select().from(digimon).where(eq(digimon.id, originalAttacker.entityId))
      if (origDig?.partnerId && !origDig.isEnemy) {
        originalAttackerIsPlayer = true
        originalAttackerTamerId = origDig.partnerId
      }
    }

    // Look up the chosen attack definition
    let chosenAttack: any = null
    if (counterattacker?.type === 'digimon') {
      const [caDig] = await db.select().from(digimon).where(eq(digimon.id, counterattacker.entityId))
      if (caDig?.attacks) {
        const attacks = caDig.attacks
        chosenAttack = (attacks as any[]).find((a: any) => a.id === attackId) || null
      }
    }

    if (originalAttackerIsPlayer && originalAttackerTamerId) {
      // Create dodge-roll directly (bypassing intercede-offer) with halfDodge: true
      const dodgeRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'dodge-roll',
        targetTamerId: originalAttackerTamerId,
        targetParticipantId: originalAttackerParticipantId,
        timestamp: new Date().toISOString(),
        data: {
          attackerName: counterattackerName,
          targetName: originalAttackerName,
          attackName,
          accuracySuccesses,
          accuracyDice: accuracyDiceResults,
          attackId,
          attackData: chosenAttack,
          attackerEntityId: counterattacker?.entityId,
          attackerParticipantId: counterattackerParticipantId,
          targetEntityId: originalAttacker?.entityId,
          dodgePenalty: originalAttacker?.dodgePenalty ?? 0,
          bolstered: false,
          bolsterType: null,
          bolsterDamageBonus: 0,
          bolsterBitCpuBonus: 0,
          lifestealed: false,
          isSupportAttack: chosenAttack?.type === 'support',
          isSignatureMove: false,
          batteryCount: 0,
          clashAttack: false,
          outsideClashCpuPenalty: 0,
          halfDodge: true,
          isCounterattack: true,
        },
      }

      await db.update(encounters).set({
        participants,
        battleLog,
        pendingRequests: [...filteredRequests, dodgeRequest],
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))
    } else {
      // NPC original attacker — call resolveNpcAttack with counterattack: true
      const result = await resolveNpcAttack({
        participants,
        battleLog,
        attackerParticipantId: counterattackerParticipantId,
        targetParticipantId: originalAttackerParticipantId,
        attackId,
        accuracySuccesses,
        accuracyDice: accuracyDiceResults,
        round: encounter.round || 0,
        attackerName: counterattackerName,
        targetName: originalAttackerName,
        turnOrder: encounter.turnOrder,
        currentTurnIndex: encounter.currentTurnIndex ?? 0,
        houseRules,
        counterattack: true,
      })

      await db.update(encounters).set({
        participants: result.participants,
        battleLog: result.battleLog,
        pendingRequests: filteredRequests,
        ...(result.turnOrder ? { turnOrder: result.turnOrder } : {}),
        ...(result.nextTurnIndex !== undefined ? { currentTurnIndex: result.nextTurnIndex } : {}),
        ...(result.nextRound !== undefined ? { round: result.nextRound } : {}),
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))
    }

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // === RECOVERY-ROLLED: post-combat wound recovery ===
  if (body.response.type === 'recovery-rolled') {
    let participants = encounter.participants
    const battleLog = encounter.battleLog

    const tamerSuccesses = body.response.tamerSuccesses ?? 0
    const digimonSuccesses = body.response.digimonSuccesses ?? 0
    const { tamerParticipantId, digimonParticipantId, rookieDigimonId } = request.data || {}

    // Recover tamer wounds (reduce currentWounds, min 0)
    if (tamerParticipantId && tamerSuccesses > 0) {
      participants = participants.map((p: any) => {
        if (p.id === tamerParticipantId) {
          return { ...p, currentWounds: Math.max(0, (p.currentWounds ?? 0) - tamerSuccesses) }
        }
        return p
      })
    }

    // Recover digimon wounds
    if (digimonSuccesses > 0 && rookieDigimonId) {
      const digimonPart = digimonParticipantId
        ? participants.find((p: any) => p.id === digimonParticipantId)
        : null

      if (digimonPart && digimonPart.entityId === rookieDigimonId) {
        // Digimon is already at rookie in the encounter — update participant wounds
        participants = participants.map((p: any) => {
          if (p.id === digimonParticipantId) {
            return { ...p, currentWounds: Math.max(0, (p.currentWounds ?? 0) - digimonSuccesses) }
          }
          return p
        })
      } else {
        // Digimon was at champion+ — update the rookie entity's DB record directly
        const [rookieDigi] = await db.select().from(digimon).where(eq(digimon.id, rookieDigimonId))
        if (rookieDigi) {
          const newWounds = Math.max(0, (rookieDigi.currentWounds ?? 0) - digimonSuccesses)
          await db.update(digimon).set({ currentWounds: newWounds }).where(eq(digimon.id, rookieDigimonId))
        }
      }
    }

    // Add battle log entry
    const tamerPart = participants.find((p: any) => p.id === tamerParticipantId)
    const recoveryLog = {
      id: `log-${Date.now()}-recovery`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: tamerParticipantId,
      actorName: tamerPart?.name ?? 'Tamer',
      action: 'Recovery Check',
      target: null,
      result: `Tamer: ${tamerSuccesses} wound${tamerSuccesses !== 1 ? 's' : ''} recovered. Digimon: ${digimonSuccesses} wound${digimonSuccesses !== 1 ? 's' : ''} recovered.`,
      damage: null,
      effects: ['Recovery'],
    }

    // Remove request immediately
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    await db.update(encounters).set({
      participants,
      battleLog: [...battleLog, recoveryLog],
      pendingRequests: filteredRequests,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // === DIVINE-PROTECTION-USED: player negates the pending damage ===
  if (body.response.type === 'divine-protection-used') {
    let participants = encounter.participants
    const battleLog = encounter.battleLog
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    const targetParticipantId = request.data?.targetParticipantId
    const firstUse = request.data?.firstUse ?? true
    const inspirationCost = request.data?.inspirationCost ?? 0
    const pendingDamage = request.data?.pendingDamage ?? 0
    const targetName = request.data?.targetName ?? 'Tamer'

    participants = participants.map((p: any) => {
      if (p.id !== targetParticipantId) return p

      const updated: any = {
        ...p,
        divineProtectionUsesThisBattle: (p.divineProtectionUsesThisBattle ?? 0) + 1,
        pendingDivineProtectionDamage: undefined,
        // Lose a Simple Action at the start of their next turn
        pendingSimpleActionPenalty: (p.pendingSimpleActionPenalty ?? 0) + 1,
      }

      if (!firstUse && inspirationCost > 0) {
        updated.currentInspiration = Math.max(0, (p.currentInspiration ?? 0) - inspirationCost)
      }

      return updated
    })

    // Sync inspiration deduction to tamer DB if not the first use
    if (!firstUse && inspirationCost > 0) {
      const targetParticipant = participants.find((p: any) => p.id === targetParticipantId)
      if (targetParticipant?.type === 'tamer') {
        const [tamer] = await db.select().from(tamers).where(eq(tamers.id, targetParticipant.entityId))
        if (tamer) {
          const newInspiration = Math.max(0, (tamer.inspiration ?? 0) - inspirationCost)
          await db.update(tamers).set({
            inspiration: newInspiration,
            updatedAt: new Date(),
          }).where(eq(tamers.id, tamer.id))
        }
      }
    }

    const dpLog = {
      id: `log-${Date.now()}-divine-protection`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: targetParticipantId,
      actorName: targetName,
      action: 'Divine Protection',
      target: null,
      result: `${targetName} invokes Divine Protection — ${pendingDamage} damage negated!${!firstUse ? ` (costs ${inspirationCost} Inspiration)` : ''} Loses 1 Simple Action next turn.`,
      damage: 0,
      effects: ['Divine Protection', 'Damage Negated'],
    }

    await db.update(encounters).set({
      participants,
      battleLog: [...battleLog, dpLog],
      pendingRequests: filteredRequests,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // === DIVINE-PROTECTION-DECLINED: apply the pending damage ===
  if (body.response.type === 'divine-protection-declined') {
    let participants = encounter.participants
    const battleLog = encounter.battleLog
    const filteredRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    const targetParticipantId = request.data?.targetParticipantId
    const pendingDamage = request.data?.pendingDamage ?? 0
    const targetName = request.data?.targetName ?? 'Tamer'

    participants = participants.map((p: any) => {
      if (p.id !== targetParticipantId) return p
      const wounds = Math.min(p.maxWounds, (p.currentWounds ?? 0) + pendingDamage)
      return { ...p, currentWounds: wounds, pendingDivineProtectionDamage: undefined }
    })

    const declineLog = {
      id: `log-${Date.now()}-dp-declined`,
      timestamp: new Date().toISOString(),
      round: encounter.round,
      actorId: targetParticipantId,
      actorName: targetName,
      action: 'Divine Protection Declined',
      target: null,
      result: `${targetName} takes ${pendingDamage} damage`,
      damage: pendingDamage,
      effects: ['Divine Protection', 'Declined'],
    }

    await db.update(encounters).set({
      participants,
      battleLog: [...battleLog, declineLog],
      pendingRequests: filteredRequests,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // Update encounter
  // NOTE: Don't remove the request from pendingRequests yet - it will be removed when the GM processes the response via cancelRequest

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
})
