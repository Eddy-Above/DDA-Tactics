import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, tamers, digimon, encounters, rewardGrants } from '../../../db'
import { requireCampaignDm } from '../../../utils/campaignDm'
import { serializeIntercedeClaim } from '../../../utils/intercedeClaims'
import { broadcast } from '../../../utils/encounterRoom'
import { normalizeRewardRequest, sameRewardRequest } from '../../../../utils/rewards'
import type { RewardRequest, RewardResult } from '../../../../types/rewards'

export default defineEventHandler(async event => {
  const routeCampaignId = getRouterParam(event, 'id')
  if (!routeCampaignId) throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  const campaignId: string = routeCampaignId
  const { userId } = await requireCampaignDm(event, campaignId)
  let request: RewardRequest
  try { request = normalizeRewardRequest(await readBody(event)) }
  catch (error: any) { throw createError({ statusCode: 400, message: error.message }) }

  const active = await db.select({ id: encounters.id }).from(encounters)
    .where(and(eq(encounters.campaignId, campaignId), inArray(encounters.phase, ['setup', 'initiative', 'combat']))).orderBy(encounters.id)
  // Share combat's decision queues and lock order, so grants do not overwrite an in-flight defense.
  async function queued(index: number): Promise<RewardResult> {
    if (index < active.length) return serializeIntercedeClaim(active[index].id, () => queued(index + 1))
    return db.transaction(async tx => {
      const inserted = await tx.insert(rewardGrants).values({ id: request.requestId, campaignId, payload: request, createdBy: userId })
        .onConflictDoNothing().returning()
      if (!inserted.length) {
        const [prior] = await tx.select().from(rewardGrants).where(eq(rewardGrants.id, request.requestId))
        if (!prior || prior.campaignId !== campaignId || !sameRewardRequest(prior.payload, request)) {
          throw createError({ statusCode: 409, message: 'That reward request ID has already been used for different rewards' })
        }
        return result(true, [])
      }
      const liveEncounters = active.length ? await tx.select({ id: encounters.id, participants: encounters.participants }).from(encounters)
        .where(and(eq(encounters.campaignId, campaignId), inArray(encounters.id, active.map(row => row.id)),
          inArray(encounters.phase, ['setup', 'initiative', 'combat']))).orderBy(encounters.id).for('update') : []
      const people = await tx.select().from(tamers)
        .where(and(eq(tamers.campaignId, campaignId), inArray(tamers.id, request.tamerIds))).orderBy(tamers.id).for('update')
      if (people.length !== request.tamerIds.length) throw createError({ statusCode: 400, message: 'A selected Tamer is no longer in this campaign' })
      if (request.digimonIds.length) {
        const forms = await tx.select().from(digimon)
          .where(and(eq(digimon.campaignId, campaignId), inArray(digimon.id, request.digimonIds))).orderBy(digimon.id).for('update')
        if (forms.length !== request.digimonIds.length || forms.some(d => d.isEnemy || !d.partnerId || !request.tamerIds.includes(d.partnerId))) {
          throw createError({ statusCode: 400, message: 'Bonus DP recipients must be partner forms belonging to the selected Tamers in this campaign' })
        }
      }
      const now = new Date()
      if (request.tamerXp || request.tamerInspiration) await tx.update(tamers).set({
        xp: sql`${tamers.xp} + ${request.tamerXp}`,
        totalXp: sql`CASE WHEN ${tamers.totalXp} IS NULL THEN NULL ELSE ${tamers.totalXp} + ${request.tamerXp} END`,
        grantedInspiration: sql`${tamers.grantedInspiration} + ${request.tamerInspiration}`, updatedAt: now,
      }).where(and(eq(tamers.campaignId, campaignId), inArray(tamers.id, request.tamerIds)))
      if (request.digimonBonusDP) await tx.update(digimon).set({ bonusDP: sql`${digimon.bonusDP} + ${request.digimonBonusDP}`, updatedAt: now })
        .where(and(eq(digimon.campaignId, campaignId), inArray(digimon.id, request.digimonIds)))
      if (request.tamerInspiration) {
        const recipients = new Map(people.map(person => [person.id, person]))
        for (const encounter of liveEncounters) {
          let changed = false
          const participants = encounter.participants.map(p => {
            const person = p.type === 'tamer' ? recipients.get(p.entityId) : undefined
            if (!person) return p
            changed = true
            const balance = p.currentInspiration ?? ((person.inspiration ?? 1) + (person.grantedInspiration ?? 0) + (person.xpBonuses?.inspiration ?? 0))
            return { ...p, currentInspiration: balance + request.tamerInspiration }
          })
          if (changed) await tx.update(encounters).set({ participants, updatedAt: now }).where(eq(encounters.id, encounter.id))
        }
      }
      return result(false, request.tamerXp ? people.filter(p => p.totalXp == null).map(p => p.id) : [])
    })
  }
  function result(replayed: boolean, untrackedTamerIds: string[]): RewardResult {
    return { requestId: request.requestId, tamerXp: request.tamerXp, tamerInspiration: request.tamerInspiration,
      digimonBonusDP: request.digimonBonusDP, tamerCount: request.tamerIds.length, digimonCount: request.digimonIds.length, untrackedTamerIds, replayed }
  }
  const granted = await queued(0)
  if (!granted.replayed) {
    const message = { type: 'rewards-granted', requestId: request.requestId, campaignId, tamerIds: request.tamerIds, digimonIds: request.digimonIds }
    broadcast(`campaign:${campaignId}`, message)
    for (const encounter of active) broadcast(encounter.id, message)
  }
  return granted
})
