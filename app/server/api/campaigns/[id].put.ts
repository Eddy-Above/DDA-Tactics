import { requireCampaignManager } from '../../utils/campaignSecurity'
import { allowFields, boundedString, objectBody } from '../../utils/securityValidation'
import { invalidateCampaignPeers } from '../../utils/websocketSecurity'
import { eq } from 'drizzle-orm'
import { db, campaigns, type Campaign } from '../../db'
import { hashPassword } from '../../utils/password'
import { requireOwnerOrCoOwner } from '../../utils/campaignAuth'

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

  // Owned campaigns require a manager; protected ownerless campaigns require verified GM access.
  await requireCampaignManager(event, id)
  allowFields(body, ['name', 'description', 'level', 'password', 'dmPassword', 'rulesSettings'])
  if (body.name !== undefined) boundedString(body.name, 'name', 1000, false)
  if (body.description !== undefined) boundedString(body.description, 'description', 100000)
  if (body.level !== undefined && !['standard', 'enhanced', 'extreme'].includes(body.level)) throw createError({ statusCode: 400, message: 'Invalid campaign level' })
  for (const password of [body.password, body.dmPassword]) if (password !== undefined && password !== null) boundedString(password, 'password', 500)
  if (body.rulesSettings !== undefined) objectBody(body.rulesSettings)
  const nextPlayerProtected = body.password === undefined ? !!existing.passwordHash : !!body.password
  const nextGmProtected = body.dmPassword === undefined ? !!existing.dmPasswordHash : !!body.dmPassword
  if (!existing.ownerId && nextPlayerProtected && !nextGmProtected) throw createError({ statusCode: 400, message: 'An ownerless protected campaign must retain a GM password.' })

  const updateData: Partial<Campaign> = { updatedAt: new Date() }

  if (body.name !== undefined) updateData.name = body.name
  if (body.description !== undefined) updateData.description = body.description
  if (body.level !== undefined) updateData.level = body.level
  if (body.rulesSettings !== undefined) updateData.rulesSettings = body.rulesSettings

  // Handle password updates: null = remove, string = set new, undefined = no change
  if (body.password !== undefined) {
    updateData.passwordHash = body.password ? await hashPassword(body.password) : null
  }
  if (body.dmPassword !== undefined) {
    updateData.dmPasswordHash = body.dmPassword ? await hashPassword(body.dmPassword) : null
  }

  await db.update(campaigns).set(updateData).where(eq(campaigns.id, id))
  if (body.password !== undefined || body.dmPassword !== undefined) invalidateCampaignPeers(id)

  const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    level: updated.level,
    hasPassword: !!updated.passwordHash,
    hasDmPassword: !!updated.dmPasswordHash,
    rulesSettings: updated.rulesSettings,
    ownerId: updated.ownerId,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
})
