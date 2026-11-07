import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { setTemporaryPass, clearTemporaryPass } from '~/server/utils/intercedeOptOuts'
import { applyActivePasses } from '~/server/utils/intercedePasses'
import { serializeIntercedeClaim } from '~/server/utils/intercedeClaims'

interface IntercedePassBody {
  /** The player's tamer entity id — the same owner id as `pendingRequests[].targetTamerId`. */
  ownerId: string
  /** 'start' = "Pass until my next turn"; 'resume' = "Resume prompting". */
  action: 'start' | 'resume'
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedePassBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body?.ownerId || typeof body.ownerId !== 'string') {
    throw createError({ statusCode: 400, message: 'ownerId is required' })
  }
  if (body.action !== 'start' && body.action !== 'resume') {
    throw createError({ statusCode: 400, message: "action must be 'start' or 'resume'" })
  }

  // Same queue as claims, Skip and opt-outs: the pass and every offer it answers are applied
  // between decisions, never in the middle of one.
  return serializeIntercedeClaim(encounterId, () => changePass(encounterId, body))
})

async function changePass(encounterId: string, body: IntercedePassBody) {
  if (body.action === 'start') {
    await setTemporaryPass(encounterId, body.ownerId)
    // Offers already waiting go through the Skip flow now; later ones are answered as they are created.
    await applyActivePasses(encounterId)
  } else {
    await clearTemporaryPass(encounterId, body.ownerId)
  }

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }
  return updated
}
