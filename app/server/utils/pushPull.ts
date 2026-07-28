import type { Vec3, GameMap } from '../types'
import { getRoomPositions, broadcastPositionPatch } from './encounterRoom'
import { loadEncounterMap, loadParticipantDigimon, getFallerProfile } from './combatSpatial'
import { getFootprintDimsForParticipant, buildFootprintOccupiedSet, findPushPullLandingCell } from './mapMovement'
import { resolveFall } from '../../utils/movementRules'
import { getDigimonDerivedStats, calculateEffectPotency } from './resolveSupportAttack'

// Pure core for Knockback (push) / Pull displacement: walks the target away from / toward the
// attacker by `distance` cells (findPushPullLandingCell), settles it to the ground (resolveFall,
// flyers hover), applies any fall wounds into the RETURNED participants array, and returns the
// position patch + a battle-log note. No DB / room side effects — used by resolveNpcAttack, which
// merges the patch into its own returned positionPatch.
export async function computePushPull(args: {
  map: GameMap
  positions: Record<string, Vec3>
  participants: any[]
  digimonById: Map<string, any>
  attackerParticipantId: string
  targetParticipantId: string
  effect: 'Knockback' | 'Pull'
  distance: number
}): Promise<{ participants: any[]; patch: Record<string, Vec3> | null; logNote: string | null }> {
  const { map, positions, digimonById, attackerParticipantId, targetParticipantId, effect, distance } = args
  let participants = args.participants

  const targetPos = positions[targetParticipantId]
  const attackerPos = positions[attackerParticipantId]
  if (!targetPos || !attackerPos || distance <= 0) return { participants, patch: null, logNote: null }

  const targetPart = participants.find((p: any) => p.id === targetParticipantId)
  const attackerPart = participants.find((p: any) => p.id === attackerParticipantId)
  const targetDims = getFootprintDimsForParticipant(targetPart, digimonById)
  const attackerDims = getFootprintDimsForParticipant(attackerPart, digimonById)
  const occupiedSet = buildFootprintOccupiedSet(positions, participants, digimonById, new Set([targetParticipantId]))

  const landingCell = findPushPullLandingCell(
    targetPos,
    attackerPos,
    effect === 'Knockback' ? 'push' : 'pull',
    distance,
    targetDims,
    attackerDims,
    map,
    occupiedSet,
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

  const fallNote = damage > 0 ? ` + ${damage} fall damage` : ''
  const logNote = `${effect}: displaced ${distance} cell(s)${fallNote}`
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
}): Promise<{ participants: any[]; logNote: string | null }> {
  const { encounterId, mapId } = args
  if (!mapId) return { participants: args.participants, logNote: null }
  const map = await loadEncounterMap(mapId)
  if (!map) return { participants: args.participants, logNote: null }

  const positions = await getRoomPositions(encounterId)
  const digimonById = await loadParticipantDigimon(args.participants)

  const { participants, patch, logNote } = await computePushPull({
    map,
    positions,
    digimonById,
    participants: args.participants,
    attackerParticipantId: args.attackerParticipantId,
    targetParticipantId: args.targetParticipantId,
    effect: args.effect,
    distance: args.distance,
  })

  if (patch) await broadcastPositionPatch(encounterId, patch)
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
}): Promise<{ participants: any[]; battleLog: any[]; pendingRequests: any[]; turnOrder?: string[]; resolved: boolean }> {
  const effect = params.attackDef?.effect
  if (effect !== 'Knockback' && effect !== 'Pull') {
    return { participants: params.participants, battleLog: params.battleLog, pendingRequests: params.pendingRequests, turnOrder: params.turnOrder, resolved: false }
  }

  const attackerPart = params.participants.find((p: any) => p.id === params.attackerParticipantId)
  const atkDerived = attackerPart?.type === 'digimon' ? await getDigimonDerivedStats(attackerPart.entityId) : null
  const { potency } = calculateEffectPotency(effect, atkDerived, null)

  const { participants, logNote } = await applyPushPullDisplacement({
    encounterId: params.encounterId,
    mapId: params.mapId,
    participants: params.participants,
    attackerParticipantId: params.attackerParticipantId,
    targetParticipantId: params.targetParticipantId,
    effect,
    distance: potency,
  })

  const battleLog = [...params.battleLog, {
    id: `log-${Date.now()}-${effect.toLowerCase()}`,
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

  return { participants, battleLog, pendingRequests: params.pendingRequests, turnOrder: params.turnOrder, resolved: true }
}
