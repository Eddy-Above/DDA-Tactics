import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { resolveParticipantName } from '../../../../utils/participantName'

interface AttackActionBody {
  participantId: string
  attackId: string
  targetId: string
  accuracyDicePool: number
  accuracySuccesses: number
  accuracyDiceResults: number[]
  tamerId: string
  bolstered?: boolean
  bolsterType?: 'damage-accuracy' | 'bit-cpu'
  hugePowerUsed?: boolean
  hugePowerAttackRange?: 'melee' | 'ranged'
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<AttackActionBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.participantId || !body.attackId || !body.targetId || !body.tamerId ||
      body.accuracyDicePool === undefined || body.accuracySuccesses === undefined ||
      !body.accuracyDiceResults) {
    throw createError({
      statusCode: 400,
      message: 'participantId, attackId, targetId, accuracyDicePool, accuracySuccesses, accuracyDiceResults, and tamerId are required',
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

  // Parse JSON fields
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

  const participants = parseJsonField(encounter.participants) || []
  const turnOrder = parseJsonField(encounter.turnOrder) || []
  const battleLog = parseJsonField(encounter.battleLog) || []
  const pendingRequests = parseJsonField(encounter.pendingRequests) || []

  // Validate participant exists and is active
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({
      statusCode: 404,
      message: 'Participant not found',
    })
  }

  // Check if participant can act (direct turn or partner digimon on tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  let canAct = actor.id === currentTurnParticipantId

  // If actor is a digimon and it's not directly their turn,
  // check if it's their partner tamer's turn
  if (!canAct && actor.type === 'digimon') {
    // Find current turn participant
    const currentTurnParticipant = participants.find((p: any) => p.id === currentTurnParticipantId)

    // Check if current participant is a tamer
    if (currentTurnParticipant?.type === 'tamer') {
      // Look up digimon to get partnerId
      const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))

      if (digimonEntity?.partnerId === currentTurnParticipant.entityId) {
        canAct = true
      }
    }
  }

  if (!canAct) {
    throw createError({
      statusCode: 403,
      message: 'It is not this participant\'s turn',
    })
  }

  // Validate target exists
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    })
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
        const attacks = typeof actorDigimon.attacks === 'string'
          ? JSON.parse(actorDigimon.attacks) : actorDigimon.attacks
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

  // Attacks cost 1 simple action, or 2 if bolstered
  const actionCostSimple = body.bolstered ? 2 : 1

  // Validate participant has enough actions
  if ((actor.actionsRemaining?.simple || 0) < actionCostSimple) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Create new participant with decremented actions and tracked used attack
  // Dodge penalty is incremented later when dodge response is processed (responses.post.ts)
  // Also consume any "Directed" effect on the attacker (bonus was applied client-side to accuracy pool)
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      const updated: any = {
        ...p,
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCostSimple),
        },
        usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
      // Track bolster usage for digimon
      if (body.bolstered && p.type === 'digimon') {
        updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
        if (body.bolsterType === 'bit-cpu') {
          updated.lastBitCpuBolsterRound = encounter.round
        }
      }
      // Track Huge Power usage for ranged attacks (once per round)
      if (body.hugePowerUsed && body.hugePowerAttackRange === 'ranged') {
        updated.lastHugePowerRound = encounter.round
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

  // Resolve target name
  let targetName = 'Unknown'
  if (target.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    targetName = tamerEntity?.name || `Tamer ${target.entityId}`
  } else if (target.type === 'digimon') {
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    const baseName = targetDigimon?.name || `Digimon ${target.entityId}`
    targetName = resolveParticipantName(target, participants, baseName, targetDigimon?.isEnemy || false)
  }

  // Add battle log entry for the attack
  const attackLogEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: actorName,
    action: 'Attack',
    target: targetName,
    result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
    damage: null,
    effects: ['Attack', 'Accuracy Roll'],
  }

  const updatedBattleLog = [...battleLog, attackLogEntry]

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

    const updateData: any = {
      participants: JSON.stringify(updatedParticipants),
      battleLog: JSON.stringify(updatedBattleLog),
      updatedAt: new Date(),
    }

    await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

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

  // Save validated participants (action deducted) and battle log to DB first
  await db.update(encounters).set({
    participants: JSON.stringify(updatedParticipants),
    battleLog: JSON.stringify(updatedBattleLog),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Delegate to intercede-offer endpoint for intercede/dodge/NPC-resolve logic
  // skipActionDeduction=true since we already deducted actions above
  const result = await $fetch(`/api/encounters/${encounterId}/actions/intercede-offer`, {
    method: 'POST',
    body: {
      attackerId: body.participantId,
      targetId: body.targetId,
      accuracySuccesses: body.accuracySuccesses,
      accuracyDice: body.accuracyDiceResults,
      attackId: body.attackId,
      attackData: {
        dicePool: body.accuracyDicePool,
      },
      bolstered: body.bolstered || false,
      bolsterType: body.bolsterType,
      hugePowerUsed: body.hugePowerUsed || false,
      hugePowerAttackRange: body.hugePowerAttackRange,
      skipActionDeduction: true,
    },
  })

  return result
})
