import { db, users } from '../../db'
import { generateId } from '../../utils/id'
import { hashPassword } from '../../utils/password'
import { createSession } from '../../utils/session'

interface RegisterBody {
  username: string
  password: string
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<RegisterBody>(event)

  if (!body.username || typeof body.username !== 'string' || !USERNAME_RE.test(body.username)) {
    throw createError({
      statusCode: 400,
      message: 'Username must be 3-30 characters (letters, numbers, underscore, hyphen only)',
    })
  }
  if (!body.password || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 500) {
    throw createError({ statusCode: 400, message: 'Password must be at least 8 characters' })
  }

  const id = generateId()
  const now = new Date()

  try {
    await db.insert(users).values({
      id,
      username: body.username,
      passwordHash: hashPassword(body.password),
      createdAt: now,
      updatedAt: now,
    })
  } catch (e: any) {
    // Case-insensitive uniqueness is enforced by a DB-level functional
    // unique index (see migration 0016) — this catches the race between
    // two concurrent registrations of the same name.
    if (e?.code === '23505') {
      throw createError({ statusCode: 409, message: 'Username is already taken' })
    }
    throw createError({ statusCode: 500, message: 'Failed to create account' })
  }

  const { expiresAt } = await createSession(event, id)

  return { id, username: body.username, expiresAt }
})
