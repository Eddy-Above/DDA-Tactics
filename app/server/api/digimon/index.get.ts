import { eq } from 'drizzle-orm'
import { db, digimon } from '../../db'
import { parseDigimonData } from '../../utils/parsers'

type DigimonStage = 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  // Optional filters
  const partnerId = query.partnerId as string | undefined
  const isEnemy = query.isEnemy === 'true'
  const stage = query.stage as DigimonStage | undefined

  let queryBuilder = db.select().from(digimon)

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
