import { invalidateCombatRecord } from '../../../../utils/combatRecordCache'
import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { eq } from 'drizzle-orm'
import { db, encounters, tamers, digimon, campaigns } from '../../../../db'
import { INSPIRATION_ACT_COST, INSPIRATION_FATEFUL_COST } from '../../../../../types'
import { applyFatefulPool, validateFatefulDice, getFatefulModifier } from '../../../../../utils/fatefulIntervention'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { isRequestAnswered } from '../../../../../utils/requestState'
import { serverDodgeDefense, paidDodgeDiceBonus } from '../../../../utils/combatDodge'
import { combatAttackStats } from '../../../../../utils/combatDice'

interface SpendInspirationBody {
  participantId: string
  spendType: 'reroll' | 'modifier' | 'act-of-inspiration' | 'fateful-intervention'
  amount: number
  requestId?: string
  rollId?: string
  rollType?: 'accuracy' | 'dodge' | 'check'
  targetParticipantId?: string
  baseDicePool?: number
  bonusSign?: 1 | -1
  willpowerSign?: 1 | -1
  diceResults?: number[]
}

export default defineEncounterCommand(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SpendInspirationBody>(event)
  await authorizeEncounterIntent(event, encounterId, body, 'spend-inspiration')

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId || !body.spendType || body.amount === undefined) {
    throw createError({ statusCode: 400, message: 'participantId, spendType, and amount are required' })
  }

  if (!Number.isSafeInteger(body.amount) || body.amount < 1) {
    throw createError({ statusCode: 400, message: 'amount must be at least 1' })
  }
  if (!['reroll', 'modifier', 'act-of-inspiration', 'fateful-intervention'].includes(body.spendType)) {
    throw createError({ statusCode: 400, message: 'Unknown Inspiration spend type' })
  }
  if ((body.spendType === 'reroll' || body.spendType === 'modifier') && body.amount !== 1) {
    throw createError({ statusCode: 400, message: 'A re-roll or extra die costs 1 Inspiration' })
  }

  return serializeIntercedeClaim(encounterId, async () => {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter ${encounterId} not found` })
  }

  // Get campaign level for validating special spend types
  let campaignLevel: 'standard' | 'enhanced' | 'extreme' = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign?.level) campaignLevel = campaign.level as typeof campaignLevel
  }

  const participants: any[] = encounter.participants || []
  const battleLog: any[] = encounter.battleLog || []

  const participant = participants.find((p: any) => p.id === body.participantId)
  if (!participant) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  if (participant.type !== 'tamer') {
    throw createError({ statusCode: 403, message: 'Only tamers have Inspiration' })
  }

  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
  if (!tamer) throw createError({ statusCode: 404, message: 'Tamer not found' })
  let pendingRequests: any[] = encounter.pendingRequests || []
  let fatefulRollId: string | undefined
  if (body.spendType === 'fateful-intervention') {
    if (!body.rollType || !['accuracy', 'dodge', 'check'].includes(body.rollType)) {
      throw createError({ statusCode: 400, message: 'Choose the roll for Fateful Intervention' })
    }
    const willpower = (tamer.attributes?.willpower ?? 0) + (tamer.xpBonuses?.attributes?.willpower ?? 0)
    const choice = { bonusSign: body.bonusSign!, willpowerSign: body.willpowerSign!, diceResults: body.diceResults! }
    try {
      const modifier = getFatefulModifier(willpower, choice)
      if (body.requestId) {
        const request: any = pendingRequests.find(r => r.id === body.requestId)
        if (!request || request.type !== 'dodge-roll' || isRequestAnswered(request, encounter.requestResponses)) {
          throw new Error('That attack is no longer awaiting a defense')
        }
        if (body.rollType === 'accuracy') {
          const castId = request.data?.intercedeGroupId
          const siblings = pendingRequests.filter(r => r.id === request.id || (castId && r.data?.intercedeGroupId === castId))
          const dodgeSiblings = siblings.filter(r => r.type === 'dodge-roll')
          if (siblings.some(r => isRequestAnswered(r, encounter.requestResponses) || r.data?.fatefulAccuracy)) {
            throw new Error('That attack already has a defense or Fateful Intervention')
          }
          if (request.data?.totalTargetCount && request.data.totalTargetCount > dodgeSiblings.length) {
            throw new Error('Some targets of this area attack have already resolved')
          }
          const baseDicePool = request.data?.accuracyDice?.length ?? request.data?.attackData?.dicePool ?? 0
          const threshold = request.data?.finishingTouch ? 4 : request.data?.attackData?.orderModifiers?.successThreshold ?? 5
          const result = applyFatefulPool(baseDicePool, willpower, choice, threshold)
          const attacker = participants.find(p => p.id === request.data?.attackerParticipantId)
          if (attacker?.type === 'digimon') {
            const [record] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
            const attack = record?.attacks?.find((a: any) => a.id === request.data?.attackId) ?? request.data?.attackData
            result.successes += combatAttackStats(record, attacker, attack).automaticSuccesses
          }
          pendingRequests = pendingRequests.map(r => siblings.includes(r) ? {
            ...r, data: { ...r.data, accuracyDice: result.rolls, accuracySuccesses: result.successes,
              fatefulAccuracy: { ...choice, willpower, modifier, baseDicePool },
              attackData: { ...r.data?.attackData, dicePool: result.dicePool } },
          } : r)
        } else if (body.rollType === 'dodge') {
          if (request.data?.fatefulIntervention) throw new Error('That defense already has Fateful Intervention')
          const target = participants.find(p => p.id === request.targetParticipantId)
          if (!target) throw new Error('Defense target is unavailable')
          const [record] = target.type === 'digimon'
            ? await db.select().from(digimon).where(eq(digimon.id, target.entityId))
            : await db.select().from(tamers).where(eq(tamers.id, target.entityId))
          const defense = serverDodgeDefense(request, participants, record)
          if (defense.blocked) throw new Error('That target cannot dodge this attack')
          const baseDicePool = body.baseDicePool ?? defense.pool
          // Paid Inspiration dice already present on this defense may be retained.
          if (!Number.isInteger(baseDicePool) || baseDicePool < defense.pool
            || baseDicePool > defense.pool + paidDodgeDiceBonus(request)) throw new Error('Invalid Dodge pool')
          applyFatefulPool(baseDicePool, willpower, choice)
          pendingRequests = pendingRequests.map(r => r.id === request.id ? {
            ...r, data: { ...r.data, fatefulIntervention: { ...choice, willpower, modifier, baseDicePool } },
          } : r)
        } else throw new Error('Choose Accuracy or Dodge for an incoming attack')
      } else {
        if (!body.rollId) throw new Error('The current roll is required')
        fatefulRollId = body.rollId
        if ((participant.fatefulSpentRollIds || []).includes(fatefulRollId)) throw new Error('Fateful Intervention already affected that roll')
        if (body.rollType === 'check') validateFatefulDice(choice.diceResults, 3)
        else {
          if (!Number.isInteger(body.baseDicePool) || body.baseDicePool! < 0) throw new Error('Invalid dice pool')
          applyFatefulPool(body.baseDicePool!, willpower, choice)
        }
      }
    } catch (error: any) {
      throw createError({ statusCode: 400, message: error.message || 'Invalid Fateful Intervention choice' })
    }
  }

  // Validate spend amount matches rules cost for special types
  if (body.spendType === 'act-of-inspiration') {
    const requiredCost = INSPIRATION_ACT_COST[campaignLevel]
    if (body.amount !== requiredCost) {
      throw createError({
        statusCode: 400,
        message: `Act of Inspiration costs ${requiredCost} Inspiration at ${campaignLevel} campaign level`,
      })
    }
  }

  if (body.spendType === 'fateful-intervention') {
    const requiredCost = INSPIRATION_FATEFUL_COST[campaignLevel]
    if (body.amount !== requiredCost) {
      throw createError({
        statusCode: 400,
        message: `Fateful Intervention costs ${requiredCost} Inspiration at ${campaignLevel} campaign level`,
      })
    }
  }

  if (body.requestId && body.spendType !== 'fateful-intervention') {
    const request = pendingRequests.find(r => r.id === body.requestId)
    if (!request || request.type !== 'dodge-roll' || isRequestAnswered(request, encounter.requestResponses)) {
      throw createError({ statusCode: 409, message: 'That defense is no longer awaiting a roll' })
    }
    if (request.targetTamerId !== participant.entityId) {
      throw createError({ statusCode: 403, message: 'This defense does not belong to this Tamer' })
    }
    if (request.data?.fatefulIntervention) {
      throw createError({ statusCode: 409, message: 'Fateful Intervention has already fixed this defense\'s dice' })
    }
    const target = participants.find(p => p.id === request.targetParticipantId)
    if (!target) throw createError({ statusCode: 409, message: 'Defense target is unavailable' })
    const [record] = target.type === 'digimon'
      ? await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      : await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    if (serverDodgeDefense(request, participants, record).blocked) {
      throw createError({ statusCode: 409, message: 'That target cannot dodge this attack' })
    }
    if (body.spendType === 'act-of-inspiration' && request.data?.dodgeActPaid) {
      throw createError({ statusCode: 409, message: 'Act of Inspiration was already paid for this defense' })
    }
    const additionalDice = body.spendType === 'act-of-inspiration' ? 5 : body.spendType === 'modifier' ? 1 : 0
    pendingRequests = pendingRequests.map(r => r.id === request.id ? {
      ...r, data: { ...r.data, paidDodgeDiceBonus: paidDodgeDiceBonus(r) + additionalDice,
        ...(body.spendType === 'act-of-inspiration' ? { dodgeActPaid: true } : {}) },
    } : r)
  }

  const currentInspiration = participant.currentInspiration ?? 0
  if (currentInspiration < body.amount) {
    throw createError({
      statusCode: 400,
      message: `Insufficient Inspiration: have ${currentInspiration}, need ${body.amount}`,
    })
  }

  // Deduct from participant JSON
  const updatedParticipants = participants.map((p: any) =>
    p.id === body.participantId
      ? { ...p, currentInspiration: currentInspiration - body.amount,
        ...(fatefulRollId ? { fatefulSpentRollIds: [...(p.fatefulSpentRollIds || []).slice(-19), fatefulRollId] } : {}) }
      : p,
  )

  // Sync deduction to tamer DB record (inspiration → grantedInspiration → xpBonuses.inspiration)
  if (tamer) {
    const xpBonuses = tamer.xpBonuses || { attributes: {}, skills: {}, inspiration: 0 }

    let toDeduct = body.amount
    let newInspiration = tamer.inspiration ?? 1
    let newGranted = tamer.grantedInspiration ?? 0
    let newXpInspiration = xpBonuses.inspiration ?? 0

    // Deduct from base inspiration first, then granted, then xp-purchased
    const fromBase = Math.min(toDeduct, newInspiration)
    newInspiration -= fromBase
    toDeduct -= fromBase

    if (toDeduct > 0) {
      const fromGranted = Math.min(toDeduct, newGranted)
      newGranted -= fromGranted
      toDeduct -= fromGranted
    }

    if (toDeduct > 0) {
      newXpInspiration = Math.max(0, newXpInspiration - toDeduct)
    }

    await db.update(tamers).set({
      inspiration: newInspiration,
      grantedInspiration: newGranted,
      xpBonuses: { ...xpBonuses, inspiration: newXpInspiration },
      updatedAt: new Date(),
    }).where(eq(tamers.id, tamer.id))
    invalidateCombatRecord('tamer', tamer.id)
  }

  // Battle log entry
  const spendLabels: Record<string, string> = {
    'reroll': 're-roll',
    'modifier': 'a roll modifier',
    'act-of-inspiration': 'Act of Inspiration',
    'fateful-intervention': 'Fateful Intervention',
  }
  const participantName = tamer?.name ?? 'Tamer'
  const newLog = {
    id: `log-${Date.now()}-inspiration`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: body.participantId,
    actorName: participantName,
    action: 'Inspiration Spent',
    target: null,
    result: `${participantName} spends ${body.amount} Inspiration on ${spendLabels[body.spendType] ?? body.spendType} (${currentInspiration - body.amount} remaining)`,
    damage: null,
    effects: ['Inspiration', spendLabels[body.spendType] ?? body.spendType],
    ...(body.spendType === 'fateful-intervention' ? {
      result: `${participantName} spends ${body.amount} Inspiration on Fateful Intervention: ${body.rollType}, [${body.diceResults?.join(', ')}], ${body.bonusSign === 1 ? '+' : '-'}5 and ${body.willpowerSign === 1 ? '+' : '-'}Willpower (${currentInspiration - body.amount} remaining)`,
    } : {}),
  }

  await db.update(encounters).set({
    participants: updatedParticipants,
    ...(body.spendType === 'fateful-intervention' || body.requestId ? { pendingRequests } : {}),
    battleLog: [...battleLog, newLog],
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
  })
})
