import { eq, inArray } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns, evolutionLines, maps } from '../../../../db'
import { applyEffectToParticipant } from '../../../../utils/applyEffect'
import { type AreaAttackClaim, allAreaTargetsDecided, resolveAreaIntercedeGroup, isAreaTargetCovered } from '~/server/utils/resolveAreaIntercedeGroup'
import { computeAttackDamage } from '~/server/utils/computeAttackDamage'
import { BASIC_ATTACKS } from '~/data/attackConstants'
import {
  type FootprintDims,
  detectCapabilitiesFromQualities,
  getFootprintDimensions,
  isValidLandingPosition,
  getFootprintCells,
  isFootprintValid,
  isPositionInAir,
  findClosestValidDisplacementPosition,
  findRangedIntercedPosition,
  findThrowLandingCell,
  getFootprintDimsForParticipant,
  buildFootprintOccupiedSet,
  findAreaIntercedePosition,
  hasValidThrowOutOfAreaCell,
  computeFallDamage,
} from '~/server/utils/mapMovement'
import { calculateDigimonDerivedStats } from '~/types'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'
import { type Vec3, computeAreaCellsFromData } from '~/utils/areaShapes'
import { broadcastPositionPatch, getRoomPositions, getRoomSnapshot } from '~/server/utils/encounterRoom'
import { loadEncounterMap, getMovementProfile } from '~/server/utils/combatSpatial'

interface IntercedeClaimBody {
  requestId: string
  interceptorParticipantId: string
  chosenTargetId?: string // Required for area attacks
  throwAllyLandingPos?: Vec3
}

/**
 * Strips the claimed target from all group offers, and also removes the claiming
 * interceptor as an option for every other target in the group (they've already
 * spent their intercede action on this area attack). Removes offers left with no
 * eligible targets.
 */
