import { db, campaigns, type NewCampaign } from '../../db'
import { generateId } from '../../utils/id'
import { hashPassword } from '../../utils/password'
import { getSessionUser } from '../../utils/session'
import { allowFields, boundedString } from '../../utils/securityValidation'
import { issueCampaignMemberCookie, issueCampaignDmCookie } from '../../utils/campaignSecurity'

interface CreateCampaignBody {
  name: string
  description?: string
  level?: 'standard' | 'enhanced' | 'extreme'
  password?: string
  dmPassword?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateCampaignBody>(event)
  allowFields(body, ['name', 'description', 'level', 'password', 'dmPassword', 'rulesSettings'])
  boundedString(body.name, 'name', 1000, false)
  if (body.description !== undefined) boundedString(body.description, 'description', 100000)
  if (body.level !== undefined && !['standard', 'enhanced', 'extreme'].includes(body.level)) throw createError({ statusCode: 400, message: 'Invalid campaign level' })
  for (const password of [body.password, body.dmPassword]) if (password !== undefined) boundedString(password, 'password', 500)

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
  if (!sessionUser && body.password && !body.dmPassword) throw createError({ statusCode: 400, message: 'Set a GM password when creating a protected campaign without an account.' })

  const newCampaign: NewCampaign = {
    id,
    name: body.name,
    description: body.description || '',
    level: body.level || 'standard',
    passwordHash: body.password ? await hashPassword(body.password) : null,
    dmPasswordHash: body.dmPassword ? await hashPassword(body.dmPassword) : null,
    rulesSettings: {},
    ownerId: sessionUser?.id ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(campaigns).values(newCampaign)
  const credentialCampaign = { id, passwordHash: newCampaign.passwordHash ?? null, dmPasswordHash: newCampaign.dmPasswordHash ?? null }
  if (credentialCampaign.passwordHash) issueCampaignMemberCookie(event, credentialCampaign)
  if (credentialCampaign.dmPasswordHash) issueCampaignDmCookie(event, credentialCampaign)

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
