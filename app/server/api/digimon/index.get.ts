import { filterReadableEntities } from '../../utils/entitySecurity'
import { requireCampaignMember } from '../../utils/campaignSecurity'
import { eq, or, inArray, and, count, isNull } from 'drizzle-orm'
import { db, digimon, tamers } from '../../db'
import { getSessionUser } from '../../utils/session'

type DigimonStage = 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  // Optional filters
  const partnerId = query.partnerId as string | undefined
  const isEnemy = query.isEnemy === 'true'
  const stage = query.stage as DigimonStage | undefined
  const campaignId = query.campaignId as string | undefined
  if (campaignId) await requireCampaignMember(event, campaignId)
  const ids = query.ids as string | undefined

  const conditions = []

  let idList: string[] = []
  if (ids) {
    idList = ids.split(',').filter(Boolean)
    if (idList.length > 0) {
      conditions.push(inArray(digimon.id, idList))
    }
  }

  if (query.sandbox === 'true') {
    // Workshop (sandbox) digimon: not attached to any campaign. Hidden
    // characters are visible only to their owner; hidden-without-owner is
    // neutralized (visible) — see tamers/index.get.ts for rationale.
    conditions.push(isNull(digimon.campaignId))
    const sessionUser = await getSessionUser(event)
    const visibility = [eq(digimon.hidden, false), isNull(digimon.ownerId)]
    if (sessionUser) visibility.push(eq(digimon.ownerId, sessionUser.id))
    conditions.push(or(...visibility)!)
  } else if (campaignId) {
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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const page = Math.max(1, parseInt(query.page as string) || 1)

  let pageSize: number
  if (idList.length > 0 && query.pageSize === undefined) {
    pageSize = Math.min(500, idList.length)
  } else {
    pageSize = Math.min(500, Math.max(1, parseInt(query.pageSize as string) || 50))
  }

  const [{ value: total }] = await db.select({ value: count() }).from(digimon).where(whereClause)

  const found = await db
    .select()
    .from(digimon)
    .where(whereClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  let invalidRecords = 0
  const data = await filterReadableEntities(event, found, 'digimon', () => { invalidRecords++ })
  return {
    data,
    total: Number(total),
    page,
    pageSize,
    totalPages: Math.ceil(Number(total) / pageSize),
    ...(invalidRecords ? { warnings: ['Some Digimon were excluded because their linked character records need repair.'] } : {}),
  }
})