function stripClaimantFromGroupOffers(
  pendingRequests: any[],
  intercedeGroupId: string,
  interceptorParticipantId: string,
  effectiveTargetId: string,
  participants: any[],
  digimonById: Map<string, any>
): any[] {
  let updated = pendingRequests.map((r: any) => {
    if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return r
    const d = r.data
    if (r.targetTamerId === 'GM') {
      const npcAreaEligibility: Record<string, string[]> = {}
      for (const [npcId, targets] of Object.entries(d.npcAreaEligibility || {})) {
        if (npcId === interceptorParticipantId) continue
        const remaining = (targets as string[]).filter((tid: string) => tid !== effectiveTargetId)
        if (remaining.length > 0) npcAreaEligibility[npcId] = remaining
      }
      return { ...r, data: { ...d, npcAreaEligibility, gmAreaTargetIds: [...new Set(Object.values(npcAreaEligibility).flat())] } }
    }

    const tamerParticipantId = participants.find((p: any) => p.type === 'tamer' && p.entityId === r.targetTamerId)?.id
    const digimonParticipantId = participants.find((p: any) => p.type === 'digimon' && digimonById.get(p.entityId)?.partnerId === r.targetTamerId)?.id

    let tamerAreaTargetIds = (d.tamerAreaTargetIds || []).filter((tid: string) => tid !== effectiveTargetId)
    if (interceptorParticipantId === tamerParticipantId) tamerAreaTargetIds = []

    let digimonAreaTargetIds = (d.digimonAreaTargetIds || []).filter((tid: string) => tid !== effectiveTargetId)
    if (interceptorParticipantId === digimonParticipantId) digimonAreaTargetIds = []

    return { ...r, data: { ...d, tamerAreaTargetIds, digimonAreaTargetIds } }
  })

  updated = updated.filter((r: any) => {
    if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return true
    if (r.targetTamerId === 'GM') return Object.keys(r.data.npcAreaEligibility || {}).length > 0
    return (r.data.tamerAreaTargetIds || []).length > 0 || (r.data.digimonAreaTargetIds || []).length > 0
  })

  return updated
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeClaimBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId || !body.interceptorParticipantId) {
    throw createError({ statusCode: 400, message: 'requestId and interceptorParticipantId are required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = campaign.rulesSettings || {}
      houseRules = rulesSettings.houseRules
    }
  }

  let participants = encounter.participants || []
  let pendingRequests = encounter.pendingRequests || []
  let battleLog = encounter.battleLog || []

  const participantPositions: Record<string, { x: number; y: number; z: number }> = await getRoomPositions(encounterId)

  const participantDigimonIds = participants.filter((p: any) => p.type === 'digimon').map((p: any) => p.entityId as string)
  const participantTamerIds = participants.filter((p: any) => p.type === 'tamer').map((p: any) => p.entityId as string)
  const [allParticipantDigimon, allParticipantTamers] = await Promise.all([
    participantDigimonIds.length > 0 ? db.select().from(digimon).where(inArray(digimon.id, participantDigimonIds)) : Promise.resolve([]),
    participantTamerIds.length > 0 ? db.select().from(tamers).where(inArray(tamers.id, participantTamerIds)) : Promise.resolve([]),
  ])
  const digimonById = new Map(allParticipantDigimon.map((d: any) => [d.id, d]))
  const tamerById = new Map(allParticipantTamers.map((t: any) => [t.id, t]))

  // Find the request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  const intercedeGroupId = request.data.intercedeGroupId
  const isAreaAttack = !!request.data.isAreaAttack

  // Selective Targeting: total target count for area attacks comes from the group state
  let totalTargetCount = 1
  if (isAreaAttack) {
    const groupStateForCount = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    totalTargetCount = groupStateForCount?.data?.originalTargetIds?.length ?? 1
  }

  // Load map for spatial position validation (single-target intercede, or area-attack throw claims)
  const claimMapRecord: any = (encounter as any).mapId ? await loadEncounterMap((encounter as any).mapId) : null

  // Determine effective target — area attacks use chosenTargetId
  let effectiveTargetId: string
  let effectiveTargetName: string

  if (isAreaAttack) {
    if (!body.chosenTargetId) {
      throw createError({ statusCode: 400, message: 'chosenTargetId is required for area attacks' })
    }
    const chosenTargetId: string = body.chosenTargetId
    if (!isAreaTargetCovered(request.data, chosenTargetId)) {
      throw createError({ statusCode: 400, message: 'chosenTargetId is not a valid target for this request' })
    }
    // 409 check: is chosen target still available (not already claimed by another interceptor)?
    const stillAvailable = pendingRequests.some(
      (r: any) => r.data?.intercedeGroupId === intercedeGroupId && isAreaTargetCovered(r.data, chosenTargetId)
    )
    if (!stillAvailable) {
      throw createError({ statusCode: 409, message: 'Target already claimed by another interceptor' })
    }
    effectiveTargetId = chosenTargetId
    const chosenParticipant = participants.find((p: any) => p.id === chosenTargetId)
    if (chosenParticipant?.type === 'digimon') {
      effectiveTargetName = digimonById.get(chosenParticipant.entityId)?.name || chosenTargetId
    } else if (chosenParticipant?.type === 'tamer') {
      effectiveTargetName = tamerById.get(chosenParticipant.entityId)?.name || chosenTargetId
    } else {
      effectiveTargetName = chosenTargetId
    }
  } else {
    // Single-target 409 check: if no group requests left, someone already claimed
    const groupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)
    if (groupRequests.length === 0) {
      throw createError({ statusCode: 409, message: 'Another player already interceded' })
    }
    effectiveTargetId = request.data.targetId
    effectiveTargetName = request.data.targetName || 'Unknown'
  }

  // Find interceptor
  const interceptor = participants.find((p: any) => p.id === body.interceptorParticipantId)
  if (!interceptor) {
    throw createError({ statusCode: 404, message: 'Interceptor not found' })
  }

  // Interceptor cannot be the same as the target
  if (body.interceptorParticipantId === effectiveTargetId) {
    throw createError({ statusCode: 400, message: 'Interceptor cannot be the same as the target' })
  }

  // Interceptor cannot be the same as the attacker
  if (body.interceptorParticipantId === request.data.attackerId) {
    throw createError({ statusCode: 400, message: 'Attacker cannot intercede their own attack' })
  }

  // Determine if interceptor's turn has already happened this round
  let turnOrder = encounter.turnOrder || []
  const currentTurnIndex = encounter.currentTurnIndex || 0
  let turnHasGone = false

  if (interceptor.type === 'tamer') {
    const idx = turnOrder.indexOf(interceptor.id)
    turnHasGone = idx >= 0 && idx < currentTurnIndex
  } else if (interceptor.type === 'digimon') {
    // Partner digimon use the hasActed flag set at tamer turn-end
    const digimonEntity = digimonById.get(interceptor.entityId)
    if (digimonEntity?.partnerId) {
      // Player digimon: use hasActed flag (set when partner tamer's turn ends)
      turnHasGone = !!interceptor.hasActed
    } else {
      // NPC digimon — check own turn position directly
      const idx = turnOrder.indexOf(interceptor.id)
      turnHasGone = idx >= 0 && idx < currentTurnIndex
    }
  }

  // Validate against the INTERCEPTOR directly
  if (!turnHasGone) {
    // Must have an action to spend THIS round
    if ((interceptor.actionsRemaining?.simple || 0) < 1) {
      throw createError({ statusCode: 400, message: 'Not enough actions to intercede' })
    }
  } else {
    // Already acted — check deferred intercede cap (maxPostTurnIntercedes, default 2)
    const postTurnCap = interceptor.type === 'digimon'
      ? (interceptor.maxPostTurnIntercedes ?? 2)
      : 2
    if ((interceptor.interceptPenalty || 0) >= postTurnCap) {
      throw createError({ statusCode: 400, message: 'No more intercede actions available for next round' })
    }
  }

  // Get interceptor name + full DB record (needed for size/caps in position logic)
  let interceptorName = 'Unknown'
  let interceptorDigRec: any = null
  if (interceptor.type === 'digimon') {
    interceptorDigRec = digimonById.get(interceptor.entityId) ?? null
    interceptorName = interceptorDigRec?.name || 'Digimon'
  }

  // Load target's digimon record for size/caps (used in displacement logic)
  let targetDigRecForPos: any = null
  const targetParticipantForPos = participants.find((p: any) => p.id === effectiveTargetId)
  if (targetParticipantForPos?.type === 'digimon') {
    targetDigRecForPos = digimonById.get(targetParticipantForPos.entityId) ?? null
  }

  const { accuracySuccesses, attackerId, attackData } = request.data
  const attacker = participants.find((p: any) => p.id === attackerId)
  const isSupportAttack = request.data.isSupportAttack || false

  // Resolve the attack's range for reliable ranged-vs-melee detection at claim time.
  // Basic attacks (basic-melee / basic-ranged) are client-only constants and are NOT stored on
  // the digimon record, so resolve them by id first. Then fall back to the attacking digimon's
  // stored attack definition. The stored isRangedIntercede flag alone can be wrong.
  let claimAttackRange: string | null = BASIC_ATTACKS.find(a => a.id === request.data.attackId)?.range ?? null
  if (!claimAttackRange && !isAreaAttack && attacker?.type === 'digimon') {
    const attackerDigForRange = digimonById.get(attacker.entityId)
    if (attackerDigForRange?.attacks) {
      const attacks = attackerDigForRange.attacks
      const foundAttack = (attacks as any[])?.find((a: any) => a.id === request.data.attackId)
      claimAttackRange = foundAttack?.range ?? null
    }
  }

  let throwAllyFallDamage = 0
  let throwAllyLandingCell: { x: number; y: number; z: number } | null = null

  // Single-target position swap with spatial validation.
  // For melee: interceptor moves to target's tile; target is displaced to nearest valid spot.
  // For ranged: interceptor moves to a line-of-fire cell stored in the offer; target stays put.
  let updatedParticipantPositions: Record<string, { x: number; y: number; z: number }> | null = null
  let fallDamageToApply = 0  // wounds applied to interceptor if they jumped to intercede

  // --- Area-attack intercede claim: reposition interceptor into the AoE adjacent to the
  // target, then throw the target out of the AoE to the chosen landing cell ---
  if (isAreaAttack && claimMapRecord) {
    if (!body.throwAllyLandingPos) {
      throw createError({ statusCode: 400, message: 'Choose a valid landing cell outside the blast, or use a normal Intercede instead' })
    }

    // Recompute AoE cells from the persisted shape data
    const groupStateForShape = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    const areaShapeData = groupStateForShape?.data?.areaShapeData
    if (!areaShapeData) {
      throw createError({ statusCode: 409, message: 'Area shape data missing from group state' })
    }
    const areaCells = new Set(computeAreaCellsFromData(areaShapeData).map(c => `${c.x},${c.y},${c.z}`))

    const interceptorPos = participantPositions[body.interceptorParticipantId]
    const targetPos = participantPositions[effectiveTargetId]
    if (!interceptorPos || !targetPos) {
      throw createError({ statusCode: 400, message: 'Position data unavailable for intercede' })
    }

    const interceptorDims = getFootprintDimsForParticipant(interceptor, digimonById)
    const targetDims = getFootprintDimsForParticipant(targetParticipantForPos!, digimonById)

    // Interceptor's movement/throw profile: budget+caps drive repositioning into the AoE,
    // bodyStat drives how far the target can then be thrown out of the AoE
    const { caps, budget, bodyStat } = getMovementProfile(interceptor, digimonById, tamerById)

    // Step 1: reposition the interceptor into the AoE, adjacent to the target
    const repositionOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([body.interceptorParticipantId, effectiveTargetId]))
    const interceptePos = findAreaIntercedePosition(targetPos, targetDims, interceptorPos, budget, caps, interceptorDims, claimMapRecord, repositionOccupied, areaCells)
    if (!interceptePos) {
      throw createError({ statusCode: 409, message: 'No valid intercede position available — board state changed' })
    }

    // Interceptors take no fall damage for repositioning into the AoE while interceding
    updatedParticipantPositions = { ...participantPositions, [body.interceptorParticipantId]: interceptePos }

    // Step 2: throw the target out of the AoE to the chosen landing cell
    const throwOccupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([effectiveTargetId]))
    const landingCell = findThrowLandingCell(targetPos, body.throwAllyLandingPos, bodyStat, targetDims, claimMapRecord, throwOccupied, areaCells)
    if (!landingCell) {
      throw createError({ statusCode: 409, message: 'Invalid throw landing position — board state changed' })
    }

    // Fall damage on landing for the thrown target
    let targetFallHeight = 0
    if (isPositionInAir(landingCell, claimMapRecord)) {
      let checkY = landingCell.y
      while (checkY > 0 && isPositionInAir({ x: landingCell.x, y: checkY - 1, z: landingCell.z }, claimMapRecord)) {
        checkY -= 1
      }
      targetFallHeight = landingCell.y - (checkY - 1)
    }
    // Fall damage = meters past the first 5, reduced by CPU (min 1); Tumbler adds RAM×2 reduction,
    // Advanced Mobility: Jumper negates entirely.
    throwAllyFallDamage = 0
    if (targetFallHeight > 0) {
      const targetQualities = targetDigRecForPos?.qualities || []
      const hasTumbler = targetQualities.some((q: any) => q.id === 'tumbler')
      const hasAdvJumper = targetQualities.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
      let cpu = 1, ram = 0
      if (targetParticipantForPos?.type === 'digimon') {
        const td = await getDigimonDerivedStats(targetParticipantForPos.entityId)
        cpu = td?.cpu ?? 0; ram = td?.ram ?? 0
      }
      throwAllyFallDamage = computeFallDamage(targetFallHeight, cpu, hasTumbler, hasAdvJumper, ram)
    }

    throwAllyLandingCell = landingCell
    updatedParticipantPositions[effectiveTargetId] = landingCell
  }

  if (!isAreaAttack && claimMapRecord) {
    const interceptorPos = participantPositions[body.interceptorParticipantId]
    const isRangedIntercede: boolean =
      claimAttackRange === 'ranged' ||
      !!(request.data.isRangedIntercede) ||
      request.data.attackData?.range === 'ranged'
    const targetPos = participantPositions[effectiveTargetId]
    const attackerPos = participantPositions[attackerId]
    // For ranged intercede the destination is the pre-computed line-of-fire cell stored in the
    // offer; targetPos is only the fallback for melee (where it is always the intercede tile).
    let intercDePos: { x: number; y: number; z: number } | undefined =
      request.data.interceptePos ?? targetPos

    // GM ranged intercede: no specific interceptor was chosen at offer time, so no position was
    // pre-computed. Compute the best reachable line-of-fire cell now using the chosen interceptor.
    if (isRangedIntercede && !request.data.interceptePos && interceptorPos && targetPos && attackerPos && interceptorDigRec && interceptor.type === 'digimon') {
      const { caps, budget } = getMovementProfile(interceptor, digimonById, tamerById)
      const interceptorDims = getFootprintDimensions(interceptorDigRec.size as any, (interceptorDigRec as any).giganticDimensions)
      const occupied = buildFootprintOccupiedSet(participantPositions, participants, digimonById, new Set([body.interceptorParticipantId]))
      const computed = findRangedIntercedPosition(attackerPos, targetPos, interceptorPos, budget, caps, interceptorDims, claimMapRecord, occupied)
      intercDePos = computed ?? undefined
    }

    if (interceptorPos && intercDePos) {
      updatedParticipantPositions = { ...participantPositions }

      // Move interceptor to their intercede position
      updatedParticipantPositions[body.interceptorParticipantId] = { ...intercDePos }

      // Interceptor jumped to reach the intercede tile and now falls back down. Per the jump-into-air
      // rule, a unit that used its own jump movement takes NO fall damage — it still drops to the ground.
      if ((request.data.requiresJump ?? false) && !(request.data.requiresFly ?? false)) {
        const fallHeight: number = request.data.fallHeight || 0
        fallDamageToApply = 0
        if (fallHeight > 0) {
          const groundY = intercDePos.y - fallHeight
          updatedParticipantPositions[body.interceptorParticipantId] = { x: intercDePos.x, y: groundY, z: intercDePos.z }
        }
      }

      if (!isRangedIntercede && targetPos) {
        // Melee: displace the target away from the interceptor's new position
        const interceptorDims: FootprintDims = interceptorDigRec
          ? getFootprintDimensions(interceptorDigRec.size as any, (interceptorDigRec as any).giganticDimensions)
          : { width: 1, height: 1, depth: 1 }
        const targetDims: FootprintDims = targetDigRecForPos
          ? getFootprintDimensions(targetDigRecForPos.size as any, (targetDigRecForPos as any).giganticDimensions)
          : { width: 1, height: 1, depth: 1 }

        const defaultCaps = { canFly: false, canJump: false, jumpRange: 0, jumpHeight: 0, canClimb: false, canSwim: false, canDig: false }
        const targetCaps = targetDigRecForPos ? (() => {
          const tq = targetDigRecForPos.qualities ?? []
          const td = calculateDigimonDerivedStats(
            targetDigRecForPos.baseStats,
            targetDigRecForPos.stage as any,
            targetDigRecForPos.size as any,
          )
          return detectCapabilitiesFromQualities(tq, td.movement, td.ram, td.cpu)
        })() : defaultCaps

        // Occupied set: exclude interceptor (at target's tile) and target (leaving),
        // then add the interceptor's full footprint so target can't land in their space
        const claimOccupied = buildFootprintOccupiedSet(updatedParticipantPositions, participants, digimonById, new Set([body.interceptorParticipantId, effectiveTargetId]))
        getFootprintCells(intercDePos, interceptorDims).forEach((cell: { x: number; y: number; z: number }) => {
          claimOccupied.add(`${cell.x},${cell.y},${cell.z}`)
        })

        // Preferred displacement: interceptor's footprint width/height/depth in the direction away from attacker
        let displacedPos: { x: number; y: number; z: number } | null = null
        if (attackerPos) {
          const dir = {
            x: Math.sign(targetPos.x - attackerPos.x),
            y: Math.sign(targetPos.y - attackerPos.y),
            z: Math.sign(targetPos.z - attackerPos.z),
          }
          if (dir.x !== 0 || dir.y !== 0 || dir.z !== 0) {
            const preferred = {
              x: targetPos.x + dir.x * interceptorDims.width,
              y: targetPos.y + dir.y * interceptorDims.height,
              z: targetPos.z + dir.z * interceptorDims.depth,
            }
            if (isFootprintValid(preferred, targetDims, claimMapRecord, claimOccupied, targetCaps)) {
              displacedPos = preferred
            }
          }
        }

        // BFS fallback if preferred direction is blocked
        if (!displacedPos) {
          displacedPos = findClosestValidDisplacementPosition(
            targetPos, claimMapRecord, targetCaps, claimOccupied, targetDims,
          )
        }

        if (displacedPos) {
          updatedParticipantPositions[effectiveTargetId] = displacedPos
        }
        // else: target cannot be displaced (edge case — offer.post should have blocked this)
      }
      // Ranged intercede: target stays in place, only interceptor moves
    }
  }

  // Compute damage using shared canonical function (dodge successes = 0 for intercede)
  const damageCalc = await computeAttackDamage({
    attackerParticipant: attacker,
    targetParticipant: interceptor,
    attackId: request.data.attackId,
    attackerName: request.data.attackerName,
    accuracySuccesses,
    dodgeSuccesses: 0,
    isSignatureMove: request.data.isSignatureMove,
    batteryCount: request.data.batteryCount,
    totalTargetCount,
    houseRules,
  })

  const npcAttackDef = damageCalc.attackDef
  const attackBaseDamage = damageCalc.attackBaseDamage
  const armorPiercing = damageCalc.armorPiercing
  const interceptorArmor = damageCalc.targetArmor
  const effectiveArmor = damageCalc.effectiveArmor
  const damageDealt = damageCalc.damageDealt
  const netSuccesses = damageCalc.netSuccesses
  // hit is always true for intercede (dodgeSuccesses = 0, so netSuccesses >= 0)

  // --- Support attack: no damage, apply N effect only ---
  if (isSupportAttack) {
    let appliedEffectName: string | null = null

    const supportPotency = damageCalc.effectData?.potency ?? 0
    const supportPotencyStat = damageCalc.effectData?.potencyStat ?? 'bit'

    let stunActionReducedThisRound = false

    participants = participants.map((p: any) => {
      if (p.id === body.interceptorParticipantId) {
        const updated = {
          ...p,
          // Deduct/defer action at claim time (prevents double-spending before resolution)
          ...(!turnHasGone
            ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) } }
            : { interceptPenalty: (p.interceptPenalty || 0) + 1 }
          ),
        }

        // Stun extra action deduction: apply at claim time for all attacks
        if (npcAttackDef?.effect === 'Stun' && !turnHasGone) {
          updated.actionsRemaining = { simple: Math.max(0, (updated.actionsRemaining?.simple || p.actionsRemaining?.simple || 0) - 1) }
          updated.stunActionReducedThisRound = true
          stunActionReducedThisRound = true
        } else if (npcAttackDef?.effect === 'Stun' && turnHasGone) {
          updated.interceptPenalty = (p.interceptPenalty || 0) + 1
          updated.stunActionReducedThisRound = true
          stunActionReducedThisRound = true
        }

        // Effects on activeEffects: only apply immediately for single-target intercede
        if (!isAreaAttack && damageCalc.effectData) {
          updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], damageCalc.effectData, houseRules)
          appliedEffectName = damageCalc.attackDef?.effect ?? null
          if (damageCalc.secondaryEffectData) {
            updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.secondaryEffectData, houseRules)
          }
        }

        // Fall damage from jumping to intercede position
        if (!isAreaAttack && fallDamageToApply > 0) {
          (updated as any).currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + fallDamageToApply)
        }

        return updated
      }
      // Dodge penalty on target: deferred for area attacks (resolveAreaIntercedeGroup handles it)
      if (!isAreaAttack && p.id === effectiveTargetId) {
        return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
      }
      // Throw-claim: apply fall damage to the rescued ally landing outside the AoE
      if (isAreaAttack && p.id === effectiveTargetId && throwAllyFallDamage > 0) {
        return { ...p, currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + throwAllyFallDamage) }
      }
      return p
    })

    let claimNextTurnIndex: number | undefined
    let claimNextRound: number | undefined

    if (isAreaAttack) {
      const newClaim: AreaAttackClaim = {
        interceptorParticipantId: body.interceptorParticipantId,
        targetId: effectiveTargetId,
        interceptorName,
        targetName: effectiveTargetName,
        damageDealt: 0,
        appliedEffectName: damageCalc.appliedEffectName,
        effectData: damageCalc.effectData ?? null,
        stunActionReducedThisRound,
        interceptorArmor: 0,
        armorPiercing: 0,
        effectiveArmor: 0,
        attackBaseDamage: 0,
        netSuccesses,
        isSupportAttack: true,
      }

      // Strip claimed target and claiming interceptor from ALL group offers; remove empty ones
      pendingRequests = stripClaimantFromGroupOffers(
        pendingRequests,
        intercedeGroupId,
        body.interceptorParticipantId,
        effectiveTargetId,
        participants,
        digimonById
      )

      // Record claim in intercede-group-state
      const groupState = pendingRequests.find(
        (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
      )
      if (groupState) {
        groupState.data.claims = [...(groupState.data.claims || []), newClaim]
      }

      // Resolve when all targets have a decision
      if (groupState && allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) {
        const resolved = await resolveAreaIntercedeGroup({
          groupState,
          participants,
          battleLog,
          pendingRequests,
          turnOrder,
          round: encounter.round || 0,
          currentTurnIndex: encounter.currentTurnIndex || 0,
          houseRules,
          encounterId: encounterId!,
        })
        participants = resolved.participants
        battleLog = resolved.battleLog
        pendingRequests = resolved.pendingRequests
        turnOrder = resolved.turnOrder
        if (resolved.nextTurnIndex !== undefined) claimNextTurnIndex = resolved.nextTurnIndex
        if (resolved.nextRound !== undefined) claimNextRound = resolved.nextRound
      }
    } else {
      pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

      const fallEffects = !isAreaAttack && fallDamageToApply > 0 ? [`Fell ${request.data.fallHeight} tiles (${fallDamageToApply} wound${fallDamageToApply !== 1 ? 's' : ''})`] : []
      const intercedeLog = {
        id: `log-${Date.now()}-intercede`,
        timestamp: new Date().toISOString(),
        round: encounter.round || 0,
        actorId: body.interceptorParticipantId,
        actorName: interceptorName,
        action: `Interceded for ${effectiveTargetName}! (Support)`,
        target: null,
        result: appliedEffectName
          ? `Takes debuff with 0 dodge - ${appliedEffectName} applied for ${Math.max(1, netSuccesses)} rounds`
          : 'Interceded (no effect)',
        damage: fallDamageToApply || 0,
        effects: [...(appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede']), ...fallEffects],
        hit: true,
        dodgeDicePool: 0,
        dodgeDiceResults: [],
        dodgeSuccesses: 0,
      }
      battleLog = [...battleLog, intercedeLog]
    }

    await db.update(encounters).set({
      participants,
      pendingRequests,
      battleLog,
      turnOrder,
      ...(claimNextTurnIndex !== undefined ? { currentTurnIndex: claimNextTurnIndex } : {}),
      ...(claimNextRound !== undefined ? { round: claimNextRound } : {}),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    if (updatedParticipantPositions) {
      await broadcastPositionPatch(encounterId, updatedParticipantPositions)
    }

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })

    const room = await getRoomSnapshot(encounterId)
    return { ...updated, participantPositions: room.participantPositions, destructibleStates: room.destructibleStates }
  }

  // --- Damage attack: existing flow ---
  // All damage values (interceptorArmor, effectiveArmor, damageDealt, etc.) already
  // computed by computeAttackDamage above.

  // Apply damage/effects to interceptor, deduct/defer actions
  let appliedEffectName: string | null = null
  let stunActionReducedThisRound = false

  participants = participants.map((p: any) => {
    if (p.id === body.interceptorParticipantId) {
      const updated: any = {
        ...p,
        // Action deduction at claim time (prevents double-spending before resolution)
        ...(!turnHasGone
          ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) } }
          : { interceptPenalty: (p.interceptPenalty || 0) + 1 }
        ),
      }

      // Wounds: only apply immediately for single-target intercede
      if (!isAreaAttack) {
        updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt)
        if (damageCalc.targetHasCombatMonster && damageDealt > 0) {
          updated.combatMonsterBonus = Math.min(
            p.totalHealth ?? damageCalc.targetHealthStat ?? p.maxWounds,
            (p.combatMonsterBonus ?? 0) + damageDealt
          )
        }
        // Fall damage from jumping to intercede position (applied on top of attack damage)
        if (fallDamageToApply > 0) {
          updated.currentWounds = Math.min(p.maxWounds, (updated.currentWounds || 0) + fallDamageToApply)
        }
      }

      // Stun extra action deduction: apply at claim time for all attacks
      if (npcAttackDef?.effect === 'Stun' && !turnHasGone) {
        updated.actionsRemaining = { simple: Math.max(0, (updated.actionsRemaining?.simple || p.actionsRemaining?.simple || 0) - 1) }
        updated.stunActionReducedThisRound = true
        stunActionReducedThisRound = true
      } else if (npcAttackDef?.effect === 'Stun' && turnHasGone) {
        updated.interceptPenalty = (p.interceptPenalty || 0) + 1
        updated.stunActionReducedThisRound = true
        stunActionReducedThisRound = true
      }

      // Effects on activeEffects: only apply immediately for single-target intercede
      if (!isAreaAttack && damageCalc.effectData) {
        updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], damageCalc.effectData, houseRules)
        appliedEffectName = damageCalc.attackDef?.effect ?? null
        if (damageCalc.secondaryEffectData) {
          updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.secondaryEffectData, houseRules)
        }
      }

      return updated
    }
    // Dodge penalty on target: deferred for area attacks (resolveAreaIntercedeGroup handles it)
    if (!isAreaAttack && p.id === effectiveTargetId) {
      return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
    }
    // Throw-claim: apply fall damage to the rescued ally landing outside the AoE
    if (isAreaAttack && p.id === effectiveTargetId && throwAllyFallDamage > 0) {
      return { ...p, currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + throwAllyFallDamage) }
    }
    return p
  })

  let claimNextTurnIndex: number | undefined
  let claimNextRound: number | undefined

  if (isAreaAttack) {
    const newClaim: AreaAttackClaim = {
      interceptorParticipantId: body.interceptorParticipantId,
      targetId: effectiveTargetId,
      interceptorName,
      targetName: effectiveTargetName,
      damageDealt,
      appliedEffectName: damageCalc.appliedEffectName,
      effectData: damageCalc.effectData ?? null,
      stunActionReducedThisRound,
      interceptorArmor,
      armorPiercing,
      effectiveArmor,
      attackBaseDamage,
      netSuccesses,
      isSupportAttack: false,
      interceptorHasCombatMonster: damageCalc.targetHasCombatMonster,
      interceptorHealthStat: damageCalc.targetHealthStat,
    }

    // Strip claimed target and claiming interceptor from ALL group offers; remove empty ones
    pendingRequests = stripClaimantFromGroupOffers(
      pendingRequests,
      intercedeGroupId,
      body.interceptorParticipantId,
      effectiveTargetId,
      participants,
      digimonById
    )

    // Record claim in intercede-group-state
    const groupState = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    if (groupState) {
      groupState.data.claims = [...(groupState.data.claims || []), newClaim]
    }

    // Resolve when all targets have a decision
    if (groupState && allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) {
      const resolved = await resolveAreaIntercedeGroup({
        groupState,
        participants,
        battleLog,
        pendingRequests,
        turnOrder,
        round: encounter.round || 0,
        currentTurnIndex: encounter.currentTurnIndex || 0,
        houseRules,
        encounterId: encounterId!,
      })
      participants = resolved.participants
      battleLog = resolved.battleLog
      pendingRequests = resolved.pendingRequests
      turnOrder = resolved.turnOrder
      if (resolved.nextTurnIndex !== undefined) claimNextTurnIndex = resolved.nextTurnIndex
      if (resolved.nextRound !== undefined) claimNextRound = resolved.nextRound
    }
  } else {
    // Remove all intercede-offer requests for this group
    pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

    // Auto-devolve check: if interceptor is KO'd and has evolution history, devolve instead
    let autoDevolveLog: any = null
    const damagedInterceptor = participants.find((p: any) => p.id === body.interceptorParticipantId)
    if (damagedInterceptor &&
        damagedInterceptor.currentWounds >= damagedInterceptor.maxWounds &&
        damagedInterceptor.evolutionLineId &&
        damagedInterceptor.woundsHistory?.length > 0) {
      const previousState = damagedInterceptor.woundsHistory.pop()
      if (previousState) {
        const oldEntityId = damagedInterceptor.entityId
        damagedInterceptor.entityId = previousState.entityId
        damagedInterceptor.maxWounds = previousState.maxWounds
        damagedInterceptor.currentWounds = previousState.wounds !== undefined ? previousState.wounds : 0

        await db.update(evolutionLines).set({
          currentStageIndex: previousState.stageIndex,
          updatedAt: new Date(),
        }).where(eq(evolutionLines.id, damagedInterceptor.evolutionLineId))

        const [oldDigimon] = await db.select().from(digimon).where(eq(digimon.id, oldEntityId))
        const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))

        const devolvedQualities = newDigimon?.qualities || []
        const devolvedHasCombatMonster = (devolvedQualities as any[]).some((q: any) => q.id === 'combat-monster')
        damagedInterceptor.combatMonsterBonus = devolvedHasCombatMonster
          ? Math.min(damagedInterceptor.combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
          : 0

        autoDevolveLog = {
          id: `log-${Date.now()}-autodevolve`,
          timestamp: new Date().toISOString(),
          round: encounter.round || 0,
          actorId: damagedInterceptor.id,
          actorName: oldDigimon?.name || 'Digimon',
          action: `was knocked out and devolved to ${newDigimon?.name || 'previous form'}!`,
          target: null,
          result: `Wounds restored to ${previousState.wounds !== undefined ? previousState.wounds : 0}`,
          damage: null,
          effects: ['Auto-Devolve'],
        }
      }
    }

    const fallEffectsDmg = fallDamageToApply > 0
      ? [`Fell ${request.data.fallHeight} tiles (${fallDamageToApply} wound${fallDamageToApply !== 1 ? 's' : ''})`]
      : []
    const intercedeLog = {
      id: `log-${Date.now()}-intercede`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.interceptorParticipantId,
      actorName: interceptorName,
      action: `Interceded for ${effectiveTargetName}!`,
      target: null,
      result: 'Takes hit with 0 dodge',
      damage: damageDealt + fallDamageToApply,
      effects: [...(appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede']), ...fallEffectsDmg],
      attackerParticipantId: request.data.attackerId,
      baseDamage: attackBaseDamage,
      netSuccesses,
      targetArmor: interceptorArmor,
      armorPiercing,
      effectiveArmor,
      finalDamage: damageDealt + fallDamageToApply,
      hit: true,
      dodgeDicePool: 0,
      dodgeDiceResults: [],
      dodgeSuccesses: 0,
    }
    battleLog = [...battleLog, intercedeLog, ...(autoDevolveLog ? [autoDevolveLog] : [])]
  }

  await db.update(encounters).set({
    participants,
    pendingRequests,
    battleLog,
    turnOrder,
    ...(claimNextTurnIndex !== undefined ? { currentTurnIndex: claimNextTurnIndex } : {}),
    ...(claimNextRound !== undefined ? { round: claimNextRound } : {}),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  if (updatedParticipantPositions) {
    await broadcastPositionPatch(encounterId, updatedParticipantPositions)
  }

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  const room = await getRoomSnapshot(encounterId)
  return { ...updated, participantPositions: room.participantPositions, destructibleStates: room.destructibleStates }
})
