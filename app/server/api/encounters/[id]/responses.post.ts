import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, evolutionLines, campaigns } from '../../../db'
import { EFFECT_ALIGNMENT, getEffectStatModifiers } from '../../../../data/attackConstants'
import { applyEffectToParticipant } from '../../../utils/applyEffect'
import { getDigimonDerivedStats, calculateEffectPotency } from '../../../utils/resolveSupportAttack'

interface SubmitResponseBody {
  requestId: string
  tamerId: string
  response: {
    type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled' | 'health-rolled'
    digimonId?: string
    initiative?: number
    initiativeRoll?: number
    dodgeDicePool?: number
    dodgeSuccesses?: number
    dodgeDiceResults?: number[]
    healthDicePool?: number
    healthSuccesses?: number
    healthDiceResults?: number[]
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
  let houseRules: { stunMaxDuration1?: boolean } | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = typeof campaign.rulesSettings === 'string'
        ? JSON.parse(campaign.rulesSettings) : (campaign.rulesSettings || {})
      houseRules = rulesSettings.houseRules
    }
  }

  // Parse existing requests and responses
  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try {
        return JSON.parse(field)
      } catch {
        return []
      }
    }
    return []
  }

  const pendingRequests = parseJsonField(encounter.pendingRequests)
  const currentResponses = parseJsonField(encounter.requestResponses)

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
    if (body.response.initiativeRoll < 3 || body.response.initiativeRoll > 18) {
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
      pendingRequests: JSON.stringify(filteredRequests),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return {
      ...updated,
      participants: parseJsonField(updated.participants),
      turnOrder: parseJsonField(updated.turnOrder),
      battleLog: parseJsonField(updated.battleLog),
      hazards: parseJsonField(updated.hazards),
      pendingRequests: parseJsonField(updated.pendingRequests),
      requestResponses: parseJsonField(updated.requestResponses),
    }
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
    requestResponses: JSON.stringify(currentResponses),
    pendingRequests: JSON.stringify(pendingRequests),
    updatedAt: new Date(),
  }

  if (body.response.type === 'dodge-rolled' && request.data?.attackId) {
    // Parse encounter data
    let participants = parseJsonField(encounter.participants)
    let battleLog = parseJsonField(encounter.battleLog)

    // Calculate hit/miss
    const accuracySuccesses = request.data.accuracySuccesses
    const dodgeSuccesses = body.response.dodgeSuccesses
    const netSuccesses = accuracySuccesses - dodgeSuccesses
    const hit = netSuccesses >= 0

    const attackerParticipant = participants.find((p: any) => p.id === request.data.attackerParticipantId)

    // Look up attack definition
    let attackDef: any = null
    if (attackerParticipant?.type === 'digimon') {
      const [attackerDigimonForDef] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))
      if (attackerDigimonForDef?.attacks) {
        const attacksList = typeof attackerDigimonForDef.attacks === 'string'
          ? JSON.parse(attackerDigimonForDef.attacks) : attackerDigimonForDef.attacks
        attackDef = attacksList?.find((a: any) => a.id === request.data.attackId)
      }
    }

    const isSupportAttack = request.data?.isSupportAttack || attackDef?.type === 'support'

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
      }

      participants = participants.map((p: any) => {
        if (p.id === request.targetParticipantId) {
          const updated = {
            ...p,
            dodgePenalty: (p.dodgePenalty ?? 0) + 1,
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }

          if (hit && attackDef?.effect) {
            const effectDuration = Math.max(1, netSuccesses)
            const alignment = EFFECT_ALIGNMENT[attackDef.effect]
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
          }

          return updated
        }
        return p
      })

      const dodgeLogEntry = {
        id: `log-${Date.now()}-dodge`,
        timestamp: new Date().toISOString(),
        round: encounter.round,
        actorId: request.targetParticipantId,
        actorName: request.data.targetName,
        action: 'Dodge (Support)',
        target: null,
        result: `${body.response.dodgeDicePool}d6 => [${body.response.dodgeDiceResults.join(',')}] = ${body.response.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
        damage: 0,
        effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
        hit,
        dodgeDicePool: body.response.dodgeDicePool,
        dodgeDiceResults: body.response.dodgeDiceResults,
        dodgeSuccesses: body.response.dodgeSuccesses,
      }

      battleLog = [...battleLog, dodgeLogEntry]
      updateData.participants = JSON.stringify(participants)
      updateData.battleLog = JSON.stringify(battleLog)

    } else {
      // === DAMAGE ATTACK: existing damage calculation flow ===
      let attackBaseDamage = 0
      let armorPiercing = 0

      if (attackerParticipant?.type === 'digimon') {
        const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))

        if (attackerDigimon) {
          const baseStats = typeof attackerDigimon.baseStats === 'string'
            ? JSON.parse(attackerDigimon.baseStats)
            : attackerDigimon.baseStats
          const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
            ? JSON.parse((attackerDigimon as any).bonusStats)
            : (attackerDigimon as any).bonusStats

          attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

          if (attackerDigimon.attacks) {
            const attacks = typeof attackerDigimon.attacks === 'string'
              ? JSON.parse(attackerDigimon.attacks)
              : attackerDigimon.attacks

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
      if (attackerParticipant?.type === 'digimon') {
        const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))
        if (attackerDigimon) {
          const baseStats = typeof attackerDigimon.baseStats === 'string'
            ? JSON.parse(attackerDigimon.baseStats)
            : attackerDigimon.baseStats
          const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
            ? JSON.parse((attackerDigimon as any).bonusStats)
            : (attackerDigimon as any).bonusStats
          attackerHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

          const attackerQualities = typeof attackerDigimon.qualities === 'string'
            ? JSON.parse(attackerDigimon.qualities)
            : attackerDigimon.qualities
          attackerHasCombatMonster = (attackerQualities || []).some((q: any) => q.id === 'combat-monster')
          attackerCombatMonsterBonus = attackerParticipant.combatMonsterBonus ?? 0
        }
      }

      // Get target armor
      let targetArmor = 0
      const targetParticipant = participants.find((p: any) => p.id === request.targetParticipantId)

      let targetHasCombatMonster = false
      let targetHealthStat = 0
      let targetDigimonRef: any = null
      if (targetParticipant?.type === 'digimon') {
        const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
        targetDigimonRef = targetDigimon
        if (targetDigimon) {
          const targetBaseStats = typeof targetDigimon.baseStats === 'string'
            ? JSON.parse(targetDigimon.baseStats)
            : targetDigimon.baseStats
          const targetBonusStats = typeof (targetDigimon as any).bonusStats === 'string'
            ? JSON.parse((targetDigimon as any).bonusStats)
            : (targetDigimon as any).bonusStats

          targetArmor = (targetBaseStats?.armor ?? 0) + (targetBonusStats?.armor ?? 0)
          targetHealthStat = (targetBaseStats?.health ?? 0) + (targetBonusStats?.health ?? 0)

          const targetQualities = typeof targetDigimon.qualities === 'string'
            ? JSON.parse(targetDigimon.qualities)
            : targetDigimon.qualities
          const targetDataOpt = targetQualities?.find((q: any) => q.id === 'data-optimization')
          if (targetDataOpt?.choiceId === 'guardian') {
            targetArmor += 2
          }
          targetHasCombatMonster = (targetQualities || []).some((q: any) => q.id === 'combat-monster')
        }
      } else if (targetParticipant?.type === 'tamer') {
        const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, request.data.targetEntityId))
        if (targetTamer) {
          const attrs = typeof targetTamer.attributes === 'string' ? JSON.parse(targetTamer.attributes) : targetTamer.attributes
          const skills = typeof targetTamer.skills === 'string' ? JSON.parse(targetTamer.skills) : targetTamer.skills
          targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
        }
      }

      // Apply bolster damage bonus
      if (request.data.bolsterDamageBonus) {
        attackBaseDamage += request.data.bolsterDamageBonus
      }

      // Apply Combat Monster bonus to attacker's damage on hit
      if (hit && attackerHasCombatMonster && attackerCombatMonsterBonus > 0) {
        attackBaseDamage += attackerCombatMonsterBonus
      }

      // Apply active effect modifiers to attacker damage and target armor
      const attackerEffectMods = getEffectStatModifiers(attackerParticipant?.activeEffects || [])
      attackBaseDamage += attackerEffectMods.damage
      const targetEffectMods = getEffectStatModifiers(targetParticipant?.activeEffects || [])
      targetArmor += targetEffectMods.armor

      // Calculate final damage
      let damageDealt = 0
      if (hit) {
        const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
        damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
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

      participants = participants.map((p: any) => {
        // Handle attacker: reset Combat Monster bonus on hit
        if (p.id === request.data.attackerParticipantId && hit && attackerHasCombatMonster) {
          return { ...p, combatMonsterBonus: 0 }
        }

        if (p.id === request.targetParticipantId) {
          const updated = {
            ...p,
            dodgePenalty: (p.dodgePenalty ?? 0) + 1,
            // Consume Directed effect (bonus was applied client-side to dodge pool)
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }

          // Apply damage and effects only if hit
          if (hit) {
            updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt)

            // Accumulate Combat Monster bonus for target
            if (targetHasCombatMonster) {
              updated.combatMonsterBonus = Math.min(
                targetHealthStat,
                (p.combatMonsterBonus ?? 0) + damageDealt
              )
            }

            // Auto-apply effect if attack has one and conditions are met
            if (attackDef?.effect) {
              const shouldApply = attackDef.type === 'damage' ? damageDealt >= 2 : true
              if (shouldApply) {
                const effectDuration = Math.max(1, netSuccesses)
                const alignment = EFFECT_ALIGNMENT[attackDef.effect]
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
              }
            }
          }

          return updated
        }
        return p
      })

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
        result: `${body.response.dodgeDicePool}d6 => [${body.response.dodgeDiceResults.join(',')}] = ${body.response.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
        damage: hit ? damageDealt : 0,
        effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
        attackerParticipantId: request.data.attackerParticipantId,
        baseDamage: attackBaseDamage,
        netSuccesses: netSuccesses,
        targetArmor: targetArmor,
        armorPiercing: armorPiercing,
        effectiveArmor: hit ? Math.max(0, targetArmor - armorPiercing) : undefined,
        finalDamage: hit ? damageDealt : 0,
        hit: hit,
        dodgeDicePool: body.response.dodgeDicePool,
        dodgeDiceResults: body.response.dodgeDiceResults,
        dodgeSuccesses: body.response.dodgeSuccesses,
      }

      battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : [])]

      updateData.participants = JSON.stringify(participants)
      updateData.battleLog = JSON.stringify(battleLog)
    } // end damage attack branch
  }

  // === HEALTH-ROLLED: Positive [P] effect duration from Health roll ===
  if (body.response.type === 'health-rolled' && request.data?.attackId) {
    let participants = parseJsonField(encounter.participants)
    let battleLog = parseJsonField(encounter.battleLog)

    const accuracySuccesses = request.data.accuracySuccesses
    const healthSuccesses = body.response.healthSuccesses!
    const isAoe = request.data.isAoe || false

    // Calculate duration
    let duration: number
    if (isAoe) {
      duration = healthSuccesses - accuracySuccesses
    } else {
      duration = Math.max(1, healthSuccesses - accuracySuccesses + 1)
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

    updateData.participants = JSON.stringify(participants)
    updateData.battleLog = JSON.stringify(battleLog)
  }

  // Update encounter
  // NOTE: Don't remove the request from pendingRequests yet - it will be removed when the GM processes the response via cancelRequest

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    hazards: parseJsonField(updated.hazards),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
  }
})
