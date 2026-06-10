import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { resolveParticipantName } from '../../../../utils/participantName'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'

interface ClashActionBody {
  clashId: string
  participantId: string
  tamerId: string
  actionType: 'attack' | 'end' | 'pin' | 'throw'
  // For attack: pass through to intercede-offer
  attackId?: string
  attackName?: string
  accuracySuccesses?: number
  accuracyDiceResults?: number[]
  accuracyDicePool?: number
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<ClashActionBody>(event)

  if (!encounterId) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  if (!body.clashId || !body.participantId || !body.actionType) {
    throw createError({ statusCode: 400, message: 'clashId, participantId, and actionType are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })

  let participants = encounter.participants
  let battleLog = encounter.battleLog

  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) throw createError({ statusCode: 404, message: 'Participant not found' })
  if (!actor.clash || actor.clash.clashId !== body.clashId) {
    throw createError({ statusCode: 400, message: 'You are not in this clash' })
  }
  if (!actor.clash.isController) {
    throw createError({ statusCode: 403, message: 'Only the clash controller can take clash actions' })
  }
  if (actor.clash.clashCheckNeeded) {
    throw createError({ statusCode: 400, message: 'A clash check must be resolved before taking actions' })
  }

  // Check it's actor's turn (or partner tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const turnOrder = encounter.turnOrder
  const currentTurnParticipantId = turnOrder[currentIndex]
  let canAct = actor.id === currentTurnParticipantId
  if (!canAct && actor.type === 'digimon') {
    const currentTurnParticipant = participants.find((p: any) => p.id === currentTurnParticipantId)
    if (currentTurnParticipant?.type === 'tamer') {
      const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
      if (digimonEntity?.partnerId === currentTurnParticipant.entityId) canAct = true
    }
  }
  if (!canAct) throw createError({ statusCode: 403, message: "It is not this participant's turn" })

  const target = participants.find((p: any) => p.id === actor.clash.opponentParticipantId)
  if (!target) throw createError({ statusCode: 404, message: 'Clash opponent not found' })

  // Resolve names
  let actorName = 'Unknown'
  let targetName = 'Unknown'
  let actorDigimonEntity: any = null
  let targetDigimonEntity: any = null
  if (actor.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
    actorName = t?.name || 'Tamer'
  } else {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    actorDigimonEntity = d
    actorName = resolveParticipantName(actor, participants, d?.name || 'Digimon', d?.isEnemy || false)
  }
  if (target.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    targetName = t?.name || 'Tamer'
  } else {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    targetDigimonEntity = d
    targetName = resolveParticipantName(target, participants, d?.name || 'Digimon', d?.isEnemy || false)
  }

  if (body.actionType === 'end') {
    // Free action — no action cost
    // Both participants exit clash; set cooldown
    participants = participants.map((p: any) => {
      if (p.id === body.participantId || p.id === actor.clash.opponentParticipantId) {
        const { clash, ...rest } = p
        return {
          ...rest,
          clashCooldownUntilRound: (encounter.round || 0) + 1,
        }
      }
      return p
    })

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashend`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.participantId,
      actorName,
      action: 'Clash Ended',
      target: targetName,
      result: `${actorName} ends the clash. Both parties are adjacent. Neither can initiate a new clash until next round.`,
      damage: null,
      effects: ['Clash Ended'],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

  } else if (body.actionType === 'pin') {
    // Complex action (2 simple)
    if ((actor.actionsRemaining?.simple || 0) < 2) {
      throw createError({ statusCode: 403, message: 'Not enough actions remaining (need 2 Simple Actions for Pin)' })
    }

    // Get CPU scores for validation
    let actorCpu = 0
    let targetCpu = 0
    if (actorDigimonEntity) {
      const ds = await getDigimonDerivedStats(actor.entityId)
      actorCpu = ds?.cpu ?? 0
    } else if (actor.type === 'tamer') {
      const [t] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
      const attrs = t?.attributes || {}
      actorCpu = attrs.body ?? 0
    }
    if (targetDigimonEntity) {
      const ds = await getDigimonDerivedStats(target.entityId)
      targetCpu = ds?.cpu ?? 0
    } else if (target.type === 'tamer') {
      const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
      const attrs = t?.attributes || {}
      targetCpu = attrs.body ?? 0
    }

    const maxPins = Math.max(1, actorCpu - targetCpu)
    const pinsUsed = actor.clash.clashPinsUsed ?? 0
    if (pinsUsed >= maxPins) {
      throw createError({ statusCode: 403, message: `Pin limit reached (${maxPins} pin${maxPins !== 1 ? 's' : ''} allowed this clash)` })
    }

    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        return {
          ...p,
          actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 2) },
          clash: { ...p.clash, clashPinsUsed: pinsUsed + 1 },
        }
      }
      if (p.id === actor.clash.opponentParticipantId) {
        return {
          ...p,
          clash: { ...p.clash, isPinned: true },
        }
      }
      return p
    })

    const pinsRemaining = maxPins - (pinsUsed + 1)
    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashpin`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.participantId,
      actorName,
      action: 'Clash Pin',
      target: targetName,
      result: `${actorName} pins ${targetName} — they cannot contest control next turn. (${pinsRemaining} pin${pinsRemaining !== 1 ? 's' : ''} remaining this clash)`,
      damage: null,
      effects: ['Clash Pin'],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

  } else if (body.actionType === 'throw') {
    // Complex action (2 simple)
    if ((actor.actionsRemaining?.simple || 0) < 2) {
      throw createError({ statusCode: 403, message: 'Not enough actions remaining (need 2 Simple Actions for Throw)' })
    }

    // Get actor damage stat and target armor
    let actorDamage = 0
    let targetArmor = 0

    if (actorDigimonEntity) {
      const bs = actorDigimonEntity.baseStats || {}
      const bonusStats = (actorDigimonEntity as any).bonusStats || {}
      actorDamage = (bs.damage ?? 0) + (bonusStats.damage ?? 0)

      // Check Wrestlemania: -1 to Damage
      const actorQualities = actorDigimonEntity.qualities || []
      if (actorQualities.some((q: any) => q.choiceId === 'wrestlemania')) {
        actorDamage = Math.max(0, actorDamage - 1)
      }
    } else if (actor.type === 'tamer') {
      const [t] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
      const attrs = t?.attributes || {}
      const skills = t?.skills || {}
      actorDamage = (attrs.body ?? 0) + (skills.fight ?? 0)
    }

    if (targetDigimonEntity) {
      const bs = targetDigimonEntity.baseStats || {}
      const bonusStats = (targetDigimonEntity as any).bonusStats || {}
      targetArmor = (bs.armor ?? 0) + (bonusStats.armor ?? 0)
    } else if (target.type === 'tamer') {
      const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
      const attrs = t?.attributes || {}
      const skills = t?.skills || {}
      targetArmor = (attrs.body ?? 0) + (skills.endurance ?? 0)
    }

    // Reach-initiated clash: non-Reach controller deals half damage
    const actorQualities = actorDigimonEntity ? (actorDigimonEntity.qualities || []) : []
    const actorHasReach = actorQualities.some((q: any) => q.id === 'reach')
    const reachInitiated = actor.clash?.reachInitiated || target.clash?.reachInitiated
    if (reachInitiated && !actorHasReach) {
      actorDamage = Math.floor(actorDamage / 2)
    }

    const damageDealt = Math.max(1, actorDamage - targetArmor)

    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        const { clash, ...rest } = p
        return {
          ...rest,
          actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 2) },
          clashCooldownUntilRound: (encounter.round || 0) + 1,
        }
      }
      if (p.id === actor.clash.opponentParticipantId) {
        const { clash, ...rest } = p
        return {
          ...rest,
          currentWounds: Math.min((p.maxWounds || 999), (p.currentWounds || 0) + damageDealt),
          clashCooldownUntilRound: (encounter.round || 0) + 1,
        }
      }
      return p
    })

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashthrow`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.participantId,
      actorName,
      action: 'Clash Throw',
      target: targetName,
      result: `${actorName} throws ${targetName}, dealing ${damageDealt} wounds (${actorDamage} damage - ${targetArmor} armor, min 1). Clash ends.`,
      damage: damageDealt,
      effects: ['Clash Throw', 'Clash Ended'],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

  } else if (body.actionType === 'attack') {
    // Complex action (2 simple) — delegate to intercede-offer with clashAttack flag
    if ((actor.actionsRemaining?.simple || 0) < 2) {
      throw createError({ statusCode: 403, message: 'Not enough actions remaining (need 2 Simple Actions for Clash Attack)' })
    }
    if (!body.attackId || body.accuracySuccesses === undefined || !body.accuracyDiceResults) {
      throw createError({ statusCode: 400, message: 'attackId, accuracySuccesses, and accuracyDiceResults are required for attack action' })
    }

    // Deduct 2 simple actions
    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        return {
          ...p,
          actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 2) },
          usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
        }
      }
      return p
    })

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashattack`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.participantId,
      actorName,
      action: 'Clash Attack',
      target: targetName,
      result: `${actorName} uses a Clash Attack on ${targetName} (${body.accuracySuccesses} accuracy successes). Target defends at half dodge.`,
      damage: null,
      effects: ['Clash Attack'],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    // Auto-miss check
    if (body.accuracySuccesses === 0) {
      const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      return updated
    }

    // Delegate to intercede-offer with clashAttack: true
    const result = await $fetch(`/api/encounters/${encounterId}/actions/intercede-offer`, {
      method: 'POST',
      body: {
        attackerId: body.participantId,
        targetId: actor.clash.opponentParticipantId,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDiceResults,
        attackId: body.attackId,
        attackName: body.attackName,
        attackData: { dicePool: body.accuracyDicePool || 0 },
        skipActionDeduction: true,
        clashAttack: true,
      },
    })
    return result
  }

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
})
