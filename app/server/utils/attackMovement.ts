import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import type { CampaignAccess } from './campaignSecurity'
import { prepareEncounterMovement } from './encounterMovement'
import { getRoomPositions, getRoomSnapshot, getDestroyedStructureIds, publishCommittedPositions, broadcast } from './encounterRoom'
import { getMovementProfile, loadParticipantDigimon, loadTamersByIds, loadEncounterMap } from './combatSpatial'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { getCellsOnLine } from './mapMovement'
import { getFootprintDimensions, canLandOn, getFootprintCells } from '../../utils/movementRules'
import { computeAreaCellsFromData, computePassLanding, getAreaShape } from '../../utils/areaShapes'
import { combatTurnKey } from '../../utils/specialOrderCombat'
import { getNaturewalkEnvironmentSettings } from '../../utils/naturewalk'
import { allowFields, finiteNumber, validPosition } from './securityValidation'
import { attackActionCost, effectActionError } from '../../utils/combatAttackOptions'
import { buildLosIndex, losClear, canSeeFootprint } from '../../utils/lineOfSight'
import { getNaturewalkElements } from '../../utils/naturewalk'
import { resolveEnemyKnockouts } from './enemyKnockouts'

const CANONICAL_AREA = Symbol.for('dda.server.canonicalArea')

export interface AttackMovementRequest {
  operationId?: string
  expectedRevision?: number
  chargeTiming?: 'before' | 'after'
  movement?: { kind: 'charge-before' | 'pass'; origin: any; destination: any; path?: any[]; direction?: any; movement?: number; ram?: number }
  areaShapeData?: any
}
const same = (a: any, b: any) => a && b && a.x === b.x && a.y === b.y && a.z === b.z
export function isChargeAttack(attack: any) { return (attack?.tags ?? []).some((tag: string) => tag.toLowerCase() === 'charge attack') }

