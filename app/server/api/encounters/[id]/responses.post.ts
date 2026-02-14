import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, evolutionLines } from '../../../db'
import { EFFECT_ALIGNMENT } from '../../../../data/attackConstants'

interface SubmitResponseBody {
  requestId: string
  tamerId: string
  response: {
    type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled'
    digimonId?: string
    initiative?: number
    initiativeRoll?: number
    dodgeDicePool?: number
    dodgeSuccesses?: number
    dodgeDiceResults?: number[]
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

    // Calculate damage (same logic as npc-attack.post.ts)
    const accuracySuccesses = request.data.accuracySuccesses
    const dodgeSuccesses = body.response.dodgeSuccesses
    const netSuccesses = accuracySuccesses - dodgeSuccesses
    const hit = netSuccesses >= 0

    // Get attacker's digimon to calculate base damage
    const attackerParticipant = participants.find((p: any) => p.id === request.data.attackerParticipantId)
    let attackBaseDamage = 0
    let armorPiercing = 0

    if (attackerParticipant?.type === 'digimon') {
      const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))

      if (attackerDigimon) {
        // Parse baseStats and bonusStats
        const baseStats = typeof attackerDigimon.baseStats === 'string'
          ? JSON.parse(attackerDigimon.baseStats)
          : attackerDigimon.baseStats
        const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
          ? JSON.parse((attackerDigimon as any).bonusStats)
          : (attackerDigimon as any).bonusStats

        attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

        // Parse attacks to get tag bonuses
        if (attackerDigimon.attacks) {
          const attacks = typeof attackerDigimon.attacks === 'string'
            ? JSON.parse(attackerDigimon.attacks)
            : attackerDigimon.attacks

          const attackDef = attacks?.find((a: any) => a.id === request.data.attackId)

          if (attackDef?.tags && Array.isArray(attackDef.tags)) {
            for (const tag of attackDef.tags) {
              // Weapon tags add to damage
              const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
              if (weaponMatch) {
                const rankStr = weaponMatch[1]
                const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
                const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
                attackBaseDamage += rank
              }

              // Armor Piercing tags
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

    // Get target armor
    let targetArmor = 0
    const targetParticipant = participants.find((p: any) => p.id === request.targetParticipantId)

    if (targetParticipant?.type === 'digimon') {
      const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, request.data.targetEntityId))
      if (targetDigimon) {
        const targetBaseStats = typeof targetDigimon.baseStats === 'string'
          ? JSON.parse(targetDigimon.baseStats)
          : targetDigimon.baseStats
        const targetBonusStats = typeof (targetDigimon as any).bonusStats === 'string'
          ? JSON.parse((targetDigimon as any).bonusStats)
          : (targetDigimon as any).bonusStats

        targetArmor = (targetBaseStats?.armor ?? 0) + (targetBonusStats?.armor ?? 0)

        // Add Guardian data optimization bonus (+2 armor)
        const targetQualities = typeof targetDigimon.qualities === 'string'
          ? JSON.parse(targetDigimon.qualities)
          : targetDigimon.qualities
        const targetDataOpt = targetQualities?.find((q: any) => q.id === 'data-optimization')
        if (targetDataOpt?.choiceId === 'guardian') {
          targetArmor += 2
        }
      }
    } else if (targetParticipant?.type === 'tamer') {
      const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, request.data.targetEntityId))
      if (targetTamer) {
        const attrs = typeof targetTamer.attributes === 'string' ? JSON.parse(targetTamer.attributes) : targetTamer.attributes
        const skills = typeof targetTamer.skills === 'string' ? JSON.parse(targetTamer.skills) : targetTamer.skills
        targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
      }
    }

    // Calculate final damage
    let damageDealt = 0
    if (hit) {
      const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
      damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
    }

    // Apply damage to target and auto-apply attack effects
    let appliedEffectName: string | null = null

    // Look up attack definition for effect
    let attackDef: any = null
    if (attackerParticipant?.type === 'digimon') {
      const [attackerDigimonForEffect] = await db.select().from(digimon).where(eq(digimon.id, request.data.attackerEntityId))
      if (attackerDigimonForEffect?.attacks) {
        const attacksList = typeof attackerDigimonForEffect.attacks === 'string'
          ? JSON.parse(attackerDigimonForEffect.attacks)
          : attackerDigimonForEffect.attacks
        attackDef = attacksList?.find((a: any) => a.id === request.data.attackId)
      }
    }

    participants = participants.map((p: any) => {
      if (p.id === request.targetParticipantId && hit) {
        const updated = {
          ...p,
          currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt),
        }

        // Auto-apply effect if attack has one and conditions are met
        if (attackDef?.effect) {
          const shouldApply = attackDef.type === 'damage' ? damageDealt >= 2 : true
          if (shouldApply) {
            const effectDuration = Math.max(1, netSuccesses)
            const alignment = EFFECT_ALIGNMENT[attackDef.effect]
            const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
            const newEffect = {
              id: `effect-${Date.now()}`,
              name: attackDef.effect,
              type: effectType,
              duration: effectDuration,
              source: request.data.attackerName || 'Attack',
              description: '',
            }
            updated.activeEffects = [...(p.activeEffects || []), newEffect]
            appliedEffectName = attackDef.effect
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

        // Update evolution line to previous stage
        await db.update(evolutionLines).set({
          currentStageIndex: previousState.stageIndex,
          updatedAt: new Date(),
        }).where(eq(evolutionLines.id, damagedTarget.evolutionLineId))

        // Get old and new names for log
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

      // Damage calculation breakdown (same as NPC attacks)
      baseDamage: attackBaseDamage,
      netSuccesses: netSuccesses,
      targetArmor: targetArmor,
      armorPiercing: armorPiercing,
      effectiveArmor: hit ? Math.max(0, targetArmor - armorPiercing) : undefined,
      finalDamage: hit ? damageDealt : 0,
      hit: hit,
    }

    battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : [])]

    // Update participants and battleLog in the updateData
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
