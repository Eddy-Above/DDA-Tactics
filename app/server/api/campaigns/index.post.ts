import { db, campaigns, type NewCampaign } from '../../db'
import { generateId } from '../../utils/id'
import { hashPassword } from '../../utils/password'
import { getSessionUser } from '../../utils/session'

interface CreateCampaignBody {
  name: string
  description?: string
  level?: 'standard' | 'enhanced' | 'extreme'
  password?: string
  dmPassword?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateCampaignBody>(event)

  if (!body.name) {
    throw createError({
      statusCode: 400,
      message: 'Missing required field: name',
    })
  }

  const id = generateId()
  const now = new Date()

  // Owner is stamped only at creation time, only if the creator was logged
  // in, and is never reassigned afterward — no retroactive claiming.
  const sessionUser = await getSessionUser(event)

  const newCampaign: NewCampaign = {
    id,
    name: body.name,
    description: body.description || '',
    level: body.level || 'standard',
    passwordHash: body.password ? hashPassword(body.password) : null,
    dmPasswordHash: body.dmPassword ? hashPassword(body.dmPassword) : null,
    rulesSettings: {},
    ownerId: sessionUser?.id ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(campaigns).values(newCampaign)

  return {
    id: newCampaign.id,
    name: newCampaign.name,
    description: newCampaign.description,
    level: newCampaign.level,
    hasPassword: !!newCampaign.passwordHash,
    hasDmPassword: !!newCampaign.dmPasswordHash,
    rulesSettings: {},
    ownerId: newCampaign.ownerId,
    createdAt: newCampaign.createdAt,
    updatedAt: newCampaign.updatedAt,
  }
})
