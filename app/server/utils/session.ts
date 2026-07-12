import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db, sessions, users } from '../db'
import { generateId } from './id'

const SESSION_COOKIE = 'session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, matches the existing campaign-cookie TTL convention

// Real credential-backed session, unlike the app's existing boolean-flag
// cookies (`campaign-access-{id}` / `campaign-dm-{id}`) — must be httpOnly
// so it isn't readable/stealable via JS, and is set server-side here rather
// than via the client `useCookie()` pattern used for those flags.
export async function createSession(event: H3Event, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateId()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.insert(sessions).values({ id: token, userId, expiresAt, createdAt: new Date() })

  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })

  return { token, expiresAt }
}

// Never throws — "no session" is just another valid state, same as the
// existing cookie-presence checks elsewhere in the app.
export async function getSessionUser(event: H3Event): Promise<{ id: string; username: string } | null> {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null

  const [row] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, token))

  if (!row || row.expiresAt.getTime() <= Date.now()) return null

  return { id: row.userId, username: row.username }
}

export async function destroySession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token))
  }
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}
