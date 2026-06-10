import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { determineClashController, getClashSizeBonus } from '../../../../../data/attackConstants'
import { resolveParticipantName } from '../../../../utils/participantName'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'

interface ClashBreakBody {
  clashId: string
  breakerId: string
  tamerId: string
  roll: number
  diceResults: number[]
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<ClashBreakBody>(event)

  if (!encounterId) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  if (!body.clashId || !body.breakerId || !body.tamerId || body.roll === undefined || !body.diceResults) {
    throw createError({ statusCode: 400, message: 'clashId, breakerId, tamerId, roll, and diceResults are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })

  let participants = encounter.participants
  let battleLog = encounter.battleLog

  // Validate breaker exists and is not already in this clash
  const breaker = participants.find((p: any) => p.id === body.breakerId)
  if (!breaker) throw createError({ statusCode: 404, message: 'Breaker participant not found' })
  if (breaker.clash?.clashId === body.clashId) {
    throw createError({ statusCode: 400, message: 'You are already in this clash — use clash actions instead' })
  }

  // Validate breaker has enough actions (Complex = 2 simple)
  if ((breaker.actionsRemaining?.simple || 0) < 2) {
    throw createError({ statusCode: 403, message: 'Not enough actions remaining (need 2 Simple Actions to Break a Clash)' })
  }

  // Check it's breaker's turn (or partner tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const turnOrder = encounter.turnOrder
  const currentTurnParticipantId = turnOrder[currentIndex]
  let canAct = breaker.id === currentTurnParticipantId
  if (!canAct && breaker.type === 'digimon') {
    const currentTurnParticipant = participants.find((p: any) => p.id === currentTurnParticipantId)
    if (currentTurnParticipant?.type === 'tamer') {
      const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, breaker.entityId))
      if (digimonEntity?.partnerId === currentTurnParticipant.entityId) canAct = true
    }
  }
  if (!canAct) throw createError({ statusCode: 403, message: "It is not this participant's turn" })

  // Find both clash participants
  const clashParticipants = participants.filter((p: any) => p.clash?.clashId === body.clashId)
  if (clashParticipants.length !== 2) {
    throw createError({ statusCode: 400, message: 'Clash not found or already ended' })
  }

  const controller = clashParticipants.find((p: any) => p.clash?.isController)
  const controlled = clashParticipants.find((p: any) => !p.clash?.isController)
  if (!controller || !controlled) {
    throw createError({ statusCode: 400, message: 'Clash controller state is invalid' })
  }

  // Resolve breaker stats
  let breakerBody = 0
  let breakerSize = 'medium'
  let breakerHasBrawler = false
  let breakerIsGigantic = false
  let breakerDigimonEntity: any = null

  if (breaker.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, breaker.entityId))
    breakerDigimonEntity = d
    const ds = await getDigimonDerivedStats(breaker.entityId)
    breakerBody = ds?.body ?? 0
    breakerSize = d?.size || 'medium'
    breakerIsGigantic = breakerSize === 'gigantic'
    const qualities = d?.qualities || []
    breakerHasBrawler = qualities.some((q: any) => q.choiceId === 'brawler')
  } else if (breaker.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, breaker.entityId))
    const attrs = t?.attributes || {}
    breakerBody = attrs.body ?? 0
  }

  // Resolve controller stats
  let controllerAgility = 0
  let controllerBody = 0
  let controllerSize = 'medium'
  let controllerHasBrawler = false
  let controllerIsGigantic = false
  let controllerIsPlayer = false
  let controllerDigimonEntity: any = null
  let controllerQualities: any[] = []

  if (controller.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, controller.entityId))
    controllerDigimonEntity = d
    controllerIsPlayer = !!d?.partnerId
    const ds = await getDigimonDerivedStats(controller.entityId)
    controllerAgility = ds?.agility ?? 0
    controllerBody = ds?.body ?? 0
    controllerSize = d?.size || 'medium'
    controllerIsGigantic = controllerSize === 'gigantic'
    controllerQualities = d?.qualities || []
    controllerHasBrawler = controllerQualities.some((q: any) => q.choiceId === 'brawler')
  } else if (controller.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, controller.entityId))
    controllerIsPlayer = true
    const attrs = t?.attributes || {}
    controllerAgility = attrs.agility ?? 0
    controllerBody = attrs.body ?? 0
  }

  // Breaker roll: body roll + size bonus vs controller (no brawler size vs controller; breaker isn't in the clash)
  const breakerSizeBonus = getClashSizeBonus(breakerSize, controllerSize, breakerHasBrawler, breakerIsGigantic)
  const breakerBrawlerBonus = breakerHasBrawler ? (breakerIsGigantic ? 4 : 2) : 0
  const breakerRoll = body.roll + breakerBody + breakerSizeBonus + breakerBrawlerBonus

  // TN for breaker = controller's Agility
  const breakerTN = controllerAgility

  // Controller resists: auto-roll for NPC, else use body score as tie-breaker
  let controllerRoll: number
  let controllerRollDescription: string

  if (!controllerIsPlayer) {
    // NPC controller auto-rolls
    const dice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ]
    const controllerHasBrownArmor = controllerQualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'brown')
    let controllerRamBonus = 0
    if (controllerHasBrownArmor && controllerDigimonEntity) {
      const ds = await getDigimonDerivedStats(controller.entityId)
      controllerRamBonus = ds?.ram ?? 0
    }
    const controllerSizeBonus = getClashSizeBonus(controllerSize, breakerSize, controllerHasBrawler, controllerIsGigantic)
    const controllerBrawlerBonus = controllerHasBrawler ? (controllerIsGigantic ? 4 : 2) : 0
    controllerRoll = dice.reduce((a, b) => a + b, 0) + controllerBody + controllerSizeBonus + controllerBrawlerBonus + controllerRamBonus
    controllerRollDescription = `${controllerRoll} (auto: [${dice.join(',')}], body: +${controllerBody}, size: +${controllerSizeBonus}, brawler: +${controllerBrawlerBonus})`
  } else {
    // Player controller — use body as stand-in for comparison; contested is breaker vs controllerAgility TN
    // Controller's resistance roll = their Body (passive resistance, no active roll needed per rules)
    controllerRoll = controllerBody
    controllerRollDescription = `${controllerRoll} (Body score)`
  }

  // Contested resolution: breaker tries to beat controllerTN; controller tries to beat breakerBody as TN
  // Using determineClashController: breaker is 'actor', controller is 'target'
  const breakerIsPlayer = breaker.type === 'tamer' || !!(breakerDigimonEntity?.partnerId)
  const controllerTN = breakerBody  // controller's TN = breaker's body
  const result = determineClashController(
    breakerRoll, breakerTN, breakerBody, breakerIsPlayer,
    controllerRoll, controllerTN, controllerBody, controllerIsPlayer,
  )
  const breakerWins = result === 'actor'

  // Resolve names
  const breakerName = breaker.type === 'tamer'
    ? (await db.select().from(tamers).where(eq(tamers.id, breaker.entityId)).then(r => r[0]?.name || 'Tamer'))
    : resolveParticipantName(breaker, participants, breakerDigimonEntity?.name || 'Digimon', breakerDigimonEntity?.isEnemy || false)

  const controllerName = controller.type === 'tamer'
    ? (await db.select().from(tamers).where(eq(tamers.id, controller.entityId)).then(r => r[0]?.name || 'Tamer'))
    : resolveParticipantName(controller, participants, controllerDigimonEntity?.name || 'Digimon', controllerDigimonEntity?.isEnemy || false)

  // Deduct breaker's 2 simple actions
  participants = participants.map((p: any) => {
    if (p.id === body.breakerId) {
      return {
        ...p,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 2) },
      }
    }
    return p
  })

  if (breakerWins) {
    // End the clash for both participants
    participants = participants.map((p: any) => {
      if (p.id === controller.id || p.id === controlled.id) {
        const { clash, ...rest } = p
        return {
          ...rest,
          clashCooldownUntilRound: (encounter.round || 0) + 1,
        }
      }
      return p
    })

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashbreak`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.breakerId,
      actorName: breakerName,
      action: 'Clash Break',
      target: controllerName,
      result: `${breakerName} breaks the clash between ${controllerName} and their opponent! (Roll ${breakerRoll} vs TN ${breakerTN} beat ${controllerRollDescription}.) Clash ended; both parties cannot initiate until next round.`,
      damage: null,
      effects: ['Clash Break', 'Clash Ended'],
    }]
  } else {
    // Clash continues; breaker failed
    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clashbreakfail`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.breakerId,
      actorName: breakerName,
      action: 'Clash Break (Failed)',
      target: controllerName,
      result: `${breakerName} fails to break the clash. (Roll ${breakerRoll} vs TN ${breakerTN} vs ${controllerRollDescription}.) The clash continues.`,
      damage: null,
      effects: ['Clash Break Failed'],
    }]
  }

  await db.update(encounters).set({
    participants,
    battleLog,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
})
