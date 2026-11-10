import { eq } from 'drizzle-orm'
import { db, maps } from '../db'
import type { Vec3 } from '../../types'
import { getRoomSnapshot } from './encounterRoom'
import { getMovementProfile, loadEncounterMap, loadParticipantDigimon, loadTamersByIds } from './combatSpatial'
import { canActOnEncounterTurn } from './participantTurn'
import { getMovementReachability, getFootprintDimensions, getFootprintCells, buildFootprintOccupiedSet, isFootprintValid } from './mapMovement'
import { canLandOn, canPassThrough, createJumpTraversal, createMovementMapView, getMovementCostProfile } from '../../utils/movementRules'
import { closedDoorsCrossedByPath } from '../../utils/mapDoors'
import { makeSpawnCellChecker, isSetupPhase } from '../../utils/placementRules'
import { voxelBlocksMovement } from '../../utils/mapVoxels'
import { getNaturewalkEnvironmentSettings } from '../../utils/naturewalk'
import { applyNaturewalkEnvironment } from './naturewalk'
import { applyMovementBurn, loadCampaignDamageOverTimeRules } from './damageOverTime'
import { combatTurnKey } from '../../utils/specialOrderCombat'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { scopedDatabase } from './databaseScope'

export interface MovementIntent {
  participantId: string
  kind: 'normal' | 'placement' | 'gm' | 'charge-before' | 'pass' | 'charge-after'
  destination: Vec3
  origin?: Vec3
  path?: Vec3[]
  operationId: string
  expectedRevision?: number
  allowanceId?: string
}
const key = (p: Vec3) => `${p.x},${p.y},${p.z}`
const same = (a: Vec3 | undefined, b: Vec3 | undefined) => !!a && !!b && key(a) === key(b)
export function validMapCell(value: any): value is Vec3 {
  return !!value && ['x', 'y', 'z'].every(axis => Number.isSafeInteger(value[axis]))
}
export function movementFingerprint(intent: MovementIntent): string {
  return JSON.stringify([intent.kind, intent.participantId, intent.destination, intent.path ?? null, intent.allowanceId ?? null])
}

