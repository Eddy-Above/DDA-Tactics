import { sql } from 'drizzle-orm'
import { db, users } from '../../db'
import { verifyPassword } from '../../utils/password'
import { createSession } from '../../utils/session'

interface LoginBody {
  username: string
  password: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<LoginBody>(event)

  if (
    !body.username || typeof body.username !== 'string'
    || !body.password || typeof body.password !== 'string' || body.password.length > 500
  ) {
    throw createError({ statusCode: 400, message: 'Username and password are required' })
  }

  const [user] = await db.select().from(users).where(sql`LOWER(${users.username}) = LOWER(${body.username})`)

  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    throw createError({ statusCode: 401, message: 'Invalid username or password' })
  }

  const { expiresAt } = await createSession(event, user.id)

  return { id: user.id, username: user.username, expiresAt }
})
