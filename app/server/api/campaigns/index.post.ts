import { db, campaigns } from '../../db'
import { generateId } from '../../utils/id'
import { hashPassword } from '../../utils/password'

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

  const newCampaign: any = {
    id,
    name: body.name,
    description: body.description || '',
    level: body.level || 'standard',
    passwordHash: body.password ? hashPassword(body.password) : null,
    dmPasswordHash: body.dmPassword ? hashPassword(body.dmPassword) : null,
    rulesSettings: JSON.stringify({}),
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
    createdAt: newCampaign.createdAt,
    updatedAt: newCampaign.updatedAt,
  }
})
