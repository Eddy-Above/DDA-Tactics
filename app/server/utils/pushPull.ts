import type { Vec3, GameMap } from '../../types'
import { getRoomPositions, broadcastPositionPatch } from './encounterRoom'
import { loadEncounterMap, loadParticipantDigimon, getFallerProfile } from './combatSpatial'
import { getFootprintDimsForParticipant, buildFootprintOccupiedSet, findPushPullLandingCell } from './mapMovement'
import { resolveFall } from '../../utils/movementRules'
import { getDigimonDerivedStats, calculateEffectPotency } from './resolveSupportAttack'
import { applyGuidingLightAuras } from './guidingLight'
import { applyMovementBurn, loadEncounterRules } from './damageOverTime'
import { knockedOutEnemyIds, resolveEnemyKnockouts } from './enemyKnockouts'
import { chebyshev } from './gridDistance'
import type { EddySoulRules } from '../../types'
import { preserveEnduringSouls } from '../../utils/specialOrderCombat'

// Pure core for Knockback (push) / Pull displacement: walks the target away from / toward the
// attacker by `distance` cells (findPushPullLandingCell), settles it to the ground (resolveFall,
// flyers hover), applies any fall wounds into the RETURNED participants array, and returns the
// position patch + a battle-log note. No DB / room side effects — used by resolveNpcAttack, which
// merges the patch into its own returned positionPatch. With `burn` (combat), the displacement
// counts as the target moving: it stamps lastMovedRound and a burned target takes Burn's movement
// damage for the cells it was moved (measured before any fall).
export async function computePushPull(args: {
  map: GameMap
  positions: Record<string, Vec3>
  participants: any[]
  digimonById: Map<string, any>
  attackerParticipantId: string
  targetParticipantId: string
  effect: 'Knockback' | 'Pull'
  distance: number
  burn?: { round: number; rules?: Pick<EddySoulRules, 'burnPerTwoSpacesMoved'> }
}): Promise<{ participants: any[]; patch: Record<string, Vec3> | null; logNote: string | null }> {
  const { map, positions, digimonById, attackerParticipantId, targetParticipantId, effect, distance } = args
  let participants = args.participants

  const targetPos = positions[targetParticipantId]
  const attackerPos = positions[attackerParticipantId]
  if (!targetPos || !attackerPos || distance <= 0) return { participants, patch: null, logNote: null }

  const targetPart = participants.find((p: any) => p.id === targetParticipantId)
  if (targetPart?.type === 'digimon' && digimonById.get(targetPart.entityId)?.qualities?.some((quality: any) => quality.id === 'immunity')) {
    return { participants, patch: null, logNote: `${effect}: no effect (Immunity)` }
  }
  const attackerPart = participants.find((p: any) => p.id === attackerParticipantId)
  const targetDims = getFootprintDimsForParticipant(targetPart, digimonById)
  const attackerDims = getFootprintDimsForParticipant(attackerPart, digimonById)
  const occupiedSet = buildFootprintOccupiedSet(positions, participants, digimonById, new Set([targetParticipantId]), targetPart)
  const blockedPositions = buildFootprintOccupiedSet(positions, participants, digimonById, new Set([targetParticipantId]), targetPart, 'traversal')

  const landingCell = findPushPullLandingCell(
    targetPos,
    attackerPos,
    effect === 'Knockback' ? 'push' : 'pull',
    distance,
    targetDims,
    attackerDims,
    map,
    occupiedSet,
    new Set(),
    blockedPositions,
  )
  if (!landingCell) return { participants, patch: null, logNote: null }

  // Flyers hover at the pushed cell; everyone else settles to the ground and may take fall damage.
  const targetProfile = await getFallerProfile(targetPart, digimonById)
  const { landingPos, damage } = resolveFall(landingCell, targetDims, map, targetProfile)
  if (damage > 0) {
    participants = participants.map((p: any) =>
      p.id === targetParticipantId
        ? { ...p, currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + damage) }
        : p,
    )
  }

  participants = preserveEnduringSouls(participants, args.participants)
  let burnDamage = 0
  if (args.burn) {
    const moved = applyMovementBurn(participants, [{ participantId: targetParticipantId, meters: chebyshev(targetPos, landingCell) }], {
      round: args.burn.round, digimonById, rules: args.burn.rules,
    })
    participants = moved.participants
    burnDamage = moved.damageById[targetParticipantId] ?? 0
  }

  const fallNote = damage > 0 ? ` + ${damage} fall damage` : ''
  const burnNote = burnDamage > 0 ? ` + ${burnDamage} Burn damage` : ''
  const logNote = `${effect}: displaced ${distance} cell(s)${fallNote}${burnNote}`
  return { participants, patch: { [targetParticipantId]: landingPos }, logNote }
}

