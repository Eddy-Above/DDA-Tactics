import { entityWrite } from '../../utils/entitySecurity'
import { requireEntityAccess, requireLinkedEntity, entityCampaignId } from '../../utils/entitySecurity'
import { tableWriteBody } from '../../utils/securityValidation'
import { eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'
import type { EvolutionLine } from '../../db/schema'
import { requireEvolutionGmFields } from '../../utils/libraryGmFields'

export default defineEventHandler(async (event) => entityWrite(async () => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Evolution line ID is required',
    })
  }

  let body = await readBody<Partial<EvolutionLine>>(event)

  // Check if evolution line exists
  const [existing] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id)).for('update')

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  await requireEntityAccess(event, 'evolution-line', existing, true)
  body = tableWriteBody(body, evolutionLines, existing) as Partial<EvolutionLine>
  const scope = await entityCampaignId('evolution-line', existing)
  await requireEvolutionGmFields(event, scope, body, existing)
  if (body.partnerId !== undefined) await requireLinkedEntity(event, 'tamer', body.partnerId, scope)
  for (const entry of body.chain ?? existing.chain) await requireLinkedEntity(event, 'digimon', entry.digimonId, scope)

  const existingChain = existing.chain

  // Validate chain if it's being updated
  if (body.chain) {
    const chain = body.chain

    // All entries must have valid digimonId
    if (chain.some((entry) => !entry.digimonId)) {
      throw createError({
        statusCode: 400,
        message: 'All chain entries must be linked to a Digimon',
      })
    }

    // Ensure first stage is always unlocked
    if (chain[0] && !chain[0].isUnlocked) {
      throw createError({
        statusCode: 400,
        message: 'First stage must always be unlocked',
      })
    }
  }

  // Validate currentStageIndex if it's being updated
  if (body.currentStageIndex !== undefined) {
    const chain = body.chain || existingChain
    if (body.currentStageIndex < 0 || body.currentStageIndex >= chain.length) {
      throw createError({
        statusCode: 400,
        message: 'Current stage index out of range',
      })
    }

    // Ensure current stage is unlocked
    if (!chain[body.currentStageIndex].isUnlocked) {
      throw createError({
        statusCode: 400,
        message: 'Cannot set locked stage as current form',
      })
    }
  }

  // Update evolution line
  const updateData: Partial<EvolutionLine> = {
    ...body,
    updatedAt: new Date(),
  }

  await db.update(evolutionLines).set(updateData).where(eq(evolutionLines.id, id))

  // Return updated evolution line
  const [updated] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  return updated
}))
