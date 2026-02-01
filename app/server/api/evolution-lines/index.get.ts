import { eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const partnerId = query.partnerId as string | undefined

  let lines
  if (partnerId) {
    lines = await db.select().from(evolutionLines).where(eq(evolutionLines.partnerId, partnerId))
  } else {
    lines = await db.select().from(evolutionLines)
  }

  // Parse chain from JSON string to array for all lines
  return lines.map((line) => ({
    ...line,
    chain: typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain,
  }))
})