// Room wrapper: loads the map, room positions and digimon records, runs computePushPull, and
// applies + broadcasts the position patch. Used by the persistence-path callers (responses.post,
// and the support-attack 'instant' branches in intercede-offer/intercede-skip).
export async function applyPushPullDisplacement(args: {
  encounterId: string
  mapId: string | null | undefined
  participants: any[]
  attackerParticipantId: string
  targetParticipantId: string
  effect: 'Knockback' | 'Pull'
  distance: number
  campaignLevel?: 'standard' | 'enhanced' | 'extreme'
  houseRules?: { stunMaxDuration1?: boolean }
}): Promise<{ participants: any[]; logNote: string | null }> {
  const { encounterId, mapId } = args
  if (!mapId) return { participants: args.participants, logNote: null }
  const map = await loadEncounterMap(mapId)
  if (!map) return { participants: args.participants, logNote: null }

  const positions = await getRoomPositions(encounterId)
  const digimonById = await loadParticipantDigimon(args.participants)
  const { round, rules } = await loadEncounterRules(encounterId)

  let { participants, patch, logNote } = await computePushPull({
    map,
    positions,
    digimonById,
    participants: args.participants,
    attackerParticipantId: args.attackerParticipantId,
    targetParticipantId: args.targetParticipantId,
    effect: args.effect,
    distance: args.distance,
    burn: { round, rules },
  })

  if (patch) {
    await broadcastPositionPatch(encounterId, patch)
    // [Guiding Light]: Knockback/Pull can move a unit across an aura's burst radius. Fold the
    // recompute into the returned `participants` — the caller still has to persist it, so a
    // standalone recompute here would race that later write.
    const auraResult = await applyGuidingLightAuras(participants, { ...positions, ...patch }, args.campaignLevel ?? 'standard', args.houseRules)
    if (auraResult.changed) participants = auraResult.participants
  }
  return { participants, logNote }
}

