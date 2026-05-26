import { eq, or, inArray, and } from 'drizzle-orm'
import { db, digimon, tamers } from '../../db'
import { parseDigimonData } from '../../utils/parsers'

type DigimonStage = 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  // Optional filters
  const partnerId = query.partnerId as string | undefined
  const isEnemy = query.isEnemy === 'true'
  const stage = query.stage as DigimonStage | undefined
  const campaignId = query.campaignId as string | undefined
  const ids = query.ids as string | undefined

  const conditions = []

  if (ids) {
    const idList = ids.split(',').filter(Boolean)
    if (idList.length > 0) {
      conditions.push(inArray(digimon.id, idList))
    }
  }

  if (campaignId) {
    const campaignTamerIds = db.select({ id: tamers.id }).from(tamers).where(eq(tamers.campaignId, campaignId))
    conditions.push(or(
      eq(digimon.campaignId, campaignId),
      inArray(digimon.partnerId, campaignTamerIds)
    ))
  }

  if (partnerId) {
    conditions.push(eq(digimon.partnerId, partnerId))
  }

  if (query.isEnemy !== undefined) {
    conditions.push(eq(digimon.isEnemy, isEnemy))
  }

  if (stage) {
    conditions.push(eq(digimon.stage, stage))
  }

  const allDigimon = await db.select().from(digimon).where(and(...conditions))
  return allDigimon.map(parseDigimonData)
})