/** Validate from stored state and prepare one write; this function never persists or broadcasts. */
export async function prepareEncounterMovement(encounter: any, intent: MovementIntent,
  options: { isDm: boolean; noActionCost?: boolean; attack?: any } = { isDm: false }) {
  if (!intent.operationId || typeof intent.operationId !== 'string' || intent.operationId.length > 128 || !validMapCell(intent.destination)) {
    throw createError({ statusCode: 400, message: 'A movement operation ID and integer destination are required' })
  }
  if (!['normal', 'placement', 'gm', 'charge-before', 'pass', 'charge-after'].includes(intent.kind)) throw createError({ statusCode: 400, message: 'Unknown movement kind' })
  if (intent.expectedRevision !== undefined && intent.expectedRevision !== encounter.revision) throw createError({ statusCode: 409, message: 'The encounter changed; refresh and try again' })
  const actor = encounter.participants?.find((p: any) => p.id === intent.participantId)
  if (!actor || actor.inReserve) throw createError({ statusCode: 400, message: 'The participant is not deployed' })
  if (intent.kind === 'gm' && !options.isDm) throw createError({ statusCode: 403, message: 'GM movement requires GM access' })
  if ((intent.kind === 'charge-before' || intent.kind === 'pass') && !options.attack) throw createError({ statusCode: 403, message: 'Attack movement is committed with its attack' })
  if (scopedDatabase() && encounter.mapId) await db.select({ id: maps.id }).from(maps).where(eq(maps.id, encounter.mapId)).for('update')
  const map = await loadEncounterMap(encounter.mapId)
  if (!map) throw createError({ statusCode: 400, message: 'The encounter has no map' })
  const room = await getRoomSnapshot(encounter.id)
  const positions = { ...room.participantPositions }
  const origin = positions[actor.id]
  if (intent.origin && !same(intent.origin, origin)) throw createError({ statusCode: 409, message: 'The participant moved; refresh and try again' })
  const placement = intent.kind === 'placement'
  if (placement && !isSetupPhase(encounter.phase) && origin) throw createError({ statusCode: 403, message: 'Placed characters use combat movement' })
  if (!placement && intent.kind !== 'gm' && (!origin || encounter.phase !== 'combat')) throw createError({ statusCode: 400, message: 'Combat movement requires a placed character during combat' })
  const records = await loadParticipantDigimon(encounter.participants)
  const tamers = await loadTamersByIds(encounter.participants.filter((p: any) => p.type === 'tamer').map((p: any) => p.entityId))
  const record = records.get(actor.entityId)
  const dims = getFootprintDimensions(record?.size ?? 'medium', record?.giganticDimensions)
  const destroyed = new Set<string>((room.destructibleStates ?? []).filter((s: any) => s.currentWounds <= 0).map((s: any) => s.structureId))
  const excluded = new Set<string>([actor.id])
  const occupied = buildFootprintOccupiedSet(positions, encounter.participants, records, excluded, actor)
  const blocked = buildFootprintOccupiedSet(positions, encounter.participants, records, excluded, actor, 'traversal')
  const initial = await applyNaturewalkEnvironment(encounter, encounter.participants, positions, { grantWater: true, records })
  const currentActor = initial.participants.find(p => p.id === actor.id)
  const profile = getMovementProfile(currentActor, records, tamers, getNaturewalkEnvironmentSettings(encounter.hazards))
  const footprintBlocked = (position: Vec3) => getFootprintCells(position, dims).some(cell => blocked.has(key(cell)))
  let path: Vec3[] = origin ? [origin] : []
  let openedDoorIds: string[] = []
  if (placement || intent.kind === 'gm') {
    const voxels = new Map((map.voxels ?? []).map(v => [key(v), v]))
    if (getFootprintCells(intent.destination, dims).some(cell => { const voxel = voxels.get(key(cell)); return occupied.has(key(cell)) || !!voxel && voxelBlocksMovement(voxel) })) throw createError({ statusCode: 400, message: 'The destination is occupied or blocked' })
    if (placement && !options.isDm) {
      const spawn = makeSpawnCellChecker(map.groundTiles ?? [], map.voxels ?? [])
      if (!getFootprintCells(intent.destination, { ...dims, height: 1 }).every(spawn)) throw createError({ statusCode: 403, message: 'Players must place their whole footprint on spawn cells' })
    }
    path = origin ? [origin, intent.destination] : [intent.destination]
  } else {
    if (actor.clash && !(intent.kind === 'pass' && options.attack && actor.clash.isController)) {
      const opponent = encounter.participants.find((p: any) => p.id === actor.clash.opponentParticipantId)
      const opponentPosition = opponent && positions[opponent.id]
      const opponentRecord = opponent && records.get(opponent.entityId)
      const opponentCells = opponentPosition ? getFootprintCells(opponentPosition, getFootprintDimensions(opponentRecord?.size ?? 'medium', opponentRecord?.giganticDimensions)) : []
      const contactRange = actor.clash.reachInitiated ? actor.clash.reachDistance ?? 1 : 1
      const inContact = getFootprintCells(intent.destination, dims).some(cell => opponentCells.some(other => Math.max(Math.abs(cell.x - other.x), Math.abs(cell.y - other.y), Math.abs(cell.z - other.z)) <= contactRange))
      if (intent.kind !== 'normal' || !actor.clash.isController || !inContact) throw createError({ statusCode: 403, message: 'Clash movement must keep the controller in contact with its opponent' })
    }
    if (!await canActOnEncounterTurn(actor, { participants: encounter.participants, turnOrder: encounter.turnOrder, currentTurnIndex: encounter.currentTurnIndex, actorDigimon: record ?? null }, async id => records.has(id) ? [records.get(id)!] : [])) throw createError({ statusCode: 403, message: 'It is not this character’s turn' })
    if (intent.kind === 'normal' && (actor.actionsRemaining?.simple ?? 0) < 1) throw createError({ statusCode: 400, message: 'Movement requires one Simple Action' })
    if (intent.kind === 'charge-after') {
      const allowance = actor.pendingChargeMove
      if (!allowance || intent.allowanceId !== allowance.castId || allowance.turnKey !== combatTurnKey(encounter.round, encounter.currentTurnIndex) || allowance.entityId !== actor.entityId || allowance.mapId !== encounter.mapId) throw createError({ statusCode: 409, message: 'No unused Charge movement is available' })
    }
    // Walking through a door opens it. Path validation sees doors open, while
    // actual crossed doors alone are persisted after the complete action passes.
    const traversable = createMovementMapView({ ...map, doors: (map.doors ?? []).map(d => ({ ...d, isOpen: true })) })
    const passExtra = intent.kind === 'pass' ? Math.max(0, record ? (await getDigimonDerivedStats(record.id, currentActor))?.ram ?? 0 : 0) : 0
    const budget = profile.budget + passExtra
    const caps = intent.kind === 'pass' ? {
      ...profile.caps, movementSpeed: budget,
      swimSpeed: profile.caps.canSwim ? (profile.caps.swimSpeed ?? 0) + passExtra : 0,
      digSpeed: profile.caps.canDig ? (profile.caps.digSpeed ?? 0) + passExtra : 0,
      climbSpeed: profile.caps.canClimb ? (profile.caps.climbSpeed ?? 0) + passExtra : 0,
      flySpeed: profile.caps.canFly ? (profile.caps.flySpeed ?? 0) + passExtra : 0,
    } : profile.caps
    const supplied = intent.path
    if (supplied) {
      const maximumPath = getMovementCostProfile(caps, budget, destroyed, origin)?.budget ?? budget
      if (!Array.isArray(supplied) || supplied.length > Math.max(2, maximumPath + 2) || supplied.some(p => !validMapCell(p)) || !same(supplied[0], origin) || !same(supplied[supplied.length - 1], intent.destination)) throw createError({ statusCode: 400, message: 'The movement path is invalid' })
      const costs = getMovementCostProfile(caps, budget, destroyed, origin)
      const jump = costs && caps.canJump ? createJumpTraversal(origin, caps, traversable, costs, destroyed, footprintBlocked) : null
      let state = jump?.initial ?? null, spent = 0
      for (let i = 1; i < supplied.length; i++) {
        const from = supplied[i - 1], to = supplied[i]
        if (Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)) !== 1) throw createError({ statusCode: 400, message: 'Movement paths require adjacent cells' })
        const edge = jump?.step(from, to, spent, state)
        if (jump ? !edge : footprintBlocked(to) || !canPassThrough(from, to, caps, traversable, destroyed, origin)) throw createError({ statusCode: 400, message: 'The movement path is blocked' })
        spent += edge?.cost ?? costs?.stepCost(from, to, traversable, spent) ?? 1
        if (jump) state = edge!.state
        if (!Number.isFinite(spent) || spent > (costs?.budget ?? budget)) throw createError({ statusCode: 400, message: 'The movement exceeds this character’s speed' })
      }
      if (!canLandOn(intent.destination, jump && !state ? { ...caps, canJump: false } : caps, traversable, occupied, jump ? state ?? undefined : origin, destroyed)) throw createError({ statusCode: 400, message: 'The character cannot finish movement there' })
      path = supplied
    } else {
      const reachable = getMovementReachability(origin, budget, caps, traversable, destroyed, blocked, dims)
      if (!reachable.cells.has(key(intent.destination)) || !isFootprintValid(intent.destination, dims, traversable, occupied, caps, reachable.launchOriginTo(intent.destination))) throw createError({ statusCode: 400, message: 'The destination is not reachable' })
      path = reachable.pathTo(intent.destination)!
    }
    openedDoorIds = closedDoorsCrossedByPath(map, path, dims, destroyed)
  }
  const distance = path.length > 1 ? path.length - 1 : 0
  if (!placement && !['gm', 'charge-before', 'pass'].includes(intent.kind) && distance === 0) throw createError({ statusCode: 400, message: 'Choose a different destination' })
  positions[actor.id] = intent.destination
  let participants = initial.participants.map(p => {
    if (p.id !== actor.id) return p
    const next = { ...p }
    if (intent.kind === 'normal' && !options.noActionCost) next.actionsRemaining = { ...p.actionsRemaining, simple: p.actionsRemaining.simple - 1 }
    if (intent.kind === 'charge-after') delete next.pendingChargeMove
    if (!placement && intent.kind !== 'gm') { next.lastMovedRound = encounter.round; next.lastMovedTurnKey = combatTurnKey(encounter.round, encounter.currentTurnIndex) }
    return next
  })
  participants = (await applyNaturewalkEnvironment(encounter, participants, positions, { grantWater: true, records })).participants
  const burn = !placement && intent.kind !== 'gm' ? applyMovementBurn(participants, [{ participantId: actor.id, meters: distance }], { round: encounter.round, digimonById: records, rules: await loadCampaignDamageOverTimeRules(encounter.campaignId) }) : { participants, logEntries: [] }
  participants = burn.participants
  const doors = (map.doors ?? []).map(d => openedDoorIds.includes(d.id) ? { ...d, isOpen: true } : d)
  return {
    participants, participantPositions: positions, battleLog: [...(encounter.battleLog ?? []), ...burn.logEntries],
    position: intent.destination, path, distance, mapId: encounter.mapId, doors, openedDoorIds,
    defeated: participants.find(p => p.id === actor.id)?.currentWounds >= (actor.maxWounds ?? Infinity),
    commitDoors: async (database: any = db) => {
      if (!openedDoorIds.length) return
      const [current] = await database.select().from(maps).where(eq(maps.id, encounter.mapId)).for('update')
      if (!current) throw createError({ statusCode: 409, message: 'The map was removed during movement' })
      const currentDoors = (current.doors ?? []).map((door: any) => openedDoorIds.includes(door.id) ? { ...door, isOpen: true } : door)
      await database.update(maps).set({ doors: currentDoors, updatedAt: new Date() }).where(eq(maps.id, encounter.mapId))
    },
  }
}