// Resolves an `'instant'` support effect (Knockback / Pull) — the support-attack branches in
// intercede-offer / intercede-skip previously only handled positive/negative and silently dropped
// these. Computes the displacement distance (attacker CPU + Stage Bonus) and pushes the target,
// returning the standard support-resolver shape ({ participants, battleLog, pendingRequests,
// turnOrder }). Other instant effects (Lifesteal) are damage-only → no-op here.
export async function resolveInstantSupportEffect(params: {
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  attackerParticipantId: string
  targetParticipantId: string
  attackDef: any
  round: number
  attackerName: string
  targetName: string
  encounterId: string
  mapId: string | null | undefined
  turnOrder?: string[]
  /** The active slot, for when Burn on the displacement knocks out an enemy target */
  currentTurnIndex?: number
  campaignLevel?: 'standard' | 'enhanced' | 'extreme'
  houseRules?: { stunMaxDuration1?: boolean }
  distance?: number
  /** Resolve against a caller's current, possibly uncommitted board without broadcasting. */
  spatial?: { map: GameMap; positions: Record<string, Vec3>; digimonById: Map<string, any> }
  deferPositionBroadcast?: boolean
}): Promise<{
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  turnOrder?: string[]
  /** Set when a knocked-out target's removal moved the turn index / wrapped the round */
  nextTurnIndex?: number
  nextRound?: number
  positionPatch?: Record<string, Vec3>
  resolved: boolean
}> {
  const effect = params.attackDef?.effect
  if (effect !== 'Knockback' && effect !== 'Pull') {
    return { participants: params.participants, battleLog: params.battleLog, pendingRequests: params.pendingRequests, turnOrder: params.turnOrder, resolved: false }
  }

  const attackerPart = params.participants.find((p: any) => p.id === params.attackerParticipantId)
  const atkDerived = params.distance === undefined && attackerPart?.type === 'digimon' ? await getDigimonDerivedStats(attackerPart.entityId) : null
  const potency = params.distance ?? calculateEffectPotency(effect, atkDerived, null).potency

  let participants = params.participants
  let logNote: string | null = null
  let positionPatch: Record<string, Vec3> | undefined
  if (params.deferPositionBroadcast) {
    if (params.spatial) {
      const { rules } = await loadEncounterRules(params.encounterId)
      const moved = await computePushPull({ ...params.spatial, participants,
        attackerParticipantId: params.attackerParticipantId, targetParticipantId: params.targetParticipantId,
        effect, distance: potency, burn: { round: params.round, rules } })
      participants = moved.participants
      logNote = moved.logNote
      positionPatch = moved.patch ?? undefined
    }
  } else {
    const moved = await applyPushPullDisplacement({
      encounterId: params.encounterId,
      mapId: params.mapId,
      participants: params.participants,
      attackerParticipantId: params.attackerParticipantId,
      targetParticipantId: params.targetParticipantId,
      effect,
      distance: potency,
      campaignLevel: params.campaignLevel,
      houseRules: params.houseRules,
    })
    participants = moved.participants
    logNote = moved.logNote
  }

  const battleLog = [...params.battleLog, {
    id: `log-${Date.now()}-${effect.toLowerCase()}-${params.targetParticipantId}`,
    timestamp: new Date().toISOString(),
    round: params.round,
    actorId: params.attackerParticipantId,
    actorName: params.attackerName,
    action: effect,
    target: params.targetName,
    result: logNote ?? `${effect}: no room to displace`,
    damage: null,
    effects: [`Applied: ${effect}`, ...(logNote ? [logNote] : [])],
  }]

  // Burn on the displacement can knock out an enemy target: it leaves the encounter
  const currentTurnIndex = params.currentTurnIndex ?? 0
  const knockout = knockedOutEnemyIds(params.participants).includes(params.targetParticipantId)
    ? null
    : await resolveEnemyKnockouts(
        { participants, turnOrder: params.turnOrder ?? [], currentTurnIndex, round: params.round },
        [params.targetParticipantId],
        { encounterId: params.encounterId, houseRules: params.houseRules, mapId: params.mapId, campaignLevel: params.campaignLevel,
          gravity: params.deferPositionBroadcast ? (params.spatial ? { map: params.spatial.map, positions: { ...params.spatial.positions, ...positionPatch } } : undefined) : 'room' },
      )
  if (knockout?.positionPatch) positionPatch = { ...positionPatch, ...knockout.positionPatch }
  if (!knockout?.changed) {
    return { participants, battleLog, pendingRequests: params.pendingRequests, turnOrder: params.turnOrder, positionPatch, resolved: true }
  }

  return {
    participants: knockout.participants,
    battleLog: [...battleLog, ...knockout.logEntries],
    pendingRequests: params.pendingRequests,
    turnOrder: params.turnOrder ? knockout.turnOrder : undefined,
    ...(knockout.turnAdvanced || knockout.currentTurnIndex !== currentTurnIndex ? { nextTurnIndex: knockout.currentTurnIndex } : {}),
    ...(knockout.round !== params.round ? { nextRound: knockout.round } : {}),
    positionPatch,
    resolved: true,
  }
}
