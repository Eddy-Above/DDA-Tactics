import { eq, inArray } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns, maps } from '../../../../db'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'
import {
  type FootprintDims,
  getReachableCells,
  detectCapabilitiesFromQualities,
  isValidLandingPosition,
  isPositionInAir,
  getFootprintDimensions,
  getFootprintCells,
  isFootprintValid,
  findClosestValidDisplacementPosition,
  findRangedIntercedPosition,
  getFootprintDimsForParticipant,
  buildFootprintOccupiedSet,
  findAreaIntercedePosition,
  hasValidThrowOutOfAreaCell,
} from '~/server/utils/mapMovement'
import { calculateDigimonDerivedStats } from '~/types'
import { resolveParticipantName } from '~/server/utils/participantName'
import { getEffectResolutionType, EFFECT_ALIGNMENT, BASIC_ATTACKS } from '~/data/attackConstants'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc, getPositiveSupportResolutionType } from '~/server/utils/resolveSupportAttack'
import { triggerCounterattack } from '~/server/utils/triggerCounterattack'
import { getUnlockedSpecialOrders } from '~/utils/specialOrders'
import { STAGE_CONFIG } from '~/types'
import { getRoomPositions } from '~/server/utils/encounterRoom'
import { type AreaShapeData, computeAreaCellsFromData } from '~/utils/areaShapes'
import { getSelectiveTargetingFilter } from '~/server/utils/selectiveTargeting'

