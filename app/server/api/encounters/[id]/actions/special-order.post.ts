import { eq, inArray } from 'drizzle-orm'
import { db, encounters, tamers, digimon, campaigns } from '../../../../db'
import { getUnlockedSpecialOrders, getOrderActionCost, getOrderUsageLimit } from '../../../../../utils/specialOrders'
import { specialOrdersData } from '../../../../../data/special-orders'
import { applyEffectToParticipant } from '../../../../utils/applyEffect'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'
import { combatTurnKey } from '../../../../../utils/specialOrderCombat'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { isRequestAnswered } from '../../../../../utils/requestState'
import { queueStrikeLastCounter } from '../../../../utils/strikeLast'
import { deferSpecialOrderCost } from '../../../../../utils/intercedeActions'

interface SpecialOrderBody {
  participantId: string
  orderName: string
  targetId?: string
  partnerId?: string
  effectId?: string
  requestId?: string
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

  return serializeIntercedeClaim(encounterId, async () => {

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = encounter.participants
  const turnOrder = encounter.turnOrder
  const battleLog = encounter.battleLog
  let pendingRequests: any[] = encounter.pendingRequests || []
  let resolvedStrikeLast: any = null

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
  if (participant.id !== currentTurnParticipantId && body.orderName !== 'Strike Last!') {
    throw createError({ statusCode: 400, message: 'Not this participant\'s turn' })
  }

  // Fetch tamer data to verify unlocked orders
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
  if (!tamer) {
    throw createError({ statusCode: 404, message: 'Tamer not found' })
  }

  const tamerAttributes = tamer.attributes
  const tamerXpBonuses = tamer.xpBonuses

  // Look up campaign level from the campaign
  let campaignLevel: string = 'standard'
  if (tamer.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, tamer.campaignId))
    if (campaign) campaignLevel = campaign.level
  }

  const unlockedOrders = getUnlockedSpecialOrders(tamerAttributes, tamerXpBonuses, campaignLevel as any)
  const order = unlockedOrders.find(o => o.name === body.orderName)

  if (!order) {
    throw createError({ statusCode: 400, message: `Order "${body.orderName}" is not unlocked` })
  }

  if (order.type === 'Passive' || body.orderName === 'Fateful Intervention' || body.orderName === 'Quick Reaction') {
    throw createError({ statusCode: 400, message: body.orderName === 'Quick Reaction'
      ? 'Declare Quick Reaction on the incoming attack'
      : 'This order is resolved through its combat trigger' })
  }

  // Boss quality: Demoralize — block orders whose governing attribute has been demoralized
  if (participant.demoralizedAttributes) {
    const governingAttr = Object.entries(specialOrdersData).find(([, orders]) =>
      orders.some(o => o.name === body.orderName)
    )?.[0]
    if (governingAttr && participant.demoralizedAttributes[governingAttr as keyof typeof participant.demoralizedAttributes] !== undefined) {
      throw createError({
        statusCode: 400,
        message: `Order "${body.orderName}" is unavailable — ${governingAttr} was demoralized`,
      })
    }
  }

  // Check if already used (per-battle)
  const usedOrders = participant.usedSpecialOrders || []
  if (usedOrders.includes(body.orderName)) {
    throw createError({ statusCode: 400, message: `Order "${body.orderName}" has already been used this battle` })
  }

  // Check per-day usage limit
  const usageLimit = getOrderUsageLimit(order.type)
  if (usageLimit === 'per-day') {
    const usedPerDayOrders = tamer.usedPerDayOrders || []
    if (usedPerDayOrders.includes(body.orderName)) {
      throw createError({ statusCode: 400, message: `Order "${body.orderName}" has already been used today` })
    }
  }

