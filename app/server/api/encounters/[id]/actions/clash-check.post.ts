import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { determineClashController, getClashSizeBonus } from '../../../../../data/attackConstants'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'

interface ClashCheckBody {
  clashId: string
  participantId: string
  roll: number
  diceResults: number[]
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<ClashCheckBody>(event)

  if (!encounterId) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  if (!body.clashId || !body.participantId || body.roll === undefined || !body.diceResults) {
    throw createError({ statusCode: 400, message: 'clashId, participantId, roll, and diceResults are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })

  let participants = encounter.participants
  let battleLog = encounter.battleLog
  const pendingRequests = encounter.pendingRequests

  // Find both participants in this clash
  const clashParticipants = participants.filter((p: any) => p.clash?.clashId === body.clashId)
  if (clashParticipants.length !== 2) {
    throw createError({ statusCode: 400, message: 'Clash not found or invalid' })
  }

  const submitter = clashParticipants.find((p: any) => p.id === body.participantId)
  const opponent = clashParticipants.find((p: any) => p.id !== body.participantId)
  if (!submitter || !opponent) throw createError({ statusCode: 404, message: 'Participant not found in clash' })

  // Get submitter entity stats
  let submitterBody = 0
  let submitterAgility = 0
  let submitterSize = 'medium'
  let submitterIsPlayer = false
  let submitterQualities: any[] = []
  let submitterDigimonEntity: any = null

  if (submitter.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, submitter.entityId))
    submitterDigimonEntity = d
    submitterQualities = d?.qualities || []
    const ds = await getDigimonDerivedStats(submitter.entityId)
    submitterBody = ds?.body ?? 0
    submitterAgility = ds?.agility ?? 0
    submitterSize = d?.size || 'medium'
    submitterIsPlayer = !!d?.partnerId
  } else if (submitter.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, submitter.entityId))
    const attrs = t?.attributes || {}
    submitterBody = attrs.body ?? 0
    submitterAgility = attrs.agility ?? 0
    submitterIsPlayer = true
  }

  // Get opponent entity stats
  let opponentBody = 0
  let opponentAgility = 0
  let opponentSize = 'medium'
  let opponentIsPlayer = false
  let opponentQualities: any[] = []
  let opponentDigimonEntity: any = null

  if (opponent.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, opponent.entityId))
    opponentDigimonEntity = d
    opponentQualities = d?.qualities || []
    const ds = await getDigimonDerivedStats(opponent.entityId)
    opponentBody = ds?.body ?? 0
    opponentAgility = ds?.agility ?? 0
    opponentSize = d?.size || 'medium'
    opponentIsPlayer = !!d?.partnerId
  } else if (opponent.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, opponent.entityId))
    const attrs = t?.attributes || {}
    opponentBody = attrs.body ?? 0
    opponentAgility = attrs.agility ?? 0
    opponentIsPlayer = true
  }

  // Digizoid Armor: Brown bonus for submitter
  const submitterHasBrownArmor = submitterQualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'brown')
  let submitterRamBonus = 0
  if (submitterHasBrownArmor && submitterDigimonEntity) {
    const ds = await getDigimonDerivedStats(submitter.entityId)
    submitterRamBonus = ds?.ram ?? 0
  }

  // Brawler bonuses
  const submitterHasBrawler = submitterQualities.some((q: any) => q.choiceId === 'brawler')
  const submitterIsGigantic = submitterSize === 'gigantic'
  const submitterBrawlerBonus = submitterHasBrawler ? (submitterIsGigantic ? 4 : 2) : 0
  const submitterSizeBonus = getClashSizeBonus(submitterSize, opponentSize, submitterHasBrawler, submitterIsGigantic)

  const opponentHasBrawler = opponentQualities.some((q: any) => q.choiceId === 'brawler')
  const opponentIsGigantic = opponentSize === 'gigantic'

  // Reach penalty on re-rolls: apply to whichever side has reachInitiated
  const reachPenalty = submitter.clash?.reachInitiated ? (submitter.clash.reachDistance ?? 0) : 0

  const submitterRoll = body.roll + submitterBody + submitterSizeBonus + submitterBrawlerBonus + submitterRamBonus - reachPenalty
  const submitterTN = opponentAgility  // submitter needs to beat opponent's agility

  // If opponent already has a pending roll stored, use it; otherwise opponent must be NPC to auto-roll
  const opponentPendingRoll = opponent.clash?.pendingRoll

  let opponentRoll: number
  let opponentRollDescription: string

  if (opponentPendingRoll !== undefined) {
    opponentRoll = opponentPendingRoll
    const storedDesc = opponent.clash?.pendingRollDescription
    opponentRollDescription = storedDesc ? `${opponentRoll} (${storedDesc})` : `${opponentRoll} (stored)`
  } else if (!opponentIsPlayer) {
    // NPC: auto-roll
    const dice = [
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    ]
    const opponentHasBrownArmor = opponentQualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'brown')
    let opponentRamBonus = 0
    if (opponentHasBrownArmor && opponentDigimonEntity) {
      const ds = await getDigimonDerivedStats(opponent.entityId)
      opponentRamBonus = ds?.ram ?? 0
    }
    const opponentSizeBonus = getClashSizeBonus(opponentSize, submitterSize, opponentHasBrawler, opponentIsGigantic)
    const opponentBrawlerBonus = opponentHasBrawler ? (opponentIsGigantic ? 4 : 2) : 0
    const opponentReachPenalty = opponent.clash?.reachInitiated ? (opponent.clash.reachDistance ?? 0) : 0
    opponentRoll = dice.reduce((a, b) => a + b, 0) + opponentBody + opponentSizeBonus + opponentBrawlerBonus + opponentRamBonus - opponentReachPenalty
    opponentRollDescription = `${opponentRoll} (auto: [${dice.join(',')}], body: +${opponentBody}, size: +${opponentSizeBonus}, brawler: +${opponentBrawlerBonus})`
  } else {
    // Player opponent hasn't rolled yet — store submitter's roll and wait
    participants = participants.map((p: any) => {
      if (p.id === body.participantId) {
        return {
          ...p,
          clash: {
            ...p.clash,
            pendingRoll: submitterRoll,
            pendingRollDescription: `dice: [${body.diceResults.join(',')}], body: +${submitterBody}, size: +${submitterSizeBonus}, brawler: +${submitterBrawlerBonus}`,
            clashCheckNeeded: false,
          },
        }
      }
      return p
    })

    // Clear the pending clash-check request for this participant
    const updatedRequests = pendingRequests.filter((r: any) =>
      !(r.type === 'clash-check' && r.data?.clashId === body.clashId && r.targetParticipantId === body.participantId)
    )

    await db.update(encounters).set({
      participants,
      pendingRequests: updatedRequests,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  const opponentTN = submitterAgility

  // Determine controller — submitter is 'actor', opponent is 'target' in helper
  const controller = determineClashController(
    submitterRoll, submitterTN, submitterBody, submitterIsPlayer,
    opponentRoll, opponentTN, opponentBody, opponentIsPlayer,
  )
  const submitterControls = controller === 'actor'

  // Clear pending clash-check requests for this clash
  const updatedRequests = pendingRequests.filter((r: any) =>
    !(r.type === 'clash-check' && r.data?.clashId === body.clashId)
  )

  participants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        clash: {
          ...p.clash,
          isController: submitterControls,
          clashCheckNeeded: false,
          pendingRoll: undefined,
          pendingRollDescription: undefined,
        },
      }
    }
    if (p.id === opponent.id) {
      return {
        ...p,
        clash: {
          ...p.clash,
          isController: !submitterControls,
          clashCheckNeeded: false,
          pendingRoll: undefined,
        },
      }
    }
    return p
  })

  const submitterName = submitter.type === 'tamer'
    ? (await db.select().from(tamers).where(eq(tamers.id, submitter.entityId)).then(r => r[0]?.name || 'Tamer'))
    : (submitterDigimonEntity?.name || 'Digimon')
  const opponentName = opponent.type === 'tamer'
    ? (await db.select().from(tamers).where(eq(tamers.id, opponent.entityId)).then(r => r[0]?.name || 'Tamer'))
    : (opponentDigimonEntity?.name || 'Digimon')

  battleLog = [...battleLog, {
    id: `log-${Date.now()}-clashcheck`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.participantId,
    actorName: submitterName,
    action: 'Clash Check',
    target: opponentName,
    result: `${submitterName} rolls ${submitterRoll} (dice: [${body.diceResults.join(',')}], body: +${submitterBody}, size: +${submitterSizeBonus}, brawler: +${submitterBrawlerBonus}) vs TN ${submitterTN}. ${opponentName} rolls ${opponentRollDescription} vs TN ${opponentTN}. ${submitterControls ? submitterName : opponentName} controls.`,
    damage: null,
    effects: ['Clash Check', submitterControls ? `${submitterName} controls` : `${opponentName} controls`],
  }]

  await db.update(encounters).set({
    participants,
    battleLog,
    pendingRequests: updatedRequests,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return {
    ...updated,
    opponentRollTotal: opponentRoll,
  }
})
