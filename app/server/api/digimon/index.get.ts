import { eq, or, inArray } from 'drizzle-orm'
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

  let queryBuilder = db.select().from(digimon)

  if (campaignId) {
    const campaignTamerIds = db.select({ id: tamers.id }).from(tamers).where(eq(tamers.campaignId, campaignId))
    queryBuilder = queryBuilder.where(
      or(
        eq(digimon.campaignId, campaignId),
        inArray(digimon.partnerId, campaignTamerIds)
      )
    ) as typeof queryBuilder
  }

  if (partnerId) {
    queryBuilder = queryBuilder.where(eq(digimon.partnerId, partnerId)) as typeof queryBuilder
  }

  if (query.isEnemy !== undefined) {
    queryBuilder = queryBuilder.where(eq(digimon.isEnemy, isEnemy)) as typeof queryBuilder
  }

  if (stage) {
    queryBuilder = queryBuilder.where(eq(digimon.stage, stage)) as typeof queryBuilder
  }

  const allDigimon = await queryBuilder
  return allDigimon.map(parseDigimonData)
})
