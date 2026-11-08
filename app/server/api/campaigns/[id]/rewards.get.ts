import { eq } from 'drizzle-orm'
import { db, tamers, digimon } from '../../../db'
import { requireCampaignDm } from '../../../utils/campaignDm'
import type { RewardRoster } from '../../../../types/rewards'

export default defineEventHandler(async event => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  await requireCampaignDm(event, campaignId)
  const [people, forms] = await Promise.all([
    db.select().from(tamers).where(eq(tamers.campaignId, campaignId)),
    db.select().from(digimon).where(eq(digimon.campaignId, campaignId)),
  ])
  const owners = new Set(people.map(p => p.id))
  const roster: RewardRoster = {
    tamers: people.map(p => ({ id: p.id, name: p.name, spriteUrl: p.spriteUrl, xp: p.xp, totalXp: p.totalXp,
      inspiration: (p.inspiration ?? 1) + (p.grantedInspiration ?? 0) + (p.xpBonuses?.inspiration ?? 0) })).sort((a, b) => a.name.localeCompare(b.name)),
    digimon: forms.filter(d => !d.isEnemy && d.partnerId && owners.has(d.partnerId)).map(d => ({ id: d.id, name: d.name,
      spriteUrl: d.spriteUrl, partnerId: d.partnerId!, stage: d.stage, bonusDP: d.bonusDP })).sort((a, b) => a.name.localeCompare(b.name)),
  }
  return roster
})
