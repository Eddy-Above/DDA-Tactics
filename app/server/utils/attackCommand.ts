import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { serializeIntercedeClaim } from './intercedeClaims'
import { withDatabase } from './databaseScope'
import { authorizeEncounterIntent } from './encounterAuthorization'
import { boundedString, finiteNumber } from './securityValidation'
import { withCombatRecords } from './combatRecordCache'
import { prepareRoomCommit } from './encounterRoom'
import { validateEncounterStateScope } from './encounterStateScope'
import { validateEncounterContextScope } from './encounterContextScope'
import { shapeEncounterResult } from '../../utils/encounterSnapshot'
import { withEncounterCommandReceipt } from './encounterCommandReceipt'
import { notifyEncounterAudienceChanged } from './characterUpdates'
import { finishTankBusterHealthChange } from './tankBuster'
import { finishBraveStanceHealthChange } from './braveStance'
import { finishFallProtection, withFallProtection } from './fallDamage'

/** One durable command, including trusted nested attack/defense services and their broadcasts. */
export async function runAttackCommand<T>(event: H3Event, id: string, body: any, operation: string,
  work: (context: Awaited<ReturnType<typeof authorizeEncounterIntent>>) => Promise<T>): Promise<T> {
  await authorizeEncounterIntent(event, id, body, operation)
  const operationId = body.operationId === undefined ? undefined : boundedString(body.operationId, 'operationId', 128, false)
  const fingerprint = createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex')
  return shapeEncounterResult(await serializeIntercedeClaim(id, async () => {
    await prepareRoomCommit(id)
    const committed: Array<() => void | Promise<void>> = []
    const result = await db.transaction(async transaction => withDatabase(transaction, () => withCombatRecords(() => withFallProtection(async () => {
      const [lockedEncounter] = await db.select().from(encounters).where(eq(encounters.id, id)).for('update')
      const context = await authorizeEncounterIntent(event, id, body, operation, lockedEncounter)
      // Update can replace a tainted legacy roster; deletion needs no linked records.
      // All other services may use targets, saved forms or partners beyond the actor.
      if (operation !== 'delete' && operation !== 'update') await validateEncounterStateScope(context.encounter, { participants: context.encounter.participants })
      if (operation === 'requests-create' || operation === 'response') await validateEncounterContextScope(context.encounter, body)
      const actorId = body.participantId ?? body.attackerId ?? (operation === 'log' ? body.actorId : undefined)
      const actor = context.encounter.participants?.find((p: any) => p.id === actorId) as any
      const prior = operationId && actor?.attackReceipts?.find((receipt: any) => receipt.operationId === operationId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw createError({ statusCode: 409, message: 'This operation ID already belongs to another command' })
        return context.encounter as T
      }
      if (body.expectedRevision !== undefined) {
        finiteNumber(body.expectedRevision, 'expectedRevision', { integer: true, min: 0 })
        if (body.expectedRevision !== context.encounter.revision) throw createError({ statusCode: 409, message: 'The encounter changed. Review the action and try again.' })
      }
      const audienceBefore = {
        id: context.encounter.id, campaignId: context.encounter.campaignId,
        visibleToPlayers: context.encounter.visibleToPlayers, phase: context.encounter.phase,
        participants: context.encounter.participants.map(p => ({ type: p.type, entityId: p.entityId })),
        pendingRequests: (context.encounter.pendingRequests ?? []).map(r => ({ targetTamerId: r.targetTamerId })),
      }
      const healthBefore = { phase: context.encounter.phase, participants: context.encounter.participants.map((p: any) => ({
        id: p.id, currentWounds: p.currentWounds, maxWounds: p.maxWounds, tankBusterUses: p.tankBusterUses,
      })) }
      const { value, saved } = await withEncounterCommandReceipt(id, actorId, operationId, fingerprint, async () => {
        const result = await work(context)
        if (operation === 'delete' || operation === 'duplicate') return result
        return finishBraveStanceHealthChange(id, context.encounter, await finishTankBusterHealthChange(id, healthBefore, await finishFallProtection(id, result, context.encounter)))
      })
      if (operationId && !saved) {
        const [fresh] = await db.select().from(encounters).where(eq(encounters.id, id))
        if (fresh?.participants?.some((p: any) => p.id === actorId)) {
          const participants = fresh.participants.map((p: any) => p.id === actorId ? { ...p,
            attackReceipts: [...(p.attackReceipts ?? []), { operationId, fingerprint }].slice(-50),
          } : p)
          const [updated] = await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, id)).returning()
          if (value && typeof value === 'object' && (value as any).id === id) Object.assign(value, updated)
        }
      }
      if (operation === 'delete') notifyEncounterAudienceChanged(audienceBefore, null)
      else if (value && typeof value === 'object' && (value as any).id === id) {
        notifyEncounterAudienceChanged(audienceBefore, value as any)
      }
      return value
    })), committed))
    for (const publish of committed) await publish()
    return result
  }))
}
