import { eq } from 'drizzle-orm'
import { db, campaigns, tamers, digimon } from '../../../db'
import { generateId } from '../../../utils/id'
import { appendRollLogEntry } from '../../../utils/rollLog'

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')

  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) {
    throw createError({ statusCode: 404, message: 'Campaign not found' })
  }

  const rulesSettings = campaign.rulesSettings || {}

  const healAllWounds = rulesSettings.houseRules?.newDayHealsAllWounds ?? false

  // Reset all tamers in campaign
  const campaignTamers = await db.select().from(tamers).where(eq(tamers.campaignId, campaignId))

  for (const tamer of campaignTamers) {
    await db.update(tamers)
      .set({
        usedPerDayOrders: [],
        usedPerDaySkillOrders: [],
        digivolutionsUsedToday: 0,
        ...(healAllWounds ? { currentWounds: 0 } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tamers.id, tamer.id))
  }

  // If heal-all rule is active, also reset digimon wounds
  let digimonResetCount = 0
  if (healAllWounds) {
    const campaignDigimon = await db.select().from(digimon).where(eq(digimon.campaignId, campaignId))
    for (const d of campaignDigimon) {
      await db.update(digimon)
        .set({ currentWounds: 0, updatedAt: new Date() })
        .where(eq(digimon.id, d.id))
    }
    digimonResetCount = campaignDigimon.length
  }

  // Drop a "New Day" marker into the campaign roll history (live-pushed)
  await appendRollLogEntry(campaignId, {
    id: generateId(),
    campaignId,
    kind: 'new-day',
    tamerId: null,
    characterName: null,
    spriteUrl: null,
    rollName: null,
    rolls: [],
    modifier: 0,
    total: 0,
    passed: null,
    createdAt: new Date(),
  })

  return {
    message: 'New day started',
    tamersReset: campaignTamers.length,
    digimonHealed: digimonResetCount,
    healedAllWounds: healAllWounds,
  }
})
