import { eq } from 'drizzle-orm'
import { db, tamers, digimon, evolutionLines } from '../../../db'
import { requireCampaignDm } from '../../../utils/campaignDm'
import type { RewardRoster } from '../../../../types/rewards'
import { rewardPartners } from '../../../../utils/rewardPartners'

export default defineEventHandler(async event => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  await requireCampaignDm(event, campaignId)
  const [people, forms, lines] = await Promise.all([
    db.select().from(tamers).where(eq(tamers.campaignId, campaignId)),
    db.select().from(digimon).where(eq(digimon.campaignId, campaignId)),
    db.select().from(evolutionLines).where(eq(evolutionLines.campaignId, campaignId)),
  ])
  const roster: RewardRoster = {
    tamers: people.map(p => ({ id: p.id, name: p.name, spriteUrl: p.spriteUrl, xp: p.xp, totalXp: p.totalXp,
      inspiration: (p.inspiration ?? 1) + (p.grantedInspiration ?? 0) + (p.xpBonuses?.inspiration ?? 0) })).sort((a, b) => a.name.localeCompare(b.name)),
    digimon: rewardPartners(forms, lines, campaignId, people.map(p => p.id)).map(({ formIds, ...partner }) => partner)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  return roster
})