/** All changes are inside the caller's database/room scope and disappear on rejection. */
export async function commitAttackMovement(encounter: any, actorId: string, attack: any, body: AttackMovementRequest, access: CampaignAccess | null) {
  const pass = getAreaShape(attack?.tags ?? []) === 'pass'
  if (body.chargeTiming !== undefined && (!['before', 'after'].includes(body.chargeTiming) || !isChargeAttack(attack) || pass)) throw createError({ statusCode: 400, message: 'Charge timing requires a non-Pass Charge attack' })
  if (!body.movement) {
    if (body.chargeTiming === 'before' || pass && encounter.mapId) throw createError({ statusCode: 400, message: 'Confirm the attack movement preview first' })
    return { defeated: false }
  }
  const move = allowFields(body.movement, ['kind', 'origin', 'destination', 'path', 'direction', 'movement', 'ram'])
  if (move.kind !== (pass ? 'pass' : 'charge-before') || !pass && (!isChargeAttack(attack) || body.chargeTiming !== 'before')) throw createError({ statusCode: 400, message: 'This attack does not grant that movement' })
  if (!body.operationId || body.expectedRevision === undefined) throw createError({ statusCode: 400, message: 'Attack movement requires an operation ID and encounter revision' })
  const origin = validPosition(move.origin), destination = validPosition(move.destination)
  const actor = encounter.participants.find((p: any) => p.id === actorId)
  const positions = await getRoomPositions(encounter.id)
  if (!actor || !same(origin, positions[actorId])) throw createError({ statusCode: 409, message: 'The attack origin changed; review the preview' })
  const optionError = effectActionError(attack, body as any)
  if (optionError) throw createError({ statusCode: 400, message: optionError })
  const actionCost = Math.max(actor.clash ? 2 : 1, attackActionCost(actor, attack, access?.campaign.rulesSettings?.eddySoulRules, body as any))
  if ((actor.actionsRemaining?.simple ?? 0) < actionCost) throw createError({ statusCode: 403, message: 'Not enough actions for the declared attack' })
  let path = move.path
  if (pass) {
    const records = await loadParticipantDigimon(encounter.participants)
    const tamers = await loadTamersByIds(encounter.participants.filter((p: any) => p.type === 'tamer').map((p: any) => p.entityId))
    const profile = getMovementProfile(actor, records, tamers, getNaturewalkEnvironmentSettings(encounter.hazards))
    const derived = (actor.type === 'digimon' ? await getDigimonDerivedStats(actor.entityId, actor) : null) ?? { ram: 0, bit: 1 }
    const direction = move.direction ?? body.areaShapeData?.dir
    allowFields(direction, ['x', 'y', 'z'])
    for (const axis of ['x', 'y', 'z']) finiteNumber(direction[axis], `direction.${axis}`)
    if (Math.hypot(direction.x, direction.y, direction.z) < 1e-9) throw createError({ statusCode: 400, message: 'Choose a Pass direction' })
    const length = finiteNumber(move.movement ?? body.areaShapeData?.movement, 'Pass length', { min: 0, max: profile.budget })
    const extra = finiteNumber(move.ram ?? body.areaShapeData?.ram ?? 0, 'Pass extra movement', { min: 0, max: Math.max(0, derived.ram ?? 0) })
    const expected = computePassLanding(origin, direction, length, extra)
    if (!same(destination, expected)) throw createError({ statusCode: 400, message: 'The Pass endpoint does not match its allowed movement' })
    const map = await loadEncounterMap(encounter.mapId)
    if (!map || !canLandOn(destination, profile.caps, map, new Set(), origin)) throw createError({ statusCode: 400, message: 'The attacker cannot land at the Pass endpoint' })
    path = same(origin, destination) ? [origin] : [origin, ...getCellsOnLine(origin, destination), destination]
    body.areaShapeData = { shape: 'pass', rangeType: attack.range, attackerPos: origin, dir: direction, bit: derived.bit ?? 1,
      movement: length, ram: extra, attackerDims: getFootprintDimensions(records.get(actor.entityId)?.size ?? 'medium', records.get(actor.entityId)?.giganticDimensions) }
    Object.defineProperty(body.areaShapeData, CANONICAL_AREA, { value: true })
  }
  const result = await prepareEncounterMovement(encounter, { participantId: actorId, kind: move.kind as 'pass' | 'charge-before',
    origin, destination, path, operationId: body.operationId, expectedRevision: body.expectedRevision,
  }, { isDm: !!access?.isDm, attack, noActionCost: true })
  let turnState = { turnOrder: encounter.turnOrder, currentTurnIndex: encounter.currentTurnIndex, round: encounter.round }
  const patch = { [actorId]: destination }
  if (result.defeated) {
    result.participants = result.participants.map((p: any) => p.id === actorId
      ? { ...p, actionsRemaining: { ...p.actionsRemaining, simple: p.actionsRemaining.simple - actionCost } } : p)
    const map = await loadEncounterMap(encounter.mapId)
    const knockout = await resolveEnemyKnockouts({ participants: result.participants, ...turnState }, [actorId],
      map ? { encounterId: encounter.id, gravity: { map, positions: result.participantPositions } } : { encounterId: encounter.id })
    result.participants = knockout.participants
    result.battleLog = [...result.battleLog, ...knockout.logEntries]
    turnState = { turnOrder: knockout.turnOrder, currentTurnIndex: knockout.currentTurnIndex, round: knockout.round }
    Object.assign(result.participantPositions, knockout.positionPatch ?? {})
    Object.assign(patch, knockout.positionPatch ?? {})
    result.position = result.participantPositions[actorId] ?? destination
    if (pass && actor.clash?.isController) {
      const opponentId = actor.clash.opponentParticipantId
      result.participants = result.participants.map((participant: any) => {
        if (participant.id !== actorId && participant.id !== opponentId) return participant
        const { clash: _ended, ...remaining } = participant
        return { ...remaining, clashCooldownUntilRound: turnState.round + 1 }
      })
    }
  }
  await result.commitDoors(db)
  await db.update(encounters).set({ participants: result.participants, battleLog: result.battleLog, ...turnState,
    participantPositions: result.participantPositions, updatedAt: new Date(),
  }).where(eq(encounters.id, encounter.id))
  await publishCommittedPositions(encounter.id, patch)
  if (result.openedDoorIds.length) broadcast(encounter.id, { type: 'map-edited', encounterId: encounter.id })
  return { ...result, ...turnState }
}

