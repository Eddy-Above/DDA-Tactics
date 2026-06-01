import { eq } from 'drizzle-orm'
import { db, encounters, tamers, campaigns } from '../../../../db'
import { getUnlockedSkillOrders, getSkillOrderActionCost } from '../../../../../utils/skillOrders'
import { getOrderUsageLimit } from '../../../../../utils/specialOrders'

interface SkillOrderBody {
  participantId: string
  orderName: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SkillOrderBody>(event)

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
    throw createError({ statusCode: 400, message: 'Only tamers can use skill orders' })
  }

  // Validate participant can act
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]
  if (participant.id !== currentTurnParticipantId) {
    throw createError({ statusCode: 400, message: 'Not this participant\'s turn' })
  }

  // Fetch tamer data to verify unlocked skill orders
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
  if (!tamer) {
    throw createError({ statusCode: 404, message: 'Tamer not found' })
  }

  let tamerAttributes
  let tamerSkills
  let tamerXpBonuses

  try {
    tamerAttributes = typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes) : tamer.attributes
    tamerSkills = typeof tamer.skills === 'string' ? JSON.parse(tamer.skills) : tamer.skills
    tamerXpBonuses = typeof tamer.xpBonuses === 'string' ? JSON.parse(tamer.xpBonuses) : tamer.xpBonuses
  } catch (e: any) {
    throw createError({ statusCode: 400, message: `Failed to parse tamer data: ${e.message}` })
  }

  // Look up campaign level + verify Skill Orders is enabled for the campaign
  let campaignLevel: string = 'standard'
  let skillOrdersEnabled = false
  if (tamer.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, tamer.campaignId))
    if (campaign) {
      campaignLevel = campaign.level
      const rules = (() => {
        try {
          return typeof campaign.rulesSettings === 'string'
            ? JSON.parse(campaign.rulesSettings)
            : (campaign.rulesSettings || {})
        } catch { return {} }
      })()
      skillOrdersEnabled = rules.skillOrders === true
    }
  }

  if (!skillOrdersEnabled) {
    throw createError({ statusCode: 400, message: 'Skill Orders are not enabled for this campaign' })
  }

  const unlockedOrders = getUnlockedSkillOrders(tamerSkills, tamerAttributes, tamerXpBonuses, campaignLevel as any)
  const order = unlockedOrders.find(o => o.name === body.orderName)

  if (!order) {
    throw createError({ statusCode: 400, message: `Skill order "${body.orderName}" is not unlocked` })
  }

  const usageLimit = getOrderUsageLimit(order.type)

  // Check if already used this battle (per-day orders are also marked here for immediate feedback)
  const usedOrders = participant.usedSkillOrders || []
  if (usedOrders.includes(body.orderName)) {
    throw createError({ statusCode: 400, message: `Skill order "${body.orderName}" has already been used this battle` })
  }

  // Check per-day usage limit
  if (usageLimit === 'per-day') {
    const usedPerDay: string[] = typeof tamer.usedPerDaySkillOrders === 'string'
      ? JSON.parse(tamer.usedPerDaySkillOrders)
      : (tamer.usedPerDaySkillOrders || [])
    if (usedPerDay.includes(body.orderName)) {
      throw createError({ statusCode: 400, message: `Skill order "${body.orderName}" has already been used today` })
    }
  }

  // Check action cost
  const actionCost = getSkillOrderActionCost(order.type)
  if ((participant.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({ statusCode: 400, message: `Not enough actions (requires ${actionCost} simple action(s))` })
  }

  // All skill order effects are resolved manually by the GM — log only.
  const effectDescription = order.effect

  // Deduct actions and (for limited orders) mark as used this battle.
  // Passive orders with no usage cap (e.g. Bravado) are repeatable, so only their action cost applies.
  participants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      const updated: any = {
        ...p,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost) },
      }
      if (usageLimit !== 'passive') {
        updated.usedSkillOrders = [...(p.usedSkillOrders || []), body.orderName]
      }
      return updated
    }
    return p
  })

  // Add battle log entry
  const logEntry = {
    id: `log-${Date.now()}-skill-order`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.participantId,
    actorName: tamer.name,
    action: `Skill Order: ${body.orderName}`,
    target: null,
    result: effectDescription,
    damage: null,
    effects: [body.orderName],
  }

  // If per-day order, persist usage to tamer record
  if (usageLimit === 'per-day') {
    const usedPerDay: string[] = typeof tamer.usedPerDaySkillOrders === 'string'
      ? JSON.parse(tamer.usedPerDaySkillOrders)
      : (tamer.usedPerDaySkillOrders || [])
    await db.update(tamers).set({
      usedPerDaySkillOrders: JSON.stringify([...usedPerDay, body.orderName]) as any,
      updatedAt: new Date(),
    }).where(eq(tamers.id, tamer.id))
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
