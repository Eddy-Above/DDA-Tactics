import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../../db'
import { verifyPassword } from '../../../utils/password'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ password: string }>(event)

  if (!id) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  if (!body.password) {
    throw createError({ statusCode: 400, message: 'Password is required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!campaign) {
    throw createError({ statusCode: 404, message: `Campaign with ID ${id} not found` })
  }

  if (!campaign.passwordHash) {
    return { valid: true }
  }

  return { valid: verifyPassword(body.password, campaign.passwordHash) }
})
