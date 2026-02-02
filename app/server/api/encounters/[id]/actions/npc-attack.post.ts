import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'

interface NpcAttackBody {
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

  // Validate target
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    })
  }

  // Check actions
  const actionCost = 1
  if ((actor.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Decrement attacker actions
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost),
        },
      }
    }
    return p
  })

  // Compare successes and calculate outcome
  const netSuccesses = body.accuracySuccesses - body.dodgeSuccesses
  const hit = netSuccesses >= 0

  // Look up attack definition to get base damage
  // Note: Attack damage value may already include DP bonuses and quality modifiers
  // from the attack definition itself (e.g., Heavy quality, bonus DP spent)
  const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))

  let attackBaseDamage = 0
  if (attackerDigimon?.attacks) {
    // Parse attacks if it's a JSON string from database
    const attacks = typeof attackerDigimon.attacks === 'string'
      ? JSON.parse(attackerDigimon.attacks)
      : attackerDigimon.attacks

    const attackDef = attacks.find((a: any) => a.id === body.attackId)
    if (attackDef) {
      // Parse damage value (may be string like "5" or number)
      // This value already accounts for any DP bonuses or qualities applied to the move
      attackBaseDamage = typeof attackDef.damage === 'number'
        ? attackDef.damage
        : parseInt(attackDef.damage) || 0
    }
  }

  const damageDealt = hit ? (attackBaseDamage + netSuccesses) : 0

  // Apply damage to target
  const finalParticipants = updatedParticipants.map((p: any) => {
    if (p.id === body.targetId && hit) {
      return {
        ...p,
        currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt),
      }
    }
    return p
  })

  // Add battle log entries
  const attackLogEntry = {
    id: `log-${Date.now()}-attack`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: actor.type === 'tamer' ? `Tamer ${actor.entityId}` : `Digimon ${actor.entityId}`,
    action: 'Attack',
    target: target.type === 'tamer' ? `Tamer ${target.entityId}` : `Digimon ${target.entityId}`,
    result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
    damage: null,
    effects: ['Attack'],
  }

  const dodgeLogEntry = {
    id: `log-${Date.now()}-dodge`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: target.id,
    actorName: target.type === 'tamer' ? `Tamer ${target.entityId}` : `Digimon ${target.entityId}`,
    action: 'Dodge',
    target: null,
    result: `${body.dodgeDicePool}d6 => [${body.dodgeDiceResults.join(',')}] = ${body.dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
    damage: hit ? damageDealt : 0,
    effects: ['Dodge'],
  }

  const updatedBattleLog = [...battleLog, attackLogEntry, dodgeLogEntry]

  // Update encounter
  const updateData: any = {
    participants: JSON.stringify(finalParticipants),
    battleLog: JSON.stringify(updatedBattleLog),
    updatedAt: new Date(),
  }

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