export async function grantChargeAfter(encounterId: string, actorId: string, attack: any, timing: unknown,
  originalEncounter: { mapId: string | null; phase: string; round: number; currentTurnIndex: number; participants: Array<{ id: string; entityId: string; inReserve?: boolean }> }) {
  if (timing !== 'after') return
  if (!isChargeAttack(attack) || getAreaShape(attack.tags ?? []) === 'pass') throw createError({ statusCode: 400, message: 'This attack does not grant Charge movement' })
  const originalActor = originalEncounter.participants.find(participant => participant.id === actorId)
  if (!originalActor || originalActor.inReserve || originalEncounter.phase !== 'combat' || !originalEncounter.mapId) return
  const originalTurnKey = combatTurnKey(originalEncounter.round, originalEncounter.currentTurnIndex)
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  const actor = encounter?.participants.find(participant => participant.id === actorId)
  if (!encounter?.mapId || encounter.phase !== 'combat' || encounter.mapId !== originalEncounter.mapId
    || combatTurnKey(encounter.round, encounter.currentTurnIndex) !== originalTurnKey
    || !actor || actor.inReserve || actor.entityId !== originalActor.entityId || !((actor.currentWounds ?? 0) < (actor.maxWounds ?? 0))) return
  const participants = encounter.participants.map((p: any) => p.id === actorId ? { ...p,
    pendingChargeMove: { castId: randomUUID(), turnKey: originalTurnKey, entityId: originalActor.entityId, mapId: originalEncounter.mapId!, attackId: attack.id },
  } : p)
  await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, encounterId))
}

export async function finishPassClash(encounterId: string, actorId: string, attack: any) {
  if (getAreaShape(attack?.tags ?? []) !== 'pass') return
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  const actor = encounter?.participants.find((p: any) => p.id === actorId)
  if (!actor?.clash?.isController) return
  const opponentId = actor.clash.opponentParticipantId
  const participants = encounter.participants.map((p: any) => {
    if (p.id !== actorId && p.id !== opponentId) return p
    const { clash, ...rest } = p
    return { ...rest, clashCooldownUntilRound: encounter.round + 1 }
  })
  await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, encounterId))
}

/** Target identities must be current encounter actors, never arbitrary linked records. */
export function validateAttackTargets(encounter: any, body: any) {
  const ids = body.targetIds ?? (body.targetId ? [body.targetId] : [])
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > encounter.participants.length || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !encounter.participants.some((p: any) => p.id === id && !p.inReserve))) throw createError({ statusCode: 400, message: 'Attack targets must be deployed participants in this encounter' })
}

