import { eq } from 'drizzle-orm'
import { db, tamers } from '../../../db'
import { generateId } from '../../../utils/id'
import { appendRollLogEntry } from '../../../utils/rollLog'

interface LogRollBody {
  tamerId: string
  rollName: string
  rolls: number[]
  modifier: number
  total: number
  passed?: boolean
}

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  const body = await readBody<LogRollBody>(event)

  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }
  if (!body?.tamerId || !body.rollName || !Array.isArray(body.rolls)) {
    throw createError({ statusCode: 400, message: 'tamerId, rollName, and rolls are required' })
  }

  // Snapshot name/sprite server-side rather than trusting the client
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, body.tamerId))
  if (!tamer || tamer.campaignId !== campaignId) {
    throw createError({ statusCode: 404, message: 'Tamer not found in this campaign' })
  }

  const entry = await appendRollLogEntry(campaignId, {
    id: generateId(),
    campaignId,
    kind: 'roll',
    tamerId: tamer.id,
    characterName: tamer.name,
    spriteUrl: tamer.spriteUrl ?? null,
    rollName: String(body.rollName).slice(0, 100),
    rolls: body.rolls.map((r) => Number(r) || 0),
    modifier: Number(body.modifier) || 0,
    total: Number(body.total) || 0,
    passed: typeof body.passed === 'boolean' ? body.passed : null,
    createdAt: new Date(),
  })

  return entry
})