  // Check action cost
  const actionCost = getOrderActionCost(order.type)
  if ((participant.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({ statusCode: 400, message: `Not enough actions (requires ${actionCost} simple action(s))` })
  }

  // Find the actual partner via DB lookup
  const partnerCandidates = participants.filter((p: any) => p.type === 'digimon' && !p.inReserve && !!p.isEnemy === !!participant.isEnemy)
  const candidateRecords = partnerCandidates.length
    ? await db.select().from(digimon).where(inArray(digimon.id, partnerCandidates.map((p: any) => p.entityId)))
    : []
  const partners = partnerCandidates.filter((p: any) => candidateRecords.some(d => d.id === p.entityId && d.partnerId === participant.entityId))
  const partnerParticipant: any = body.partnerId ? partners.find((p: any) => p.id === body.partnerId) : partners[0]
  if (!partnerParticipant) throw createError({ statusCode: 400, message: 'No active partner Digimon found' })
  const patchPartner = (patch: any) => { participants = participants.map((p: any) => p.id === partnerParticipant.id ? { ...p, ...patch } : p) }
  const enemyTarget = () => {
    const target = participants.find((p: any) => p.id === body.targetId)
    if (!target || !['digimon', 'tamer'].includes(target.type) || (body.orderName === 'Enemy Scan' && target.type !== 'digimon') || target.inReserve || !!target.isEnemy === !!partnerParticipant.isEnemy) {
      throw createError({ statusCode: 400, message: 'Choose an enemy Digimon target' })
    }
    return target
  }

  // Apply mechanical effects
  let effectDescription = ''

  switch (body.orderName) {
    case 'Strike Fast!': {
      if (partnerParticipant.lastMovedTurnKey !== combatTurnKey(encounter.round ?? 0, encounter.currentTurnIndex ?? 0)) {
        throw createError({ statusCode: 400, message: 'Your partner must move this turn before Strike Fast can be declared' })
      }
      patchPartner({ strikeFastReady: true, strikeFastTurnKey: combatTurnKey(encounter.round ?? 0, encounter.currentTurnIndex ?? 0) })
      effectDescription = 'Next attack this turn halves target Dodge; Huge Power and Overkill cannot trigger'
      break
    }
    case 'Finishing Touch': {
      patchPartner({ finishingTouchReady: true })
      effectDescription = 'Next attack counts 4s as Accuracy successes; Huge Power and Overkill cannot trigger'
      break
    }
    case 'Decimation': {
      patchPartner({ decimationReady: true })
      effectDescription = 'Partner can use its Signature Move from round 2'
      break
    }
    case 'Peak Performance': {
      patchPartner({ activeEffects: applyEffectToParticipant(
        (partnerParticipant.activeEffects || []).filter((e: any) => e.name !== 'Bastion'),
        { name: 'Bastion', type: 'buff', duration: 1, potency: 2, source: tamer.name,
          description: '+2 to every stat except Health for one round' },
      ) })
      effectDescription = 'Partner gains Bastion (+2 to all stats except Health) for one round'
      break
    }
    case 'Strike Last!': {
      const incoming: any = encounter.pendingRequests.find((r: any) => r.id === body.requestId)
      const data = incoming?.data
      const targetIds = [incoming?.targetParticipantId, data?.targetId, ...(data?.digimonAreaTargetIds || []), ...(data?.tamerAreaTargetIds || []), ...(data?.originalTargetIds || []), ...(data?.allTargetIds || [])]
      const attackerId = data?.attackerParticipantId ?? data?.attackerId
      const attacker = participants.find((p: any) => p.id === attackerId)
      if (!incoming || !['dodge-roll', 'intercede-offer', 'strike-last-offer'].includes(incoming.type) || isRequestAnswered(incoming, encounter.requestResponses)
        || (incoming.type === 'strike-last-offer' && data.resolvedRound !== encounter.round)
        || !targetIds.includes(partnerParticipant.id) || !attacker || attacker.type !== 'digimon' || !!attacker.isEnemy === !!partnerParticipant.isEnemy) {
        throw createError({ statusCode: 400, message: 'Strike Last requires an unanswered attack against your partner from an enemy Digimon' })
      }
      patchPartner({ strikeLastCounter: { attackerId, groupId: data.intercedeGroupId ?? incoming.id, tamerId: participant.entityId } })
      if (incoming.type === 'strike-last-offer') resolvedStrikeLast = incoming
      effectDescription = 'Partner will make a Counter Blow after this attack, hit or miss; Tamer owes one action next turn'
      break
    }
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
      const target = enemyTarget()
      const derived = await getDigimonDerivedStats(partnerParticipant.entityId, partnerParticipant)
      const cpu = derived?.cpu ?? 0
      participants = participants.map((p: any) => p.id === target.id ? {
        ...p, activeEffects: applyEffectToParticipant((p.activeEffects || []).filter((e: any) => e.name !== 'Taunt'), {
          name: 'Taunt', type: 'debuff', duration: 3, potency: cpu * 2, source: partnerParticipant.id,
          description: `Swagger: -${cpu * 2} Accuracy when not attacking the taunting partner`,
        }),
      } : p)
      effectDescription = `Target is Taunted by partner (CPU × 2 = ${cpu * 2}) for 3 rounds`
      break
    }

    case 'Enemy Scan': {
      if (!body.targetId) {
        throw createError({ statusCode: 400, message: 'Enemy Scan requires a target' })
      }
      const target = enemyTarget()
      participants = participants.map((p: any) => {
        if (p.id === body.targetId) {
          const effects = (p.activeEffects || []).filter((e: any) => e.name !== 'Debilitate')
          effects.push({
            id: `effect-${Date.now()}-debilitate`,
            name: 'Debilitate',
            type: 'debuff',
            duration: 1,
            source: tamer.name,
            description: '-2 to all stats except health for 1 round',
            potency: 2,
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
        const removedEffect = body.effectId ? debuffs.find((e: any) => e.id === body.effectId) : debuffs.length === 1 ? debuffs[0] : null
        if (!removedEffect) throw createError({ statusCode: 400, message: 'Choose the negative effect to Purify' })
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
      throw createError({ statusCode: 400, message: 'This order has no active combat declaration' })
    }
  }

  // Deduct actions and mark as used
  participants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      const owing = body.orderName === 'Strike Last!' ? deferSpecialOrderCost(p, encounter.round ?? 0) : p
      return {
        ...owing,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost) },
        usedSpecialOrders: [...(p.usedSpecialOrders || []), body.orderName],
      }
    }
    return p
  })

  if (resolvedStrikeLast) {
    const queued = queueStrikeLastCounter(participants, pendingRequests.filter(r => r.id !== resolvedStrikeLast.id), resolvedStrikeLast)
    participants = queued.participants
    pendingRequests = queued.pendingRequests
  }

  // Add battle log entry
  const logEntry = {
    id: `log-${Date.now()}-special-order`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.participantId,
    actorName: tamer.name,
    action: `Special Order: ${body.orderName}`,
    target: body.targetId ? participants.find((p: any) => p.id === body.targetId)?.entityId ?? null : null,
    result: effectDescription,
    damage: null,
    effects: [body.orderName],
  }

  // If per-day order, persist usage to tamer record
  if (usageLimit === 'per-day') {
    const usedPerDayOrders = tamer.usedPerDayOrders || []
    await db.update(tamers).set({
      usedPerDayOrders: [...usedPerDayOrders, body.orderName],
      updatedAt: new Date(),
    }).where(eq(tamers.id, tamer.id))
  }

  // Update encounter
  await db.update(encounters).set({
    participants,
    pendingRequests,
    battleLog: [...battleLog, logEntry],
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
  })
})