/** Rebuild geometry from the stored attack/specs; the browser supplies aim only. */
export async function canonicalizeAreaAttack(encounter: any, actor: any, attack: any, body: any, records: Map<string, any>) {
  const shape = getAreaShape(attack?.tags ?? [])
  if (!shape && (body.targetIds?.length ?? 0) > 1) throw createError({ statusCode: 400, message: 'This attack cannot affect multiple targets' })
  if (!encounter.mapId) { body.areaShapeData = null; return }
  const map = await loadEncounterMap(encounter.mapId)
  const snapshot = await getRoomSnapshot(encounter.id)
  const index = map ? buildLosIndex(map, getDestroyedStructureIds(snapshot.destructibleStates), { canSeeDarkness: getNaturewalkElements(records.get(actor.entityId)?.qualities).includes('darkness') }) : null
  if (!shape) {
    body.areaShapeData = null
    if (actor.type !== 'digimon') return
    const positions = await getRoomPositions(encounter.id), origin = positions[actor.id]
    const targetId = body.targetId ?? body.targetIds?.[0]
    const target = encounter.participants.find((p: any) => p.id === targetId), destination = positions[targetId]
    if (!origin || !destination) throw createError({ statusCode: 400, message: 'Place both characters before attacking' })
    const record = records.get(actor.entityId), targetRecord = records.get(target.entityId)
    const dims = getFootprintDimensions(record?.size ?? 'medium', record?.giganticDimensions)
    const targetDims = getFootprintDimensions(targetRecord?.size ?? 'medium', targetRecord?.giganticDimensions)
    const derived = await getDigimonDerivedStats(actor.entityId, actor)
    const reach = record?.qualities?.find((q: any) => q.id === 'reach')?.ranks ?? 0
    const dist = attack.range === 'melee' ? Math.max(
      Math.max(0, destination.x - (origin.x + dims.width - 1), origin.x - (destination.x + targetDims.width - 1)),
      Math.max(0, destination.y - (origin.y + dims.height - 1), origin.y - (destination.y + targetDims.height - 1)),
      Math.max(0, destination.z - (origin.z + dims.depth - 1), origin.z - (destination.z + targetDims.depth - 1)),
    ) : Math.max(Math.abs(destination.x - origin.x), Math.abs(destination.y - origin.y), Math.abs(destination.z - origin.z))
    if (dist > (attack.range === 'melee' ? Math.max(1, reach * 2) : derived?.effectiveLimit ?? 0)) throw createError({ statusCode: 400, message: 'The target is out of range' })
    if (index && attack.range === 'ranged' && !canSeeFootprint(index, origin, dims, destination, targetDims)) throw createError({ statusCode: 400, message: 'The target is blocked from sight' })
    return
  }
  const raw = body.areaShapeData
  if (!raw || raw.shape !== shape) throw createError({ statusCode: 400, message: 'Area attack aiming data is required' })
  const positions = await getRoomPositions(encounter.id)
  const origin = positions[actor.id]
  if (!origin) throw createError({ statusCode: 400, message: 'Place the attacker before aiming' })
  if (shape === 'pass') {
    if (!raw[CANONICAL_AREA]) throw createError({ statusCode: 400, message: 'Pass movement must be validated with the attack' })
  } else {
    const derived = actor.type === 'digimon' ? await getDigimonDerivedStats(actor.entityId, actor) : null
    if (!derived) throw createError({ statusCode: 400, message: 'Unable to derive the area attack' })
    const dir = raw.dir ?? { x: 0, y: 0, z: 0 }
    allowFields(dir, ['x', 'y', 'z'])
    for (const axis of ['x', 'y', 'z']) finiteNumber(dir[axis], `direction.${axis}`)
    const blastCenter = shape === 'blast' ? validPosition(raw.blastCenter) : undefined
    if (blastCenter && Math.hypot(blastCenter.x - origin.x, blastCenter.y - origin.y, blastCenter.z - origin.z) > derived.effectiveLimit + 1) throw createError({ statusCode: 400, message: 'Blast center is out of range' })
    body.areaShapeData = { shape, rangeType: attack.range, attackerPos: origin, dir, bit: derived.bit, ram: derived.ram,
      movement: derived.movement, attackerDims: getFootprintDimensions(records.get(actor.entityId)?.size ?? 'medium', records.get(actor.entityId)?.giganticDimensions), ...(blastCenter ? { blastCenter } : {}) }
  }
  const data = body.areaShapeData
  const cells = computeAreaCellsFromData(data)
  const source = data.blastCenter ?? data.attackerPos
  const hit = new Set(cells.filter(cell => !index || losClear(index, source, cell)).map(cell => `${cell.x},${cell.y},${cell.z}`))
  for (const id of body.targetIds ?? [body.targetId]) {
    const target = encounter.participants.find((p: any) => p.id === id)
    const position = positions[id]
    const record = records.get(target?.entityId)
    if (!position || !getFootprintCells(position, getFootprintDimensions(record?.size ?? 'medium', record?.giganticDimensions)).some(cell => hit.has(`${cell.x},${cell.y},${cell.z}`))) throw createError({ statusCode: 400, message: 'A target is outside the aimed attack area' })
  }
}
