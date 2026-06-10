import { eq } from 'drizzle-orm'
import { db, encounters, tamers, campaigns } from '../../../../db'
import { INSPIRATION_ACT_COST, INSPIRATION_FATEFUL_COST } from '../../../../../types'

interface SpendInspirationBody {
  participantId: string
  spendType: 'reroll' | 'modifier' | 'act-of-inspiration' | 'fateful-intervention'
  amount: number
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SpendInspirationBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId || !body.spendType || body.amount === undefined) {
    throw createError({ statusCode: 400, message: 'participantId, spendType, and amount are required' })
  }

  if (body.amount < 1) {
    throw createError({ statusCode: 400, message: 'amount must be at least 1' })
  }

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
      ? { ...p, currentInspiration: currentInspiration - body.amount }
      : p,
  )

  // Sync deduction to tamer DB record (inspiration → grantedInspiration → xpBonuses.inspiration)
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
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
  }

  await db.update(encounters).set({
    participants: updatedParticipants,
    battleLog: [...battleLog, newLog],
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
})
