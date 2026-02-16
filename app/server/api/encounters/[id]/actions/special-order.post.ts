import { eq } from 'drizzle-orm'
import { db, encounters, tamers, digimon } from '../../../../db'
import { getUnlockedSpecialOrders, getOrderActionCost } from '../../../../../utils/specialOrders'

interface SpecialOrderBody {
  participantId: string
  orderName: string
  targetId?: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SpecialOrderBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId || !body.orderName) {
    throw createError({ statusCode: 400, message: 'participantId and orderName are required' })
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
  const turnOrder = parseJsonField(encounter.turnOrder)
  const battleLog = parseJsonField(encounter.battleLog)

  // Find tamer participant
  const participant = participants.find((p: any) => p.id === body.participantId)
  if (!participant) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  if (participant.type !== 'tamer') {
    throw createError({ statusCode: 400, message: 'Only tamers can use special orders' })
  }

  // Validate participant can act
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]
  if (participant.id !== currentTurnParticipantId) {
    throw createError({ statusCode: 400, message: 'Not this participant\'s turn' })
  }

  // Fetch tamer data to verify unlocked orders
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
  if (!tamer) {
    throw createError({ statusCode: 404, message: 'Tamer not found' })
  }

  let tamerAttributes
  let tamerXpBonuses

  try {
    tamerAttributes = typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes) : tamer.attributes
    tamerXpBonuses = typeof tamer.xpBonuses === 'string' ? JSON.parse(tamer.xpBonuses) : tamer.xpBonuses
  } catch (e: any) {
    throw createError({ statusCode: 400, message: `Failed to parse tamer data: ${e.message}` })
  }

  const unlockedOrders = getUnlockedSpecialOrders(tamerAttributes, tamerXpBonuses, tamer.campaignLevel)
  const order = unlockedOrders.find(o => o.name === body.orderName)

  if (!order) {
    throw createError({ statusCode: 400, message: `Order "${body.orderName}" is not unlocked` })
  }

  // Check if already used
  const usedOrders = participant.usedSpecialOrders || []
  if (usedOrders.includes(body.orderName)) {
    throw createError({ statusCode: 400, message: `Order "${body.orderName}" has already been used` })
  }

  // Check action cost
  const actionCost = getOrderActionCost(order.type)
  if ((participant.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({ statusCode: 400, message: `Not enough actions (requires ${actionCost} simple action(s))` })
  }

  // Find the actual partner via DB lookup
  let partnerParticipant: any = null
  for (const p of participants) {
    if (p.type !== 'digimon') continue
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
    if (dig?.partnerId === participant.entityId) {
      partnerParticipant = p
      break
    }
  }

  // Apply mechanical effects
  let effectDescription = ''

  switch (body.orderName) {
    case 'Energy Burst': {
      if (!partnerParticipant) {
        throw createError({ statusCode: 400, message: 'No partner digimon found' })
      }
      const healAmount = Math.min(5, partnerParticipant.currentWounds || 0)
      participants = participants.map((p: any) => {
        if (p.id === partnerParticipant.id) {
          return { ...p, currentWounds: Math.max(0, (p.currentWounds || 0) - 5) }
        }
        return p
      })
      effectDescription = `Partner healed ${healAmount} wound(s)`
      break
    }

    case 'Swagger': {
      if (!partnerParticipant) {
        throw createError({ statusCode: 400, message: 'No partner digimon found' })
      }
      participants = participants.map((p: any) => {
        if (p.id === partnerParticipant.id) {
          const effects = [...(p.activeEffects || [])]
          effects.push({
            id: `effect-${Date.now()}-taunt`,
            name: 'Taunt',
            type: 'buff',
            duration: 3,
            source: tamer.name,
            description: 'Auto-aggro at CPUx2',
          })
          return { ...p, activeEffects: effects }
        }
        return p
      })
      effectDescription = 'Partner gains Taunt for 3 rounds'
      break
    }

    case 'Enemy Scan': {
      if (!body.targetId) {
        throw createError({ statusCode: 400, message: 'Enemy Scan requires a target' })
      }
      const target = participants.find((p: any) => p.id === body.targetId)
      if (!target) {
        throw createError({ statusCode: 404, message: 'Target not found' })
      }
      participants = participants.map((p: any) => {
        if (p.id === body.targetId) {
          const effects = [...(p.activeEffects || [])]
          effects.push({
            id: `effect-${Date.now()}-debilitate`,
            name: 'Debilitate',
            type: 'debuff',
            duration: 1,
            source: tamer.name,
            description: '-2 to all stats except health for 1 round',
          })
          return { ...p, activeEffects: effects }
        }
        return p
      })
      effectDescription = 'Target debilitated (-2 all stats for 1 round)'
      break
    }

    case 'Tough it Out!': {
      if (!partnerParticipant) {
        throw createError({ statusCode: 400, message: 'No partner digimon found' })
      }
      // Remove one debuff/status effect
      const debuffs = (partnerParticipant.activeEffects || []).filter(
        (e: any) => e.type === 'debuff' || e.type === 'status'
      )
      if (debuffs.length > 0) {
        const removedEffect = debuffs[0] // Remove the first one
        participants = participants.map((p: any) => {
          if (p.id === partnerParticipant.id) {
            return {
              ...p,
              activeEffects: (p.activeEffects || []).filter((e: any) => e.id !== removedEffect.id),
            }
          }
          return p
        })
        effectDescription = `Purified: removed ${removedEffect.name}`
      } else {
        effectDescription = 'No negative effects to purify'
      }
      break
    }

    default: {
      // Log-only effect — GM resolves manually
      effectDescription = order.effect
      break
    }
  }

  // Deduct actions and mark as used
  participants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost) },
        usedSpecialOrders: [...(p.usedSpecialOrders || []), body.orderName],
      }
    }
    return p
  })

  // Add battle log entry
  const logEntry = {
    id: `log-${Date.now()}-special-order`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.participantId,
    actorName: tamer.name,
    action: `Special Order: ${body.orderName}`,
    target: body.targetId ? participants.find((p: any) => p.id === body.targetId)?.entityId : null,
    result: effectDescription,
    damage: null,
    effects: [body.orderName],
  }

  // Update encounter
  await db.update(encounters).set({
    participants: JSON.stringify(participants) as any,
    battleLog: JSON.stringify([...battleLog, logEntry]) as any,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

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
