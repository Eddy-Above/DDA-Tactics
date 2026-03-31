import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../db'
import { hashPassword } from '../../utils/password'

interface UpdateCampaignBody {
  name?: string
  description?: string
  level?: 'standard' | 'enhanced' | 'extreme'
  password?: string | null
  dmPassword?: string | null
  rulesSettings?: Record<string, any>
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateCampaignBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Campaign ID is required',
    })
  }

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Campaign with ID ${id} not found`,
    })
  }

  const updateData: any = { updatedAt: new Date() }

  if (body.name !== undefined) updateData.name = body.name
  if (body.description !== undefined) updateData.description = body.description
  if (body.level !== undefined) updateData.level = body.level
  if (body.rulesSettings !== undefined) updateData.rulesSettings = JSON.stringify(body.rulesSettings)

  // Handle password updates: null = remove, string = set new, undefined = no change
  if (body.password !== undefined) {
    updateData.passwordHash = body.password ? hashPassword(body.password) : null
  }
  if (body.dmPassword !== undefined) {
    updateData.dmPasswordHash = body.dmPassword ? hashPassword(body.dmPassword) : null
  }

  await db.update(campaigns).set(updateData).where(eq(campaigns.id, id))

  const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    level: updated.level,
    hasPassword: !!updated.passwordHash,
    hasDmPassword: !!updated.dmPasswordHash,
    rulesSettings: typeof updated.rulesSettings === 'string' ? JSON.parse(updated.rulesSettings) : (updated.rulesSettings || {}),
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
})
