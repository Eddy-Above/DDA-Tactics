import { sql, eq, and } from 'drizzle-orm'
import { db, users } from '../../db'
import { verifyPassword, hashPassword, needsPasswordRehash } from '../../utils/password'
import { createSession } from '../../utils/session'
import { allowFields } from '../../utils/securityValidation'
import { enforcePasswordAttemptLimit, recordPasswordFailure } from '../../utils/securityTransport'

interface LoginBody {
  username: string
  password: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<LoginBody>(event)
  allowFields(body, ['username', 'password'])

  if (
    !body.username || typeof body.username !== 'string'
    || !body.password || typeof body.password !== 'string' || body.password.length > 500
  ) {
    throw createError({ statusCode: 400, message: 'Username and password are required' })
  }

  enforcePasswordAttemptLimit(event, 'account')
  const [user] = await db.select().from(users).where(sql`LOWER(${users.username}) = LOWER(${body.username})`)

  if (!user || !await verifyPassword(body.password, user.passwordHash)) {
    recordPasswordFailure(event, 'account')
    throw createError({ statusCode: 401, message: 'Invalid username or password' })
  }

  if (needsPasswordRehash(user.passwordHash)) {
    const passwordHash = await hashPassword(body.password)
    const [updated] = await db.update(users).set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash))).returning()
    if (!updated) {
      const [current] = await db.select().from(users).where(eq(users.id, user.id))
      if (!current || !await verifyPassword(body.password, current.passwordHash)) throw createError({ statusCode: 401, message: 'Invalid username or password' })
    }
  }

  const { expiresAt } = await createSession(event, user.id)

  return { id: user.id, username: user.username, expiresAt }
})