interface IntercedeOfferBody {
  attackerId: string
  targetId?: string       // Single-target attack
  targetIds?: string[]    // Area attack: multiple targets
  accuracySuccesses: number
  accuracyDice: number[]
  attackId: string
  attackName?: string
  attackData: any // Full attack data for later resolution
  bolstered?: boolean
  bolsterType?: 'damage-accuracy' | 'bit-cpu'
  lifestealed?: boolean
  hugePowerUsed?: boolean
  hugePowerAttackRange?: 'melee' | 'ranged'
  skipActionDeduction?: boolean // When called from attack.post.ts which already deducted actions
  isSignatureMove?: boolean
  batteryCount?: number
  clashAttack?: boolean         // If true, target's dodge pool is halved (clash controller attack)
  outsideClashCpuPenalty?: number  // Damage penalty when attacker is outside target's active clash
  areaShapeData?: AreaShapeData | null  // Snapshot for recomputing AoE cells (Throw Ally Out of Blast)
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeOfferBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.attackerId || !body.attackId) {
    throw createError({ statusCode: 400, message: 'attackerId and attackId are required' })
  }
  if (!body.targetId && (!body.targetIds || body.targetIds.length === 0)) {
    throw createError({ statusCode: 400, message: 'targetId or targetIds is required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  let eddySoulRules: import('~/types').EddySoulRules | undefined
  let campaignLevel: string = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = campaign.rulesSettings || {}
      houseRules = rulesSettings.houseRules
      eddySoulRules = rulesSettings.eddySoulRules
      if (campaign.level) campaignLevel = campaign.level
    }
  }

  let participants = encounter.participants || []
  let turnOrder = encounter.turnOrder || []
  let pendingRequests = encounter.pendingRequests || []
  let battleLog = encounter.battleLog || []

  // Batch-fetch all digimon and tamer records for encounter participants (eliminates N+1 per-participant queries)
  const participantDigimonIds = participants
    .filter((p: any) => p.type === 'digimon')
    .map((p: any) => p.entityId as string)
  const participantTamerIds = participants
    .filter((p: any) => p.type === 'tamer')
    .map((p: any) => p.entityId as string)
  const [allParticipantDigimon, allParticipantTamers] = await Promise.all([
    participantDigimonIds.length > 0
      ? db.select().from(digimon).where(inArray(digimon.id, participantDigimonIds))
      : Promise.resolve([]),
    participantTamerIds.length > 0
      ? db.select().from(tamers).where(inArray(tamers.id, participantTamerIds))
      : Promise.resolve([]),
  ])
  const digimonById = new Map(allParticipantDigimon.map((d: any) => [d.id, d]))
  const tamerById = new Map(allParticipantTamers.map((t: any) => [t.id, t]))

  // Spatial map state (for intercede reach check)
  const participantPositions: Record<string, { x: number; y: number; z: number }> = await getRoomPositions(encounterId)

  let mapRecord: any = null
  if ((encounter as any).mapId && Object.keys(participantPositions).length > 0) {
    const [m] = await db.select().from(maps).where(eq(maps.id, (encounter as any).mapId))
    if (m) {
      mapRecord = {
        ...m,
        groundTiles: m.groundTiles ?? [],
        spaceTiles: m.spaceTiles ?? [],
        voxels: (m as any).voxels ?? [],
        walls: m.walls ?? [],
        ceilings: m.ceilings ?? [],
        stairs: m.stairs ?? [],
        windows: m.windows ?? [],
        doors: m.doors ?? [],
      }
    }
  }

  // Returns true if the interceptor (digimon participant) can reach targetPos on the map
  function canReachTarget(interceptorParticipantId: string, targetPos: { x: number; y: number; z: number }): boolean {
    if (!mapRecord) return true  // no map = always eligible
    if (!participantPositions[interceptorParticipantId]) return false  // unplaced on map = ineligible
    const interceptorPos = participantPositions[interceptorParticipantId]
    const interceptorP = participants.find((p: any) => p.id === interceptorParticipantId)
    if (!interceptorP || interceptorP.type !== 'digimon') return true
    const digRecord = digimonById.get(interceptorP.entityId)
    if (!digRecord) return true
    const qualities = digRecord.qualities ?? []
    const derived = calculateDigimonDerivedStats(
      digRecord.baseStats,
      digRecord.stage as any,
      digRecord.size as any,
    )
    const caps = detectCapabilitiesFromQualities(qualities, derived.movement, derived.ram, derived.cpu)
    const budget = derived.movement
    const reachable = getReachableCells(interceptorPos, budget, caps, mapRecord)
    return reachable.has(`${targetPos.x},${targetPos.y},${targetPos.z}`)
  }

  // Helper: check if a participant has eligible intercede actions
  const hasEligibleInterceptor = (participant: any): boolean => {
    if (participant.type === 'digimon') {
      // Partner digimon are not in turnOrder; use hasActed flag instead
      if (!participant.hasActed) {
        return (participant.actionsRemaining?.simple || 0) >= 1
      } else {
        const cap = participant.maxPostTurnIntercedes ?? 2
        return (participant.interceptPenalty || 0) < cap
      }
    }
    const turnIdx = (turnOrder as string[]).indexOf(participant.id)
    const turnHasGone = turnIdx >= 0 && turnIdx < (encounter.currentTurnIndex || 0)
    if (!turnHasGone) {
      return (participant.actionsRemaining?.simple || 0) >= 1
    } else {
      return (participant.interceptPenalty || 0) < 2
    }
  }

  const attacker = participants.find((p: any) => p.id === body.attackerId)
  if (!attacker) {
    throw createError({ statusCode: 404, message: 'Attacker not found' })
  }

  // ========================
  // AREA ATTACK PATH
  // ========================
  if (body.targetIds && body.targetIds.length > 0) {
    // Deduct attacker actions once for the whole area attack
    if (!body.skipActionDeduction) {
      const attackActionCost = body.bolstered ? 2 : 1
      participants = participants.map((p: any) => {
        if (p.id === body.attackerId) {
          const updated: any = {
            ...p,
            actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - attackActionCost) },
            usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }
          if (body.bolstered && p.type === 'digimon') {
            updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
            if (body.bolsterType === 'bit-cpu') {
              updated.lastBitCpuBolsterRound = encounter.round
            }
          }
          if (body.hugePowerUsed) {
            if (body.hugePowerAttackRange === 'ranged' || (body as any).hugePowerTrackAll) {
              updated.lastHugePowerRound = encounter.round
            }
            if ((body as any).hugePowerRank === 2) {
              updated.lastHugePowerRank2Round = encounter.round
            }
          }
          if (body.isSignatureMove) {
            updated.battery = 0
            updated.usedSignatureMoveThisTurn = true
          }
          return updated
        }
        return p
      })
    }

    // Get attacker name and attack definition (single map lookup)
    let attackerName = 'Unknown'
    let isSupportAttack = false
    let areaAttackDef: any = null
    if (attacker.type === 'digimon') {
      const attackerDig = digimonById.get(attacker.entityId)
      attackerName = resolveParticipantName(attacker, participants, attackerDig?.name || 'Digimon', attackerDig?.isEnemy || false)
      if (attackerDig?.attacks) {
        const attacks = attackerDig.attacks
        areaAttackDef = attacks?.find((a: any) => a.id === body.attackId)
        isSupportAttack = areaAttackDef?.type === 'support'
      }
    }

    // Process each target: collect player targets and NPC targets separately
    const playerTargetIds: string[] = []
    const playerTargetInfo: Record<string, { name: string; entityId: string; type: string; partnerId?: string }> = {}
    const npcTargetIds: string[] = []
    const npcTargetInfo: Record<string, { name: string }> = {}

    for (const targetId of body.targetIds) {
      const target = participants.find((p: any) => p.id === targetId)
      if (!target) continue

      let targetName = 'Unknown'
      let isPlayerTarget = false
      let partnerId: string | undefined

      if (target.type === 'tamer') {
        const t = tamerById.get(target.entityId)
        targetName = t?.name || 'Tamer'
        isPlayerTarget = true
      } else if (target.type === 'digimon') {
        const dig = digimonById.get(target.entityId)
        if (dig) {
          targetName = resolveParticipantName(target, participants, dig.name || 'Digimon', dig.isEnemy || false)
          if (dig.partnerId) {
            isPlayerTarget = true
            partnerId = dig.partnerId
          }
        }
      }

      if (isPlayerTarget) {
        playerTargetIds.push(targetId)
        playerTargetInfo[targetId] = { name: targetName, entityId: target.entityId, type: target.type, partnerId }
      } else {
        // NPC target — defer resolution until after intercede window
        npcTargetIds.push(targetId)
        npcTargetInfo[targetId] = { name: targetName }
      }
    }

    // All targets (player + NPC) are eligible for intercede offers
    const allTargetIds = [...playerTargetIds, ...npcTargetIds]

    // Selective Targeting: attacker-level constants for filtering uncovered targets
    const attackerDigForST = attacker.type === 'digimon' ? digimonById.get(attacker.entityId) : null
    const attackerHasSelectiveTargeting = (attackerDigForST?.qualities || []).some((q: any) => q.id === 'selective-targeting')
    const attackerIsEnemy = !!attacker.isEnemy
    const totalTargetCount = allTargetIds.length

    // Build one intercede-offer per eligible tamer and one for GM
    const intercedeGroupId = `intercede-${Date.now()}-area`
    const newRequests: any[] = []
    const allTargetIdSet = new Set(allTargetIds)

    // Movement/throw profile of a participant for the unified area-intercede flow:
    // budget/caps drive repositioning into the AoE (Rule 2), bodyStat drives the
    // subsequent throw-out-of-AoE range (Rule 3, mirrors EncounterMap.vue's throwCaps).
    function movementProfileFor(p: any): { budget: number; caps: ReturnType<typeof detectCapabilitiesFromQualities>; bodyStat: number } {
      if (p.type === 'digimon') {
        const digRec = digimonById.get(p.entityId)
        if (!digRec) return { budget: 0, caps: detectCapabilitiesFromQualities([], 0, 0, 0), bodyStat: 0 }
        const quals = digRec.qualities ?? []
        const deriv = calculateDigimonDerivedStats(digRec.baseStats, digRec.stage as any, digRec.size as any)
        return {
          budget: deriv.movement,
          caps: detectCapabilitiesFromQualities(quals, deriv.movement, deriv.ram, deriv.cpu),
          bodyStat: deriv.body,
        }
      }
      const tamerRecord = tamerById.get(p.entityId)
      if (!tamerRecord) return { budget: 0, caps: detectCapabilitiesFromQualities([], 0, 0, 0), bodyStat: 0 }
      const attrs = tamerRecord.attributes || {}
      const skills = tamerRecord.skills || {}
      return {
        budget: (attrs.agility || 0) + (skills.survival || 0),
        caps: detectCapabilitiesFromQualities([], 0, 0, 0),
        bodyStat: attrs.body || 0,
      }
    }

    // Offer-time eligibility gates for the unified area-attack intercede flow:
    // Rule 1 — candidate's current footprint must not already be inside the AoE.
    // Rule 2 — candidate must be able to reposition into an in-AoE cell adjacent to the target.
    // Rule 3 — from the target's current position, there must be a valid throw-out-of-AoE cell
    //          within the candidate's Body-stat range.
    const areaIntercedeEligibility = new Map<string, string[]>() // participantId -> eligible target participantIds
    if (mapRecord && body.areaShapeData) {
      const areaCells = new Set(computeAreaCellsFromData(body.areaShapeData).map(c => `${c.x},${c.y},${c.z}`))

      for (const p of participants) {
        if (allTargetIdSet.has(p.id) || p.id === body.attackerId) continue
        const pPos = participantPositions[p.id]
        if (!pPos) continue
        const pDims = getFootprintDimsForParticipant(p, digimonById)

        // Rule 1: candidate's CURRENT footprint must not overlap the AoE at all
        if (getFootprintCells(pPos, pDims).some(c => areaCells.has(`${c.x},${c.y},${c.z}`))) continue

        const { budget, caps, bodyStat } = movementProfileFor(p)
        const eligibleTargets: string[] = []
        for (const tid of allTargetIds) {
          const targetPos = participantPositions[tid]
          if (!targetPos) continue
          const targetParticipant = participants.find((pp: any) => pp.id === tid)
          if (!targetParticipant) continue
          const targetDims = getFootprintDimsForParticipant(targetParticipant, digimonById)

          // Rule 2: can the candidate reach an in-AoE cell adjacent to the target?
          const repositionOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([p.id, tid]))
          if (!findAreaIntercedePosition(targetPos, targetDims, pPos, budget, caps, pDims, mapRecord, repositionOccupied, areaCells)) continue

          // Rule 3: from the target's current position, is there a valid throw-out cell within range?
          const throwOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([tid]))
          if (!hasValidThrowOutOfAreaCell(targetPos, bodyStat, targetDims, mapRecord, throwOccupied, areaCells)) continue

          eligibleTargets.push(tid)
        }
        if (eligibleTargets.length > 0) areaIntercedeEligibility.set(p.id, eligibleTargets)
      }
    }

    for (const p of participants) {
      if (p.type !== 'tamer') continue

      // Must have a partner digimon in encounter
      let hasPartnerInEncounter = false
      let partnerParticipantId: string | null = null
      for (const pp of participants) {
        if (pp.type !== 'digimon') continue
        const dig = digimonById.get(pp.entityId)
        if (dig?.partnerId === p.entityId) { hasPartnerInEncounter = true; partnerParticipantId = pp.id; break }
      }
      if (!hasPartnerInEncounter) continue

      // Check if tamer or their partner digimon has eligible intercede actions
      // (also covers the case where both are targeted — neither would be eligible)
      const digimonParticipant = partnerParticipantId ? participants.find((pp: any) => pp.id === partnerParticipantId) : null
      const partnerIsAttacker = partnerParticipantId === body.attackerId
      const tamerIsAttacker = p.id === body.attackerId
      // Spatial check: can the digimon reach at least one target? (skip if digimon is the attacker)
      let digimonSpatiallyEligible = true
      if (digimonParticipant && partnerParticipantId && !partnerIsAttacker && mapRecord) {
        const targetPositions = allTargetIds.map(tid => participantPositions[tid]).filter(Boolean)
        if (targetPositions.length > 0) {
          digimonSpatiallyEligible = targetPositions.some(tp => canReachTarget(partnerParticipantId!, tp))
        }
      }
      const digimonEligible = !!(digimonParticipant && !allTargetIdSet.has(partnerParticipantId!) && !partnerIsAttacker && hasEligibleInterceptor(digimonParticipant) && digimonSpatiallyEligible)
      // Spatial check for tamer: if map active, verify tamer can reach at least one target from their own location
      let tamerSpatiallyEligible = true
      if (mapRecord && !allTargetIdSet.has(p.id) && !tamerIsAttacker) {
        const tamerPos = participantPositions[p.id]
        if (!tamerPos) {
          tamerSpatiallyEligible = false
        } else {
          const tamerRecord = tamerById.get(p.entityId)
          if (tamerRecord) {
            const attrs = tamerRecord.attributes || {}
            const skills = tamerRecord.skills || {}
            const tamerMovement = (attrs.agility || 0) + (skills.survival || 0)
            const tamerCaps = detectCapabilitiesFromQualities([], 0, 0, 0)
            const targetPositions = allTargetIds.map((tid: string) => participantPositions[tid]).filter(Boolean)
            if (targetPositions.length > 0) {
              const tamerReachable = getReachableCells(tamerPos, tamerMovement, tamerCaps, mapRecord)
              tamerSpatiallyEligible = targetPositions.some((tp: any) => tamerReachable.has(`${tp.x},${tp.y},${tp.z}`))
            }
          }
        }
      }
      const tamerEligible = !allTargetIdSet.has(p.id) && !tamerIsAttacker && hasEligibleInterceptor(p) && tamerSpatiallyEligible
      if (!tamerEligible && !digimonEligible) continue

      // Filter this tamer's (and their partner digimon's) area-intercede eligible
      // targets (Rules 1-3 already applied) by this tamer's opt-outs
      const tamerOptOuts: string[] = p.intercedeOptOuts || []
      const tamerAreaTargetIds = (areaIntercedeEligibility.get(p.id) ?? []).filter(tid => !tamerOptOuts.includes(tid))
      const digimonAreaTargetIds = partnerParticipantId
        ? (areaIntercedeEligibility.get(partnerParticipantId) ?? []).filter(tid => !tamerOptOuts.includes(tid))
        : []
      if (tamerAreaTargetIds.length === 0 && digimonAreaTargetIds.length === 0) continue

      // QR eligibility: can use if their partner is one of the area targets
      let canUseQR = false
      let qrDiceCount = 0
      for (const tid of tamerAreaTargetIds) {
        const info = playerTargetInfo[tid]
        if (info?.partnerId === p.entityId) {
          const tamerRecord = tamerById.get(p.entityId)
          if (tamerRecord) {
            const tamerAttrs = tamerRecord.attributes || {}
            const tamerXp = tamerRecord.xpBonuses || {}
            const unlockedOrders = getUnlockedSpecialOrders(tamerAttrs, tamerXp, campaignLevel as any)
            if (unlockedOrders.some((o: any) => o.name === 'Quick Reaction')) {
              const usedPerDay = tamerRecord.usedPerDayOrders || []
              if (!usedPerDay.includes('Quick Reaction')) {
                canUseQR = true
                const targetPart = participants.find((pp: any) => pp.id === tid)
                if (targetPart) {
                  const tDig = digimonById.get(targetPart.entityId)
                  if (tDig) qrDiceCount = ((STAGE_CONFIG as any)[tDig.stage]?.stageBonus ?? 0) + 2
                }
              }
            }
          }
          break
        }
      }

      newRequests.push({
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'intercede-offer',
        targetTamerId: p.entityId,
        targetParticipantId: null,
        timestamp: new Date().toISOString(),
        data: {
          intercedeGroupId,
          isAreaAttack: true,
          tamerAreaTargetIds,
          digimonAreaTargetIds,
          attackerId: body.attackerId,
          attackerName,
          targetId: null,
          targetName: null,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId,
          attackData: body.attackData,
          npcTargetIds,
          eligibleTamerIds: [], // filled after loop
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          isSupportAttack,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
          canUseQuickReaction: canUseQR,
          quickReactionDiceCount: qrDiceCount,
          areaShapeData: body.areaShapeData ?? null,
        },
      })
    }

    // GM intercede offer — covers every NPC (enemy digimon) participant that is
    // spatially eligible per Rules 1-3
    const gmParticipant = participants.find((p: any) => p.id === 'gm')
    const gmOptOuts: string[] = gmParticipant?.intercedeOptOuts || []
    const npcAreaEligibility: Record<string, string[]> = {}
    for (const p of participants) {
      if (p.type !== 'digimon') continue
      const dig = digimonById.get(p.entityId)
      if (!dig || dig.partnerId) continue // player-controlled digimon, not GM's
      if (allTargetIdSet.has(p.id) || p.id === body.attackerId) continue
      if (!hasEligibleInterceptor(p)) continue
      const eligible = (areaIntercedeEligibility.get(p.id) ?? []).filter(tid => !gmOptOuts.includes(tid))
      if (eligible.length > 0) npcAreaEligibility[p.id] = eligible
    }
    const gmAreaTargetIds = [...new Set(Object.values(npcAreaEligibility).flat())]
    if (Object.keys(npcAreaEligibility).length > 0) {
      newRequests.push({
        id: `req-${Date.now()}-gm`,
        type: 'intercede-offer',
        targetTamerId: 'GM',
        targetParticipantId: null,
        timestamp: new Date().toISOString(),
        data: {
          intercedeGroupId,
          isAreaAttack: true,
          npcAreaEligibility,
          gmAreaTargetIds,
          npcTargetIds,
          attackerId: body.attackerId,
          attackerName,
          targetId: null,
          targetName: null,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId,
          attackData: body.attackData,
          eligibleTamerIds: [],
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          isSupportAttack,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
          areaShapeData: body.areaShapeData ?? null,
        },
      })
    }

    // Fill eligibleTamerIds in all requests
    const allEligibleTamerIds = newRequests.filter(r => r.targetTamerId !== 'GM').map(r => r.targetTamerId)
    for (const r of newRequests) r.data.eligibleTamerIds = allEligibleTamerIds

    // If no intercede offers possible, create dodge-rolls for player targets and auto-resolve NPC targets
    // (intercede-group-state is pushed below only when intercede offers exist)
    if (newRequests.length === 0) {
      let areaAutoAdvanceTurnIndex: number | undefined
      let areaAutoAdvanceRound: number | undefined
      // Auto-resolve NPC targets immediately (no intercede window)
      for (const tid of npcTargetIds) {
        const npcTargetName = npcTargetInfo[tid]?.name || 'Digimon'
        if (isSupportAttack && areaAttackDef) {
          const resolutionType = getEffectResolutionType(areaAttackDef.effect, areaAttackDef.tags || [], 'support')
          const npcTargetIsEnemy = !!participants.find((p: any) => p.id === tid)?.isEnemy
          const supportParams = {
            participants, battleLog, pendingRequests,
            attackerParticipantId: body.attackerId,
            targetParticipantId: tid,
            attackDef: areaAttackDef,
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            round: encounter.round || 0,
            attackerName,
            targetName: npcTargetName,
            encounterId: encounterId!,
            turnOrder, houseRules,
            isSignatureMove: body.isSignatureMove || false,
            batteryCount: body.batteryCount ?? 0,
            selectiveTargetingFilter: getSelectiveTargetingFilter(
              attackerHasSelectiveTargeting, true, totalTargetCount, attackerIsEnemy, npcTargetIsEnemy,
            ),
          }
          let supportResult: any = null
          if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
          else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
          else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)
          if (supportResult) {
            participants = supportResult.participants
            battleLog = supportResult.battleLog
            pendingRequests = supportResult.pendingRequests
            if (supportResult.turnOrder) turnOrder = supportResult.turnOrder
          }
        } else {
          const result = await resolveNpcAttack({
            participants, battleLog,
            attackerParticipantId: body.attackerId,
            targetParticipantId: tid,
            attackId: body.attackId,
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            round: encounter.round || 0,
            attackerName,
            targetName: npcTargetName,
            turnOrder,
            currentTurnIndex: encounter.currentTurnIndex || 0,
            houseRules,
            clashAttack: body.clashAttack,
            outsideClashCpuPenalty: body.outsideClashCpuPenalty,
            totalTargetCount,
          })
          participants = result.participants
          battleLog = result.battleLog
          if (result.turnOrder) turnOrder = result.turnOrder
          if (result.nextTurnIndex !== undefined) areaAutoAdvanceTurnIndex = result.nextTurnIndex
          if (result.nextRound !== undefined) areaAutoAdvanceRound = result.nextRound
        }
      }

      const dodgeRequests: any[] = []
      for (const tid of playerTargetIds) {
        const info = playerTargetInfo[tid]
        const target = participants.find((p: any) => p.id === tid)

        const positiveResolutionType = getPositiveSupportResolutionType(isSupportAttack, areaAttackDef)
        if (positiveResolutionType) {
          const supportParams = {
            participants, battleLog, pendingRequests,
            attackerParticipantId: body.attackerId,
            targetParticipantId: tid,
            attackDef: areaAttackDef,
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            round: encounter.round || 0,
            attackerName,
            targetName: info.name,
            encounterId: encounterId!,
            turnOrder, houseRules,
            isSignatureMove: body.isSignatureMove || false,
            batteryCount: body.batteryCount ?? 0,
            selectiveTargetingFilter: getSelectiveTargetingFilter(
              attackerHasSelectiveTargeting, true, totalTargetCount, attackerIsEnemy, false,
            ),
          }
          const supportResult = positiveResolutionType === 'positive-auto'
            ? await resolvePositiveAuto(supportParams)
            : await resolvePositiveHealth(supportParams)
          participants = supportResult.participants
          battleLog = supportResult.battleLog
          pendingRequests = supportResult.pendingRequests
          if (supportResult.turnOrder) turnOrder = supportResult.turnOrder
          continue
        }

        let targetTamerId = 'GM'
        if (info.type === 'tamer') targetTamerId = info.entityId
        else if (info.partnerId) targetTamerId = info.partnerId
        dodgeRequests.push({
          id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'dodge-roll',
          targetTamerId,
          targetParticipantId: tid,
          timestamp: new Date().toISOString(),
          data: {
            attackerName,
            targetName: info.name,
            attackName: body.attackName || 'Attack',
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            attackId: body.attackId,
            attackData: body.attackData,
            attackerEntityId: attacker.entityId,
            attackerParticipantId: body.attackerId,
            targetEntityId: info.entityId,
            dodgePenalty: target?.dodgePenalty ?? 0,
            bolstered: body.bolstered || false,
            bolsterType: body.bolsterType || null,
            bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
            bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
            lifestealed: body.lifestealed || false,
            isSupportAttack,
            isSignatureMove: body.isSignatureMove || false,
            batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
            clashAttack: body.clashAttack || false,
            outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
            totalTargetCount,
            intercedeGroupId,
          },
        })
      }
      await db.update(encounters).set({
        participants,
        battleLog,
        pendingRequests: [...pendingRequests, ...dodgeRequests],
        turnOrder,
        ...(areaAutoAdvanceTurnIndex !== undefined ? { currentTurnIndex: areaAutoAdvanceTurnIndex } : {}),
        ...(areaAutoAdvanceRound !== undefined ? { round: areaAutoAdvanceRound } : {}),
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))
      const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
      if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
      return updated
    }

    // Push intercede-group-state tracker so claims are accumulated before resolution
    newRequests.push({
      id: `igs-${intercedeGroupId}`,
      type: 'intercede-group-state',
      targetTamerId: '__internal__',
      targetParticipantId: null,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        originalTargetIds: allTargetIds,
        npcTargetIds,
        playerTargetInfo,
        attackerId: body.attackerId,
        attackerName,
        attackName: body.attackName || 'Attack',
        attackId: body.attackId,
        attackData: body.attackData,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        lifestealed: body.lifestealed || false,
        isSupportAttack,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        areaShapeData: body.areaShapeData ?? null,
        attackerHasSelectiveTargeting,
        attackerIsEnemy,
        claims: [],
      },
    })

    // Save intercede offers
    await db.update(encounters).set({
      participants,
      battleLog,
      pendingRequests: [...pendingRequests, ...newRequests],
      turnOrder,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updatedArea] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    if (!updatedArea) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
    return updatedArea
  }

  // ========================
  // SINGLE-TARGET PATH (unchanged from before)
  // ========================
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({ statusCode: 404, message: 'Target not found' })
  }

  // Deduct attacker actions and track used attack (skip if already done by attack.post.ts)
  if (!body.skipActionDeduction) {
    const attackActionCost = body.bolstered ? 2 : 1
    participants = participants.map((p: any) => {
      if (p.id === body.attackerId) {
        const updated: any = {
          ...p,
          actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - attackActionCost) },
          usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
          // Consume Directed effect on attacker (bonus was applied client-side to accuracy pool)
          activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
        }
        // Track bolster usage for digimon
        if (body.bolstered && p.type === 'digimon') {
          updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
          if (body.bolsterType === 'bit-cpu') {
            updated.lastBitCpuBolsterRound = encounter.round
          }
        }
        // Track Huge Power usage
        if (body.hugePowerUsed) {
          // Track ranged usage OR EddySoul once-per-turn (any attack)
          if (body.hugePowerAttackRange === 'ranged' || (body as any).hugePowerTrackAll) {
            updated.lastHugePowerRound = encounter.round
          }
          // Track Rank 2 usage (once per round, any attack type)
          if ((body as any).hugePowerRank === 2) {
            updated.lastHugePowerRank2Round = encounter.round
          }
        }
        // Signature Move Battery: expend all battery on use
        if (body.isSignatureMove) {
          updated.battery = 0
          updated.usedSignatureMoveThisTurn = true
        }
        return updated
      }
      return p
    })
  }

  // Get attacker and target names (map lookups, no extra DB queries)
  let attackerName = 'Unknown'
  let targetName = 'Unknown'
  if (attacker.type === 'digimon') {
    const d = digimonById.get(attacker.entityId)
    attackerName = resolveParticipantName(attacker, participants, d?.name || 'Digimon', d?.isEnemy || false)
  }
  if (target.type === 'digimon') {
    const d = digimonById.get(target.entityId)
    targetName = resolveParticipantName(target, participants, d?.name || 'Digimon', d?.isEnemy || false)
  } else if (target.type === 'tamer') {
    const t = tamerById.get(target.entityId)
    targetName = t?.name || 'Tamer'
  }

  // Auto-miss: 0 accuracy successes = immediate miss, no intercede/dodge requests
  if (body.accuracySuccesses === 0) {
    // Still increment dodge penalty on target (successive attacks reduce dodge pool)
    participants = participants.map((p: any) => {
      if (p.id === body.targetId) {
        return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
      }
      return p
    })

    const missLog = {
      id: `log-${Date.now()}-miss`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.attackerId,
      actorName: attackerName,
      action: 'Attack Result',
      target: targetName,
      result: 'AUTO MISS - 0 accuracy successes',
      damage: 0,
      effects: ['Miss'],
      hit: false,
    }

    await db.update(encounters).set({
      participants,
      battleLog: [...battleLog, missLog],
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // === SUPPORT ATTACK ROUTING ===
  // Look up attack definition to determine if this is a support attack (map lookup, no DB query)
  let attackDef: any = null
  if (attacker.type === 'digimon') {
    const attackerDigimon = digimonById.get(attacker.entityId)
    if (attackerDigimon?.attacks) {
      const attacks = attackerDigimon.attacks
      attackDef = attacks?.find((a: any) => a.id === body.attackId)
    }
  }

  if (attackDef?.type === 'support') {
    const isAreaAttackTags = (attackDef.tags || []).some((t: string) => t.startsWith('Area Attack'))
    const isMeleeSelfBuff = attackDef.range === 'melee' && !isAreaAttackTags && body.targetId === body.attackerId

    if (isMeleeSelfBuff) {
      const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')

      const supportParams = {
        participants,
        battleLog,
        pendingRequests,
        attackerParticipantId: body.attackerId,
        targetParticipantId: body.targetId!,
        attackDef,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        round: encounter.round || 0,
        attackerName,
        targetName,
        encounterId: encounterId!,
        turnOrder,
        bolstered: body.bolstered,
        bolsterType: body.bolsterType,
        houseRules,
        eddySoulRules,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.batteryCount ?? 0,
      }

      let supportResult: any = null

      if (resolutionType === 'positive-auto') {
        supportResult = await resolvePositiveAuto(supportParams)
      } else if (resolutionType === 'positive-health') {
        supportResult = await resolvePositiveHealth(supportParams)
      } else if (resolutionType === 'negative') {
        supportResult = await resolveNegativeSupportNpc(supportParams)
      }

      if (supportResult?.resolved) {
        await db.update(encounters).set({
          participants: supportResult.participants,
          battleLog: supportResult.battleLog,
          pendingRequests: supportResult.pendingRequests,
          ...(supportResult.turnOrder ? { turnOrder: supportResult.turnOrder } : {}),
          updatedAt: new Date(),
        }).where(eq(encounters.id, encounterId))

        const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
        if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })

        return updated
      }
    }
    // All other support attacks fall through to intercede
  }

  // Flag for downstream: is this a support attack?
  const isSupportAttack = attackDef?.type === 'support'

  // --- Spatial intercede routing ---
  // Resolve the attack's range. Basic attacks (basic-melee / basic-ranged) are NOT stored on the
  // digimon record — they are client-only constants — so attackDef is null for them. Resolve by id
  // via BASIC_ATTACKS first, then DB record, then client attackData, then hugePower override.
  const basicAttackDef = BASIC_ATTACKS.find(a => a.id === body.attackId)
  const resolvedAttackRange = basicAttackDef?.range
    ?? attackDef?.range
    ?? body.attackData?.range
  const isRangedAttack = resolvedAttackRange === 'ranged'
    || body.hugePowerAttackRange === 'ranged'
  const targetPos_map = mapRecord ? (participantPositions[body.targetId!] ?? null) : null
  const attackerPos_map = mapRecord ? (participantPositions[body.attackerId] ?? null) : null
  const isRangedOnMap = isRangedAttack && !!targetPos_map && !!attackerPos_map

  // For melee with map: verify the target can be displaced before creating any offers.
  // If there is no valid non-occupied landing spot for the target, intercede is impossible.
  let targetDimsForOffer: FootprintDims = { width: 1, height: 1, depth: 1 }
  let targetCapsForOffer = detectCapabilitiesFromQualities([], 0, 0, 0)
  let targetCanBeDisplaced = true
  if (!isRangedOnMap && mapRecord && targetPos_map && target.type === 'digimon') {
    const targetDigRec = digimonById.get(target.entityId)
    if (targetDigRec) {
      const tq = targetDigRec.qualities ?? []
      const td = calculateDigimonDerivedStats(
        targetDigRec.baseStats,
        targetDigRec.stage as any,
        targetDigRec.size as any,
      )
      targetCapsForOffer = detectCapabilitiesFromQualities(tq, td.movement, td.ram, td.cpu)
      targetDimsForOffer = getFootprintDimensions(targetDigRec.size as any, (targetDigRec as any).giganticDimensions)
      // Occupied set excludes target (interceptor will take their tile)
      const preOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([body.targetId!]))
      targetCanBeDisplaced = findClosestValidDisplacementPosition(targetPos_map, mapRecord, targetCapsForOffer, preOccupied, targetDimsForOffer) !== null
    }
  }

  // Per-tamer spatial data: intercede position, jump/fly flags
  type TamerSpatialEntry = {
    interceptePos: { x: number; y: number; z: number }
    isRangedIntercede: boolean
    requiresJump: boolean
    requiresFly: boolean
    fallHeight: number
  }
  const tamerSpatialData: Record<string, TamerSpatialEntry> = {}
  const tamerReachability: Record<string, { tamerCanReach: boolean; digimonCanReach: boolean }> = {}

  // Pre-compute the melee intercept cell — it depends only on target and attacker positions, not the interceptor
  let meleeInterceptCell: { x: number; y: number; z: number } | null = null
  if (!isRangedOnMap && mapRecord && targetPos_map) {
    const targetFootprintCells = getFootprintCells(targetPos_map, targetDimsForOffer)
    let cell = targetPos_map
    if (attackerPos_map && targetFootprintCells.length > 1) {
      const sorted = [...targetFootprintCells].sort((a, b) => {
        const dA = Math.max(Math.abs(a.x - attackerPos_map.x), Math.abs(a.y - attackerPos_map.y), Math.abs(a.z - attackerPos_map.z))
        const dB = Math.max(Math.abs(b.x - attackerPos_map.x), Math.abs(b.y - attackerPos_map.y), Math.abs(b.z - attackerPos_map.z))
        return dA - dB
      })
      cell = sorted[0]
    }
    meleeInterceptCell = cell
  }

  // Find eligible tamers (those with partner digimon in encounter, not opted out)
  const eligibleTamerIds: string[] = []
  for (const p of participants) {
    if (p.type !== 'tamer') continue

    // Check opt-out: skip tamers who opted out of interceding for this target
    if (p.intercedeOptOuts?.includes(body.targetId)) continue

    // Verify they actually have a partner digimon in encounter
    let partnerParticipant: any = null
    for (const pp of participants) {
      if (pp.type !== 'digimon') continue
      const dig = digimonById.get(pp.entityId)
      if (dig?.partnerId === p.entityId) {
        partnerParticipant = pp
        break
      }
    }

    if (!partnerParticipant) continue

    // Check action eligibility: at least one of tamer or partner digimon must have eligible actions
    const tamerIsTarget = p.id === body.targetId
    const tamerIsAttacker = p.id === body.attackerId
    const digimonIsTarget = partnerParticipant.id === body.targetId
    const digimonIsAttacker = partnerParticipant.id === body.attackerId

    let digimonSpatiallyEligible = true
    let tamerSpatiallyEligible = true
    let spatialEntry: TamerSpatialEntry | null = null

    if (!digimonIsTarget && !digimonIsAttacker && mapRecord) {
      const interceptorPos = participantPositions[partnerParticipant.id]
      if (!interceptorPos) {
        // Unplaced on map = ineligible
        digimonSpatiallyEligible = false
      } else if (targetPos_map) {
        const digRec = digimonById.get(partnerParticipant.entityId)
        if (digRec) {
          const quals = digRec.qualities ?? []
          const deriv = calculateDigimonDerivedStats(
            digRec.baseStats,
            digRec.stage as any,
            digRec.size as any,
          )
          const caps = detectCapabilitiesFromQualities(quals, deriv.movement, deriv.ram, deriv.cpu)
          const budget = deriv.movement
          const interceptorDims = getFootprintDimensions(digRec.size as any, (digRec as any).giganticDimensions)

          let foundPos: { x: number; y: number; z: number } | null = null
          let isRangedIntercede = false

          if (isRangedOnMap) {
            // Ranged: find line-of-fire cell between attacker and target
            const rangedOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([partnerParticipant.id]))
            foundPos = findRangedIntercedPosition(
              attackerPos_map, targetPos_map, interceptorPos, budget, caps, interceptorDims, mapRecord, rangedOccupied,
            )
            isRangedIntercede = true
          } else if (meleeInterceptCell) {
            // Melee: interceptor must reach the footprint cell of the target closest to the attacker
            const meleeOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([partnerParticipant.id, body.targetId!]))
            const reachable = getReachableCells(interceptorPos, budget, caps, mapRecord)
            if (
              reachable.has(`${meleeInterceptCell.x},${meleeInterceptCell.y},${meleeInterceptCell.z}`) &&
              isFootprintValid(meleeInterceptCell, interceptorDims, mapRecord, meleeOccupied, caps)
            ) {
              // Confirm the target can still be displaced once this interceptor occupies meleeInterceptCell
              const occupiedWithInterceptor = new Set(meleeOccupied)
              for (const c of getFootprintCells(meleeInterceptCell, interceptorDims)) occupiedWithInterceptor.add(`${c.x},${c.y},${c.z}`)
              if (findClosestValidDisplacementPosition(targetPos_map, mapRecord, targetCapsForOffer, occupiedWithInterceptor, targetDimsForOffer) !== null) {
                foundPos = meleeInterceptCell
              }
            }
          }

          if (!foundPos) {
            digimonSpatiallyEligible = false
          } else {
            const inAir = isPositionInAir(foundPos, mapRecord)
            const requiresFly = inAir && caps.canFly
            const requiresJump = inAir && !caps.canFly
            let fallHeight = 0
            if (inAir) {
              for (let scanY = foundPos.y - 1; scanY >= -10; scanY--) {
                if (isValidLandingPosition({ x: foundPos.x, y: scanY, z: foundPos.z }, mapRecord, new Set())) {
                  fallHeight = foundPos.y - scanY
                  break
                }
              }
            }
            spatialEntry = { interceptePos: foundPos, isRangedIntercede, requiresJump, requiresFly, fallHeight }
          }
        } else if (isRangedOnMap) {
          // Cannot verify line-of-fire reachability without digimon record — ineligible for ranged
          digimonSpatiallyEligible = false
        }
        // else (melee with missing digimon record): permissive fallback remains eligible
      }
      // If !targetPos_map: remain eligible (no map position for target)
    }

    // Tamer spatial check: if map active and tamer is not the attacker, verify tamer can reach
    // the intercede position from their own location using their own movement budget (Agility + Survival)
    if (mapRecord && !tamerIsTarget && !tamerIsAttacker && targetPos_map) {
      const tamerPos = participantPositions[p.id]
      if (!tamerPos) {
        tamerSpatiallyEligible = false
      } else {
        const tamerRecord = tamerById.get(p.entityId)
        if (tamerRecord) {
          const attrs = tamerRecord.attributes || {}
          const skills = tamerRecord.skills || {}
          const tamerMovement = (attrs.agility || 0) + (skills.survival || 0)
          const tamerCaps = detectCapabilitiesFromQualities([], 0, 0, 0)
          let tamerFoundPos: { x: number; y: number; z: number } | null = null
          if (isRangedOnMap) {
            const rangedOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([p.id]))
            tamerFoundPos = findRangedIntercedPosition(
              attackerPos_map, targetPos_map, tamerPos, tamerMovement, tamerCaps, { width: 1, height: 1, depth: 1 }, mapRecord, rangedOccupied,
            )
          } else if (meleeInterceptCell) {
            const meleeOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([p.id, body.targetId!]))
            const reachable = getReachableCells(tamerPos, tamerMovement, tamerCaps, mapRecord)
            if (
              reachable.has(`${meleeInterceptCell.x},${meleeInterceptCell.y},${meleeInterceptCell.z}`) &&
              isFootprintValid(meleeInterceptCell, { width: 1, height: 1, depth: 1 }, mapRecord, meleeOccupied, tamerCaps)
            ) {
              // Confirm the target can still be displaced once this interceptor occupies meleeInterceptCell
              const occupiedWithInterceptor = new Set(meleeOccupied)
              for (const c of getFootprintCells(meleeInterceptCell, { width: 1, height: 1, depth: 1 })) occupiedWithInterceptor.add(`${c.x},${c.y},${c.z}`)
              if (findClosestValidDisplacementPosition(targetPos_map, mapRecord, targetCapsForOffer, occupiedWithInterceptor, targetDimsForOffer) !== null) {
                tamerFoundPos = meleeInterceptCell
              }
            }
          }
          tamerSpatiallyEligible = tamerFoundPos !== null
          // If digimon has no spatialEntry (e.g. it's the attacker) but tamer can intercede, store the tamer's intercede position
          if (tamerFoundPos && !spatialEntry) {
            const inAir = isPositionInAir(tamerFoundPos, mapRecord)
            const requiresFly = false  // tamers cannot fly
            const requiresJump = inAir
            let fallHeight = 0
            if (inAir) {
              for (let scanY = tamerFoundPos.y - 1; scanY >= -10; scanY--) {
                if (isValidLandingPosition({ x: tamerFoundPos.x, y: scanY, z: tamerFoundPos.z }, mapRecord, new Set())) {
                  fallHeight = tamerFoundPos.y - scanY
                  break
                }
              }
            }
            spatialEntry = { interceptePos: tamerFoundPos, isRangedIntercede: isRangedOnMap, requiresJump, requiresFly, fallHeight }
          }
        }
      }
    }

    const tamerEligible = !tamerIsTarget && !tamerIsAttacker && hasEligibleInterceptor(p) && tamerSpatiallyEligible
    const digimonEligible = !digimonIsTarget && !digimonIsAttacker && hasEligibleInterceptor(partnerParticipant) && digimonSpatiallyEligible
    if (!tamerEligible && !digimonEligible) continue

    eligibleTamerIds.push(p.entityId)
    if (spatialEntry) tamerSpatialData[p.entityId] = spatialEntry
    tamerReachability[p.entityId] = { tamerCanReach: tamerSpatiallyEligible, digimonCanReach: digimonSpatiallyEligible }
  }

  // Per-tamer Quick Reaction eligibility: only if target is their partner and order not used today
  const tamerQuickReactionMap: Record<string, { canUse: boolean; diceCount: number }> = {}
  if (target.type === 'digimon') {
    const targetDig = digimonById.get(target.entityId)
    if (targetDig) {
      const stageBonus = (STAGE_CONFIG as any)[targetDig.stage]?.stageBonus ?? 0
      const diceCount = stageBonus + 2
      for (const tamerId of eligibleTamerIds) {
        if (targetDig.partnerId !== tamerId) {
          tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }
          continue
        }
        const tamerRecord = tamerById.get(tamerId)
        if (!tamerRecord) { tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }; continue }
        const tamerAttrs = tamerRecord.attributes || {}
        const tamerXp = tamerRecord.xpBonuses || {}
        const unlockedOrders = getUnlockedSpecialOrders(tamerAttrs, tamerXp, campaignLevel as any)
        const hasQR = unlockedOrders.some((o: any) => o.name === 'Quick Reaction')
        if (!hasQR) { tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }; continue }
        const usedPerDay = tamerRecord.usedPerDayOrders || []
        tamerQuickReactionMap[tamerId] = { canUse: !usedPerDay.includes('Quick Reaction'), diceCount }
      }
    }
  }

  // GM always gets intercede modal unless explicitly opted out via "Never Intercede"
  const gmParticipant = participants.find((p: any) => p.id === 'gm')
  const gmOptOuts: string[] = gmParticipant?.intercedeOptOuts || []
  let gmEligible = !gmOptOuts.includes(body.targetId)

  // Check per-character opt-outs: if GM has opted out all possible interceptors for this target, skip
  if (gmEligible) {
    const gmCharacterOptOuts: Record<string, string[]> = gmParticipant?.gmCharacterOptOuts || {}
    const optedOutForTarget = gmCharacterOptOuts[body.targetId!] || []
    const possibleInterceptors = participants.filter((p: any) =>
      (p.type === 'tamer' || p.type === 'digimon') &&
      p.id !== body.attackerId &&
      p.id !== body.targetId
    )
    if (possibleInterceptors.length > 0 && possibleInterceptors.every((p: any) => optedOutForTarget.includes(p.id))) {
      gmEligible = false
    }
  }

  // Melee only: if the target has no valid displacement position, suppress all offers.
  if (!isRangedOnMap && !targetCanBeDisplaced) {
    eligibleTamerIds.splice(0)
    gmEligible = false
  }

  if (eligibleTamerIds.length === 0 && !gmEligible) {
    // No eligible tamers and GM not eligible — check if target is player-controlled or NPC
    let isPlayerTarget = false
    if (target.type === 'tamer') {
      isPlayerTarget = true
    } else if (target.type === 'digimon') {
      const dig = digimonById.get(target.entityId)
      isPlayerTarget = !!dig?.partnerId
    }

    if (isPlayerTarget) {
      const positiveResolutionType = getPositiveSupportResolutionType(isSupportAttack, attackDef)
      if (positiveResolutionType) {
        const supportParams = {
          participants, battleLog, pendingRequests,
          attackerParticipantId: body.attackerId,
          targetParticipantId: body.targetId!,
          attackDef,
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          round: encounter.round || 0,
          attackerName, targetName,
          encounterId: encounterId!,
          turnOrder, houseRules,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.batteryCount ?? 0,
        }
        const supportResult = positiveResolutionType === 'positive-auto'
          ? await resolvePositiveAuto(supportParams)
          : await resolvePositiveHealth(supportParams)

        await db.update(encounters).set({
          participants: supportResult.participants,
          battleLog: supportResult.battleLog,
          pendingRequests: supportResult.pendingRequests,
          ...(supportResult.turnOrder ? { turnOrder: supportResult.turnOrder } : {}),
          updatedAt: new Date(),
        }).where(eq(encounters.id, encounterId))

        const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
        if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })

        return updated
      }

      // Player target — create dodge request
      let dodgeTargetTamerId = 'GM'
      if (target.type === 'tamer') {
        dodgeTargetTamerId = target.entityId
      } else if (target.type === 'digimon') {
        const dig = digimonById.get(target.entityId)
        if (dig?.partnerId) dodgeTargetTamerId = dig.partnerId
      }

      const dodgeRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'dodge-roll',
        targetTamerId: dodgeTargetTamerId,
        targetParticipantId: body.targetId,
        timestamp: new Date().toISOString(),
        data: {
          attackerName, targetName,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId, attackData: body.attackData,
          attackerEntityId: attacker.entityId,
          attackerParticipantId: body.attackerId,
          targetEntityId: target.entityId,
          dodgePenalty: target.dodgePenalty ?? 0,
          // Bolster bonuses for damage calculation
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          lifestealed: body.lifestealed || false,
          // Support attack flag — downstream handlers skip damage
          isSupportAttack: isSupportAttack || false,
          // Signature Move Battery bonus
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          // Clash modifiers
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        },
      }

      await db.update(encounters).set({
        pendingRequests: [...pendingRequests, dodgeRequest],
        participants,
        updatedAt: new Date(),
      }).where(eq(encounters.id, encounterId))

      const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

      if (!updated) {
        throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
      }

      return updated
    } else {
      // NPC target — resolve based on attack type
      if (isSupportAttack && attackDef) {
        const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')
        const supportParams = {
          participants, battleLog, pendingRequests,
          attackerParticipantId: body.attackerId,
          targetParticipantId: body.targetId!,
          attackDef,
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          round: encounter.round || 0,
          attackerName, targetName,
          encounterId: encounterId!,
          turnOrder, houseRules,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.batteryCount ?? 0,
        }
        let supportResult: any = null
        if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
        else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
        else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)

        if (supportResult) {
          await db.update(encounters).set({
            participants: supportResult.participants,
            battleLog: supportResult.battleLog,
            pendingRequests: supportResult.pendingRequests,
            ...(supportResult.turnOrder ? { turnOrder: supportResult.turnOrder } : {}),
            updatedAt: new Date(),
          }).where(eq(encounters.id, encounterId))

          const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
          if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })

          return updated
        }
      } else {
        // Damage attack — auto-resolve NPC (roll dodge, calculate damage)
        const result = await resolveNpcAttack({
          participants, battleLog,
          attackerParticipantId: body.attackerId,
          targetParticipantId: body.targetId!,
          attackId: body.attackId,
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          round: encounter.round || 0,
          attackerName, targetName,
          turnOrder,
          currentTurnIndex: encounter.currentTurnIndex || 0,
          houseRules,
          clashAttack: body.clashAttack,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty,
        })

        await db.update(encounters).set({
          participants: result.participants,
          battleLog: result.battleLog,
          ...(result.turnOrder ? { turnOrder: result.turnOrder } : {}),
          ...(result.nextTurnIndex !== undefined ? { currentTurnIndex: result.nextTurnIndex } : {}),
          ...(result.nextRound !== undefined ? { round: result.nextRound } : {}),
          updatedAt: new Date(),
        }).where(eq(encounters.id, encounterId))

        // Check for Counterattack quality on the target (the one who was missed)
        if (!result.hit && target?.type === 'digimon' && !target?.usedCounterattackThisCombat) {
          const tgtDig = digimonById.get(target.entityId)
          const tgtQualities = tgtDig?.qualities || []
          if ((tgtQualities as any[]).some((q: any) => q.id === 'counterattack')) {
            const freshEnc = await db.select().from(encounters).where(eq(encounters.id, encounterId)).then(r => r[0])
            const caResult = await triggerCounterattack({
              participants: freshEnc.participants,
              battleLog: freshEnc.battleLog,
              pendingRequests: freshEnc.pendingRequests,
              round: encounter.round || 0,
              counterattackerParticipantId: body.targetId!,
              originalAttackerParticipantId: body.attackerId,
              houseRules,
              turnOrder: freshEnc.turnOrder,
              currentTurnIndex: freshEnc.currentTurnIndex ?? 0,
            })
            await db.update(encounters).set({
              participants: caResult.participants,
              battleLog: caResult.battleLog,
              pendingRequests: caResult.pendingRequests,
              ...(caResult.nextTurnIndex !== undefined ? { currentTurnIndex: caResult.nextTurnIndex } : {}),
              ...(caResult.nextRound !== undefined ? { round: caResult.nextRound } : {}),
              updatedAt: new Date(),
            }).where(eq(encounters.id, encounterId))
          }
        }

        const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

        if (!updated) {
          throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
        }

        return updated
      }
    }
  }

  // If no player tamers eligible but GM is, create GM-only intercede offer
  if (eligibleTamerIds.length === 0 && gmEligible) {
    const intercedeGroupId = `intercede-${Date.now()}-${body.targetId}`
    const gmRequest = {
      id: `req-${Date.now()}-gm`,
      type: 'intercede-offer',
      targetTamerId: 'GM',
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds: [],
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        isRangedIntercede: isRangedAttack,
      },
    }

    await db.update(encounters).set({
      pendingRequests: [...pendingRequests, gmRequest],
      participants,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    if (!updated) {
      throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
    }

    return updated
  }

  // Create a unique intercede group ID to link all offers for this attack
  const intercedeGroupId = `intercede-${Date.now()}-${body.targetId}`

  // Create intercede-offer requests for each eligible tamer
  const newRequests: any[] = []
  for (const tamerId of eligibleTamerIds) {
    const qr = tamerQuickReactionMap[tamerId] || { canUse: false, diceCount: 0 }
    const spatial = tamerSpatialData[tamerId] ?? null
    const reachability = tamerReachability[tamerId] ?? { tamerCanReach: true, digimonCanReach: true }
    newRequests.push({
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'intercede-offer',
      targetTamerId: tamerId,
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds,
        // Pass through bolster bonuses
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        canUseQuickReaction: qr.canUse,
        quickReactionDiceCount: qr.diceCount,
        // Spatial intercede data (null when no map)
        interceptePos: spatial?.interceptePos ?? null,
        isRangedIntercede: spatial?.isRangedIntercede || isRangedAttack,
        requiresJump: spatial?.requiresJump ?? false,
        requiresFly: spatial?.requiresFly ?? false,
        fallHeight: spatial?.fallHeight ?? 0,
        tamerCanReach: reachability.tamerCanReach,
        digimonCanReach: reachability.digimonCanReach,
      },
    })
  }

  // Add GM intercede offer if eligible (reusing check computed earlier)
  if (gmEligible) {
    newRequests.push({
      id: `req-${Date.now()}-gm`,
      type: 'intercede-offer',
      targetTamerId: 'GM',
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        isRangedIntercede: isRangedAttack,
      },
    })
  }

  // Update encounter with new requests and updated participants (attacker actions deducted)
  await db.update(encounters).set({
    pendingRequests: [...pendingRequests, ...newRequests],
    participants,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return updated
})
