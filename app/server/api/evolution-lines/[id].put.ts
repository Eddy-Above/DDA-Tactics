import { eq } from 'drizzle-orm'
import { db, evolutionLines } from '../../db'
import type { EvolutionLine } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Evolution line ID is required',
    })
  }

  const body = await readBody<Partial<EvolutionLine>>(event)

  // Check if evolution line exists
  const [existing] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  // Parse existing chain once for validation
  const existingChainData = typeof existing.chain === 'string'
    ? JSON.parse(existing.chain)
    : existing.chain
  const existingChain = existingChainData as any[]

  // Validate chain if it's being updated
  if (body.chain) {
    const chain = body.chain as any[]

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
  const updateData = {
    ...body,
    // Explicitly stringify chain if it's being updated
    ...(body.chain ? { chain: JSON.stringify(body.chain) } : {}),
    updatedAt: new Date(),
  }

  await db.update(evolutionLines).set(updateData).where(eq(evolutionLines.id, id))

  // Return updated evolution line with parsed chain
  const [updated] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  // Always return with parsed chain
  return {
    ...updated,
    chain: body.chain || (typeof updated.chain === 'string' ? JSON.parse(updated.chain) : updated.chain),
  }
})
