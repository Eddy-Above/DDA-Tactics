import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Campaign ID is required',
    })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!campaign) {
    throw createError({
      statusCode: 404,
      message: `Campaign with ID ${id} not found`,
    })
  }

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    level: campaign.level,
    hasPassword: !!campaign.passwordHash,
    hasDmPassword: !!campaign.dmPasswordHash,
    rulesSettings: typeof campaign.rulesSettings === 'string' ? JSON.parse(campaign.rulesSettings) : (campaign.rulesSettings || {}),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  }
})
