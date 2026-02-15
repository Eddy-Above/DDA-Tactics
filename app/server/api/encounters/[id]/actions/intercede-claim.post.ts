import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { EFFECT_ALIGNMENT } from '../../../../../data/attackConstants'
// tamers already imported

interface IntercedeClaimBody {
  requestId: string
  interceptorParticipantId: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeClaimBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId || !body.interceptorParticipantId) {
    throw createError({ statusCode: 400, message: 'requestId and interceptorParticipantId are required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try { return JSON.parse(field) } catch { return [] }
    }
    return []
  }

  let participants = parseJsonField(encounter.participants)
  let pendingRequests = parseJsonField(encounter.pendingRequests)
  const battleLog = parseJsonField(encounter.battleLog)

  // Find the request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  const intercedeGroupId = request.data.intercedeGroupId

  // Atomic check: if any intercede-offer in this group is already resolved, 409
  const groupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)
  // If there are no group requests left, someone already claimed
  if (groupRequests.length === 0) {
    throw createError({ statusCode: 409, message: 'Another player already interceded' })
  }

  // Find interceptor
  const interceptor = participants.find((p: any) => p.id === body.interceptorParticipantId)
  if (!interceptor) {
    throw createError({ statusCode: 404, message: 'Interceptor not found' })
  }

  // Interceptor cannot be the same as the target
  if (body.interceptorParticipantId === request.data.targetId) {
    throw createError({ statusCode: 400, message: 'Interceptor cannot be the same as the target' })
  }

  // Determine if interceptor's turn has already happened this round
  const turnOrder = parseJsonField(encounter.turnOrder)
  const currentTurnIndex = encounter.currentTurnIndex || 0
  let turnHasGone = false

  if (interceptor.type === 'tamer') {
    const idx = turnOrder.indexOf(interceptor.id)
    turnHasGone = idx >= 0 && idx < currentTurnIndex
  } else if (interceptor.type === 'digimon') {
    // Partner digimon "turn" = their tamer's turn position
    const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    if (digimonEntity?.partnerId) {
      const tamerOfInterceptor = participants.find(
        (p: any) => p.type === 'tamer' && p.entityId === digimonEntity.partnerId
      )
      if (tamerOfInterceptor) {
        const idx = turnOrder.indexOf(tamerOfInterceptor.id)
        turnHasGone = idx >= 0 && idx < currentTurnIndex
      }
    }
  }

  // Validate against the INTERCEPTOR directly
  if (!turnHasGone) {
    // Must have an action to spend THIS round
    if ((interceptor.actionsRemaining?.simple || 0) < 1) {
      throw createError({ statusCode: 400, message: 'Not enough actions to intercede' })
    }
  } else {
    // Already acted — check deferred intercede cap (max 2 actions deferred)
    if ((interceptor.interceptPenalty || 0) >= 2) {
      throw createError({ statusCode: 400, message: 'No more intercede actions available for next round' })
    }
  }

  // Get interceptor name
  let interceptorName = 'Unknown'
  if (interceptor.type === 'digimon') {
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    interceptorName = dig?.name || 'Digimon'
  }

  // Resolve damage against interceptor with 0 dodge successes
  const { accuracySuccesses, attackerId, attackData, targetName } = request.data

  // Get attacker's base damage
  const attacker = participants.find((p: any) => p.id === attackerId)
  let attackBaseDamage = 0
  let armorPiercing = 0
  let npcAttackDef: any = null

  if (attacker?.type === 'digimon') {
    const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    if (attackerDigimon) {
      const baseStats = typeof attackerDigimon.baseStats === 'string' ? JSON.parse(attackerDigimon.baseStats) : attackerDigimon.baseStats
      const bonusStats = typeof attackerDigimon.bonusStats === 'string' ? JSON.parse(attackerDigimon.bonusStats) : attackerDigimon.bonusStats
      attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

      // Get attack def for tags and effects
      const attacks = typeof attackerDigimon.attacks === 'string' ? JSON.parse(attackerDigimon.attacks) : attackerDigimon.attacks
      npcAttackDef = attacks?.find((a: any) => a.id === request.data.attackId)

      if (npcAttackDef?.tags) {
        for (const tag of npcAttackDef.tags) {
          const weaponMatch = tag.match(/Weapon\s+(\w+)/i)
          if (weaponMatch) {
            const romanValues: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
            attackBaseDamage += romanValues[weaponMatch[1]] || 0
          }
          const apMatch = tag.match(/Armor Piercing\s+(\w+)/i)
          if (apMatch) {
            const romanValues: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
            armorPiercing = romanValues[apMatch[1]] || 0
          }
        }
      }
    }
  }

  // With 0 dodge, net successes = accuracy successes
  const netSuccesses = accuracySuccesses
  const hit = true // 0 dodge = always hit

  // Get interceptor's armor
  let interceptorArmor = 0
  if (interceptor.type === 'digimon') {
    const [interceptorDigimon] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    if (interceptorDigimon) {
      const baseStats = typeof interceptorDigimon.baseStats === 'string' ? JSON.parse(interceptorDigimon.baseStats) : interceptorDigimon.baseStats
      const bonusStats = typeof interceptorDigimon.bonusStats === 'string' ? JSON.parse(interceptorDigimon.bonusStats) : interceptorDigimon.bonusStats
      interceptorArmor = (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0)
    }
  } else if (interceptor.type === 'tamer') {
    const [interceptorTamer] = await db.select().from(tamers).where(eq(tamers.id, interceptor.entityId))
    if (interceptorTamer) {
      const attrs = typeof interceptorTamer.attributes === 'string' ? JSON.parse(interceptorTamer.attributes) : interceptorTamer.attributes
      const skills = typeof interceptorTamer.skills === 'string' ? JSON.parse(interceptorTamer.skills) : interceptorTamer.skills
      interceptorArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
    }
  }

  const effectiveArmor = Math.max(0, interceptorArmor - armorPiercing)
  const damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)

  // Apply damage to interceptor, deduct/defer actions, and apply effects
  let appliedEffectName: string | null = null
  participants = participants.map((p: any) => {
    if (p.id === body.interceptorParticipantId) {
      const updated = {
        ...p,
        currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt),
        // Immediate deduction if turn not gone; deferred penalty if already gone
        ...(!turnHasGone
          ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) } }
          : { interceptPenalty: (p.interceptPenalty || 0) + 1 }
        ),
      }

      // Auto-apply effect
      if (npcAttackDef?.effect) {
        const shouldApply = npcAttackDef.type === 'damage' ? damageDealt >= 2 : true
        if (shouldApply) {
          const effectDuration = Math.max(1, netSuccesses)
          const alignment = EFFECT_ALIGNMENT[npcAttackDef.effect]
          const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
          updated.activeEffects = [...(p.activeEffects || []), {
            id: `effect-${Date.now()}`,
            name: npcAttackDef.effect,
            type: effectType,
            duration: effectDuration,
            source: 'Attack',
            description: '',
          }]
          appliedEffectName = npcAttackDef.effect
        }
      }

      return updated
    }
    // Original target still gets the dodge penalty even though they didn't take the hit
    if (p.id === request.data.targetId) {
      return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
    }
    return p
  })

  // Remove all intercede-offer requests for this group
  pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

  // Add battle log entries
  const intercedeLog = {
    id: `log-${Date.now()}-intercede`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.interceptorParticipantId,
    actorName: interceptorName,
    action: `Interceded for ${targetName}!`,
    target: null,
    result: `Takes hit with 0 dodge - ${damageDealt} damage dealt`,
    damage: damageDealt,
    effects: appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede'],
    baseDamage: attackBaseDamage,
    netSuccesses,
    targetArmor: interceptorArmor,
    armorPiercing,
    effectiveArmor,
    finalDamage: damageDealt,
    hit: true,
  }

  // Update encounter
  await db.update(encounters).set({
    participants: JSON.stringify(participants),
    pendingRequests: JSON.stringify(pendingRequests),
    battleLog: JSON.stringify([...battleLog, intercedeLog]),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
    hazards: parseJsonField(updated.hazards),
  }
})
