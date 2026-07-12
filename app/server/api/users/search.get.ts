import { sql } from 'drizzle-orm'
import { db, users } from '../../db'

// Usernames aren't sensitive data, so this is intentionally unauthenticated —
// it only powers the "add account" username lookup in campaign Settings.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = typeof query.q === 'string' ? query.q.trim() : ''

  if (!q) return { results: [] }

  // Escape LIKE wildcards in the user-supplied query so `_`/`%` are matched
  // literally rather than as pattern metacharacters.
  const escaped = q.replace(/[%_\\]/g, (c) => `\\${c}`)

  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(sql`LOWER(${users.username}) LIKE LOWER(${'%' + escaped + '%'})`)
    .limit(10)

  return { results: rows }
})
