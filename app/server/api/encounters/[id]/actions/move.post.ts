import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { prepareEncounterMovement, movementFingerprint, type MovementIntent } from '../../../../utils/encounterMovement'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { prepareRoomCommit, publishCommittedPositions, broadcast } from '../../../../utils/encounterRoom'
import { resolveEnemyKnockouts } from '../../../../utils/enemyKnockouts'
import { loadEncounterMap } from '../../../../utils/combatSpatial'
import { withDatabase } from '../../../../utils/databaseScope'
import { validateEncounterStateScope } from '../../../../utils/encounterStateScope'

export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<MovementIntent>(event)
  const { access } = await authorizeEncounterIntent(event, id, body, 'move')
  return serializeIntercedeClaim(id!, async () => {
    await prepareRoomCommit(id!)
    const committed: Array<() => void | Promise<void>> = []
    const result = await db.transaction(async tx => withDatabase(tx, async () => {
      await db.select().from(encounters).where(eq(encounters.id, id!)).for('update')
      const freshContext = await authorizeEncounterIntent(event, id, body, 'move')
      const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id!))
      if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })
      await validateEncounterStateScope(encounter, { participants: encounter.participants })
      const actor = encounter.participants.find(p => p.id === body.participantId)
      const fingerprint = movementFingerprint(body)
      const prior = (actor as any)?.movementReceipts?.find((r: any) => r.operationId === body.operationId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw createError({ statusCode: 409, message: 'This operation ID was used for different movement' })
        return { encounter, ...prior.result, replayed: true }
      }
      const prepared = await prepareEncounterMovement(encounter, body, { isDm: freshContext.access?.isDm ?? false })
      let participants = prepared.participants
      let turnOrder = encounter.turnOrder, currentTurnIndex = encounter.currentTurnIndex, round = encounter.round
      let battleLog = prepared.battleLog
      const patch = { [body.participantId]: prepared.position }
      if (prepared.defeated) {
        const map = await loadEncounterMap(encounter.mapId)
        const knockout = await resolveEnemyKnockouts({ participants, turnOrder, currentTurnIndex, round }, [body.participantId], map ? { encounterId: id!, gravity: { map, positions: prepared.participantPositions } } : { encounterId: id! })
        participants = knockout.participants; turnOrder = knockout.turnOrder; currentTurnIndex = knockout.currentTurnIndex; round = knockout.round
        battleLog = [...battleLog, ...knockout.logEntries]
        Object.assign(prepared.participantPositions, knockout.positionPatch ?? {})
        Object.assign(patch, knockout.positionPatch ?? {})
      }
      const receiptResult = { success: true, position: prepared.position, path: prepared.path, defeated: prepared.defeated }
      participants = participants.map((p: any) => p.id === body.participantId ? { ...p, movementReceipts: [...(p.movementReceipts ?? []), { operationId: body.operationId, fingerprint, result: receiptResult }].slice(-50) } : p)
      await prepared.commitDoors(db)
      const [updated] = await db.update(encounters).set({ participants, participantPositions: prepared.participantPositions, battleLog, turnOrder, currentTurnIndex, round, updatedAt: new Date() }).where(eq(encounters.id, id!)).returning()
      return { encounter: updated, ...receiptResult, patch, openedDoorIds: prepared.openedDoorIds }
    }, committed))
    for (const publish of committed) await publish()
    if (!('replayed' in result)) {
      await publishCommittedPositions(id!, result.patch)
      if (result.openedDoorIds.length) broadcast(id!, { type: 'door-toggled', encounterId: id! })
    }
    return result
  })
})
