import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, maps } from '../../../../db'
import { resolveParticipantName } from '../../../../utils/participantName'
import { getClashSizeBonus, determineClashController } from '../../../../../data/attackConstants'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'
import { getRoomPositions } from '../../../../utils/encounterRoom'
import { getFootprintDimensions, getFootprintCells } from '../../../../utils/mapMovement'
import type { FootprintDims } from '../../../../utils/mapMovement'

interface ClashInitiateBody {
  participantId: string
  targetId: string
  tamerId: string
  bodyRoll: number
  bodyDiceResults: number[]
  reachDistance?: number  // meters away if using Reach quality
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<ClashInitiateBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.participantId || !body.targetId || body.bodyRoll === undefined || !body.bodyDiceResults) {
    throw createError({ statusCode: 400, message: 'participantId, targetId, bodyRoll, and bodyDiceResults are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = encounter.participants
  const turnOrder = encounter.turnOrder
  let battleLog = encounter.battleLog
  const pendingRequests = encounter.pendingRequests

  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) throw createError({ statusCode: 404, message: 'Participant not found' })

  // Check if participant can act (direct turn or partner digimon on tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
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

  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) throw createError({ statusCode: 404, message: 'Target not found' })

  // Spatial range check for clash initiation
  if ((encounter as any).mapId) {
    const positions: Record<string, any> = await getRoomPositions(encounterId)
    const attackerPos = positions[actor.id]
    const targetPos = positions[target.id]
    if (attackerPos && targetPos) {
      let reachRanks = 0
      let attackerDims: FootprintDims = { width: 1, height: 1, depth: 1 }
      if (actor.type === 'digimon') {
        const [actDig] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
        const qs = actDig?.qualities ?? []
        reachRanks = (qs as any[]).find((q: any) => q.id === 'reach')?.ranks ?? 0
        if (actDig) attackerDims = getFootprintDimensions(actDig.size as any, (actDig as any).giganticDimensions)
      }
      let targetDims: FootprintDims = { width: 1, height: 1, depth: 1 }
      if (target.type === 'digimon') {
        const [targetDig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
        if (targetDig) targetDims = getFootprintDimensions(targetDig.size as any, (targetDig as any).giganticDimensions)
      }
      const meleeRange = reachRanks > 0 ? reachRanks * 2 : 1
      const attackerCells = getFootprintCells(attackerPos, attackerDims)
      const targetCells = getFootprintCells(targetPos, targetDims)
      const dist = Math.min(...attackerCells.flatMap(a =>
        targetCells.map(t => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y), Math.abs(a.z - t.z)))
      ))
      if (dist > meleeRange) {
        throw createError({ statusCode: 400, message: `Target out of clash range (distance: ${dist}, melee range: ${meleeRange})` })
      }
    }
  }

  // Validate neither is already clashing
  if (actor.clash) throw createError({ statusCode: 400, message: 'You are already in a clash' })
  if (target.clash) throw createError({ statusCode: 400, message: 'Target is already in a clash' })

  // Check cannotInitiateUntilRound
  if (actor.clash === null && (actor as any).cannotInitiateUntilRound !== undefined) {
    // cannotInitiateUntilRound is stored at top level after clash ends
  }
  if ((actor as any).clashCooldownUntilRound !== undefined && (encounter.round || 0) < (actor as any).clashCooldownUntilRound) {
    throw createError({ statusCode: 400, message: 'Cannot initiate a new clash until next round' })
  }

  // Determine action cost (Wrestlemania = free once per round)
  let actorDigimonEntity: any = null
  let actorQualities: any[] = []
  if (actor.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))
    actorDigimonEntity = d
    actorQualities = d?.qualities || []
  }

  const hasWrestlemania = actorQualities.some((q: any) => q.choiceId === 'wrestlemania')
  const hasBrawler = actorQualities.some((q: any) => q.choiceId === 'brawler')
  const hasMultiGrappler = actorQualities.some((q: any) => q.choiceId === 'multi-grappler')

  const isFreeClash = hasWrestlemania && !actor.usedFreeClashThisRound
  const actionCost = isFreeClash ? 0 : 1

  if (!isFreeClash && (actor.actionsRemaining?.simple || 0) < 1) {
    throw createError({ statusCode: 403, message: 'Not enough actions remaining (need 1 Simple Action)' })
  }

  // Fetch actor stats
  let actorBody = 0
  let actorSize = 'medium'
  let actorIsGigantic = false
  let actorDs: Awaited<ReturnType<typeof getDigimonDerivedStats>> = null
  if (actor.type === 'digimon' && actorDigimonEntity) {
    actorDs = await getDigimonDerivedStats(actor.entityId)
    actorBody = actorDs?.body ?? 0
    actorSize = actorDigimonEntity.size || 'medium'
    actorIsGigantic = actorSize === 'gigantic'
  } else if (actor.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
    const attrs = tamerEntity?.attributes || {}
    actorBody = attrs.body ?? 0
    actorSize = 'medium'
  }

  // Fetch target stats
  let targetDigimonEntity: any = null
  let targetQualities: any[] = []
  let targetBody = 0
  let targetAgility = 0
  let targetSize = 'medium'
  let targetIsPlayer = false

  let targetDs: Awaited<ReturnType<typeof getDigimonDerivedStats>> = null
  if (target.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    targetDigimonEntity = d
    targetQualities = d?.qualities || []
    targetDs = await getDigimonDerivedStats(target.entityId)
    targetBody = targetDs?.body ?? 0
    targetAgility = targetDs?.agility ?? 0
    targetSize = d?.size || 'medium'
    targetIsPlayer = !!d?.partnerId
  } else if (target.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    const attrs = tamerEntity?.attributes || {}
    targetBody = attrs.body ?? 0
    targetAgility = attrs.agility ?? 0
    targetSize = 'medium'
    targetIsPlayer = true
  }

  // Digizoid Armor: Brown — target gets +RAM to their roll
  const targetHasBrownArmor = targetQualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'brown')
  let targetRamBonus = 0
  if (targetHasBrownArmor && targetDigimonEntity) {
    targetRamBonus = targetDs?.ram ?? 0
  }

  // Compute actor roll bonus
  const sizeBonus = getClashSizeBonus(actorSize, targetSize, hasBrawler, actorIsGigantic)
  const brawlerBonus = hasBrawler ? (actorIsGigantic ? 4 : 2) : 0
  const reachPenalty = body.reachDistance ?? 0
  const actorRoll = body.bodyRoll + actorBody + sizeBonus + brawlerBonus - reachPenalty

  // Target TN = target's agility
  const actorTN = targetAgility

  // Generate clash ID
  const clashId = `clash-${Date.now()}`

  // Resolve actor name and target name
  let actorName = 'Unknown'
  let targetName = 'Unknown'
  if (actor.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
    actorName = t?.name || 'Tamer'
  } else {
    const baseName = actorDigimonEntity?.name || 'Digimon'
    actorName = resolveParticipantName(actor, participants, baseName, actorDigimonEntity?.isEnemy || false)
  }
  if (target.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    targetName = t?.name || 'Tamer'
  } else if (targetDigimonEntity) {
    const baseName = targetDigimonEntity.name || 'Digimon'
    targetName = resolveParticipantName(target, participants, baseName, targetDigimonEntity.isEnemy || false)
  }

  const reachInitiated = (body.reachDistance ?? 0) > 0
  const reachDistance = body.reachDistance ?? 0

  let opponentRollTotal: number | undefined

  if (!targetIsPlayer) {
    // NPC target: auto-roll 3d6 + targetBody + digizoid bonus, determine controller immediately
    const npcDice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ]
    const targetHasBrawler = targetQualities.some((q: any) => q.choiceId === 'brawler')
    const targetIsGigantic = targetSize === 'gigantic'
    const targetSizeBonus = getClashSizeBonus(targetSize, actorSize, targetHasBrawler, targetIsGigantic)
    const targetBrawlerBonus = targetHasBrawler ? (targetIsGigantic ? 4 : 2) : 0
    const targetRoll = npcDice.reduce((a, b) => a + b, 0) + targetBody + targetSizeBonus + targetBrawlerBonus + targetRamBonus
    opponentRollTotal = targetRoll
    const targetTN = actorBody  // target needs to beat actor's body... wait

    // Actually: each participant rolls 3d6+Body vs OPPONENT'S Agility as TN
    // actorTN = targetAgility (actor must beat target's agility)
    // targetTN = actorAgility (target must beat actor's agility)
    let actorAgility = 0
    if (actor.type === 'digimon' && actorDigimonEntity) {
      actorAgility = actorDs?.agility ?? 0
    } else if (actor.type === 'tamer') {
      const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
      const attrs = tamerEntity?.attributes || {}
      actorAgility = attrs.agility ?? 0
    }

    const npcTargetTN = actorAgility
    const controller = determineClashController(
      actorRoll, actorTN, actorBody, !actorDigimonEntity?.isEnemy,
      targetRoll + targetRamBonus, npcTargetTN, targetBody, false,
    )
    const actorControls = controller === 'actor'

    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        return {
          ...p,
          actionsRemaining: isFreeClash
            ? p.actionsRemaining
            : { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) },
          usedFreeClashThisRound: isFreeClash ? true : p.usedFreeClashThisRound,
          clash: {
            clashId,
            opponentParticipantId: body.targetId,
            isController: actorControls,
            isPinned: false,
            clashCheckNeeded: false,
            ...(reachInitiated ? { reachInitiated: true, reachDistance } : {}),
          },
        }
      }
      if (p.id === body.targetId) {
        return {
          ...p,
          clash: {
            clashId,
            opponentParticipantId: body.participantId,
            isController: !actorControls,
            isPinned: false,
            clashCheckNeeded: false,
            ...(reachInitiated ? { reachInitiated: true, reachDistance } : {}),
          },
        }
      }
      return p
    })

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clash`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: actor.id,
      actorName,
      action: 'Clash Initiated',
      target: targetName,
      result: `${actorName} rolls ${actorRoll} (dice: [${body.bodyDiceResults.join(',')}], body: +${actorBody}, size: +${sizeBonus}, brawler: +${brawlerBonus}, reach: -${reachPenalty}) vs TN ${actorTN}. ${targetName} rolls ${targetRoll} (dice: [${npcDice.join(',')}], body: +${targetBody}, size: +${targetSizeBonus}, brawler: +${targetBrawlerBonus}) vs TN ${npcTargetTN}. ${actorControls ? actorName : targetName} controls.`,
      damage: null,
      effects: ['Clash', actorControls ? `${actorName} controls` : `${targetName} controls`],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

  } else {
    // Player target: deduct actions on actor, store actor's roll in clash state, create pending request
    // Determine opponent tamer ID for the request
    let actorAgility = 0
    if (actor.type === 'digimon' && actorDigimonEntity) {
      actorAgility = actorDs?.agility ?? 0
    } else if (actor.type === 'tamer') {
      const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
      const attrs = tamerEntity?.attributes || {}
      actorAgility = attrs.agility ?? 0
    }
    let opponentTamerId = 'GM'
    if (target.type === 'tamer') {
      opponentTamerId = target.entityId
    } else if (target.type === 'digimon' && targetDigimonEntity?.partnerId) {
      opponentTamerId = targetDigimonEntity.partnerId
    }

    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        return {
          ...p,
          actionsRemaining: isFreeClash
            ? p.actionsRemaining
            : { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) },
          usedFreeClashThisRound: isFreeClash ? true : p.usedFreeClashThisRound,
          clash: {
            clashId,
            opponentParticipantId: body.targetId,
            isController: false,
            isPinned: false,
            clashCheckNeeded: false,
            pendingRoll: actorRoll,
            pendingRollDescription: `dice: [${body.bodyDiceResults.join(',')}], body: +${actorBody}, size: +${sizeBonus}, brawler: +${brawlerBonus}${reachPenalty ? `, reach: -${reachPenalty}` : ''}`,
            ...(reachInitiated ? { reachInitiated: true, reachDistance } : {}),
          },
        }
      }
      if (p.id === body.targetId) {
        return {
          ...p,
          clash: {
            clashId,
            opponentParticipantId: body.participantId,
            isController: false,
            isPinned: false,
            clashCheckNeeded: false,
            ...(reachInitiated ? { reachInitiated: true, reachDistance } : {}),
          },
        }
      }
      return p
    })

    const clashRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'clash-check',
      targetTamerId: opponentTamerId,
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        clashId,
        initiatorParticipantId: body.participantId,
        initiatorName: actorName,
        initiatorRoll: actorRoll,
        initiatorTN: actorTN,
        opponentName: targetName,
        opponentTN: actorAgility,
        opponentRamBonus: targetRamBonus,
        reachInitiated,
        reachDistance,
      },
    }

    battleLog = [...battleLog, {
      id: `log-${Date.now()}-clash`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: actor.id,
      actorName,
      action: 'Clash Initiated',
      target: targetName,
      result: `${actorName} initiates a clash with ${targetName}. Awaiting ${targetName}'s response.`,
      damage: null,
      effects: ['Clash', 'Pending'],
    }]

    await db.update(encounters).set({
      participants,
      battleLog,
      pendingRequests: [...pendingRequests, clashRequest],
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))
  }

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return {
    ...updated,
    opponentRollTotal,
  }
})
