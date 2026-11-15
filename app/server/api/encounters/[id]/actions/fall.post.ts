import { eq } from 'drizzle-orm'
import { readBody } from 'h3'
import { db, encounters } from '../../../../db'
import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { getRoomSnapshot, getDestroyedStructureIds, publishCommittedPositions } from '../../../../utils/encounterRoom'
import { loadEncounterMap, loadParticipantDigimon, loadTamersByIds } from '../../../../utils/combatSpatial'
import { getFootprintDimsForParticipant } from '../../../../utils/mapMovement'
import { isFootprintAirborne } from '../../../../../utils/movementRules'
import { computeGravityDrops } from '../../../../utils/endOfTurnGravity'
import { resolveEnemyKnockouts } from '../../../../utils/enemyKnockouts'
import { refreshGuidingLightForParticipants } from '../../../../utils/guidingLight'

export default defineEncounterCommand(async (event, { encounter }) => {
  const { participantId } = await readBody<{ participantId: string }>(event)
  const actor = encounter.participants.find(p => p.id === participantId)
  if (!actor || actor.inReserve || actor.clash || encounter.phase !== 'combat') {
    throw createError({ statusCode: 400, message: 'This character cannot fall now' })
  }
  const records = await loadParticipantDigimon(encounter.participants)
  if (!await canActOnEncounterTurn(actor, encounter, async id => records.has(id) ? [records.get(id)!] : [])) {
    throw createError({ statusCode: 403, message: 'Fall is available on this character’s turn' })
  }
  const map = await loadEncounterMap(encounter.mapId)
  const room = await getRoomSnapshot(encounter.id)
  const pos = room.participantPositions[actor.id]
  if (!map || !pos || !isFootprintAirborne(pos, getFootprintDimsForParticipant(actor, records), map)) {
    throw createError({ statusCode: 400, message: 'Fall requires an ungrounded character' })
  }
  const participants = encounter.participants.map(p => ({ ...p }))
  const faller = participants.find(p => p.id === actor.id)!
  const tamers = await loadTamersByIds(actor.type === 'tamer' ? [actor.entityId] : [])
  const drops = await computeGravityDrops(room.participantPositions, [faller], map, records, encounter.round,
    getDestroyedStructureIds(room.destructibleStates), tamers, true)
  if (!drops.patch[actor.id]) throw createError({ statusCode: 400, message: 'There is no ground below this character to fall onto' })
  const positions = { ...room.participantPositions, ...drops.patch }
  const knockout = await resolveEnemyKnockouts({ participants, turnOrder: encounter.turnOrder,
    currentTurnIndex: encounter.currentTurnIndex, round: encounter.round }, [actor.id], {
    encounterId: encounter.id, gravity: { map, positions },
  })
  Object.assign(positions, knockout.positionPatch ?? {})
  const updatedParticipants = await refreshGuidingLightForParticipants(encounter.id, knockout.participants, positions)
  const [updated] = await db.update(encounters).set({
    participants: updatedParticipants, participantPositions: positions,
    turnOrder: knockout.turnOrder, currentTurnIndex: knockout.currentTurnIndex, round: knockout.round,
    battleLog: [...encounter.battleLog, ...drops.logEntries, ...knockout.logEntries], updatedAt: new Date(),
  }).where(eq(encounters.id, encounter.id)).returning()
  await publishCommittedPositions(encounter.id, { ...drops.patch, ...knockout.positionPatch })
  return updated
})
