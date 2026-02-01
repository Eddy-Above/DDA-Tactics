import { eq, inArray } from 'drizzle-orm'
import { db, digimon, type Digimon } from '../../db'
import { parseDigimonData } from '../../utils/parsers'

type UpdateDigimonBody = Partial<Omit<Digimon, 'id' | 'createdAt' | 'updatedAt'>> & {
  syncBonusDP?: boolean // Whether to sync bonusDP to all linked evolution forms
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateDigimonBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Digimon ID is required',
    })
  }

  // Check if digimon exists
  const [existing] = await db.select().from(digimon).where(eq(digimon.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Digimon with ID ${id} not found`,
    })
  }

  // Two-way sync for evolution links
  const now = new Date()

  // Handle evolutionPathIds changes (evolves to)
  if (body.evolutionPathIds !== undefined) {
    // Parse evolutionPathIds from existing (stored as JSON string in DB)
    let oldPaths: string[] = []
    if (typeof existing.evolutionPathIds === 'string') {
      try {
        oldPaths = JSON.parse(existing.evolutionPathIds) || []
      } catch {
        oldPaths = []
      }
    } else {
      oldPaths = existing.evolutionPathIds || []
    }

    const newPaths = body.evolutionPathIds || []

    // Find removed IDs (were in old, not in new)
    const removedIds = oldPaths.filter((pathId) => !newPaths.includes(pathId))
    // Find added IDs (in new, not in old)
    const addedIds = newPaths.filter((pathId) => !oldPaths.includes(pathId))

    // For removed IDs: clear their evolvesFromId if it points to this Digimon
    if (removedIds.length > 0) {
      const removedDigimon = await db.select().from(digimon).where(inArray(digimon.id, removedIds))
      for (const d of removedDigimon) {
        if (d.evolvesFromId === id) {
          await db.update(digimon).set({ evolvesFromId: null, updatedAt: now }).where(eq(digimon.id, d.id))
        }
      }
    }

    // For added IDs: set their evolvesFromId to this Digimon
    if (addedIds.length > 0) {
      await db.update(digimon).set({ evolvesFromId: id, updatedAt: now }).where(inArray(digimon.id, addedIds))
    }
  }

  // Handle evolvesFromId changes (evolves from)
  if (body.evolvesFromId !== undefined && body.evolvesFromId !== existing.evolvesFromId) {
    const oldFromId = existing.evolvesFromId
    const newFromId = body.evolvesFromId

    // Remove this ID from old parent's evolutionPathIds
    if (oldFromId) {
      const [oldParent] = await db.select().from(digimon).where(eq(digimon.id, oldFromId))
      if (oldParent) {
        // Parse evolutionPathIds from oldParent (stored as JSON string in DB)
        let oldParentPaths: string[] = []
        if (typeof oldParent.evolutionPathIds === 'string') {
          try {
            oldParentPaths = JSON.parse(oldParent.evolutionPathIds) || []
          } catch {
            oldParentPaths = []
          }
        } else {
          oldParentPaths = oldParent.evolutionPathIds || []
        }

        const updatedPaths = oldParentPaths.filter((pathId) => pathId !== id)
        await db.update(digimon).set({ evolutionPathIds: JSON.stringify(updatedPaths), updatedAt: now }).where(eq(digimon.id, oldFromId))
      }
    }

    // Add this ID to new parent's evolutionPathIds
    if (newFromId) {
      const [newParent] = await db.select().from(digimon).where(eq(digimon.id, newFromId))
      if (newParent) {
        // Parse evolutionPathIds from newParent (stored as JSON string in DB)
        let newParentPaths: string[] = []
        if (typeof newParent.evolutionPathIds === 'string') {
          try {
            newParentPaths = JSON.parse(newParent.evolutionPathIds) || []
          } catch {
            newParentPaths = []
          }
        } else {
          newParentPaths = newParent.evolutionPathIds || []
        }

        const updatedPaths = [...newParentPaths, id]
        // Avoid duplicates
        const uniquePaths = [...new Set(updatedPaths)]
        await db.update(digimon).set({ evolutionPathIds: JSON.stringify(uniquePaths), updatedAt: now }).where(eq(digimon.id, newFromId))
      }
    }
  }

  // Sync bonusDP across all linked evolution forms if requested
  if (body.syncBonusDP && (body.bonusDP !== undefined || body.bonusStats !== undefined || body.bonusDPForQualities !== undefined)) {
    const linkedIds = await collectAllLinkedDigimon(id, existing)

    if (linkedIds.length > 0) {
      const dpUpdate: Record<string, unknown> = { updatedAt: now }
      if (body.bonusDP !== undefined) dpUpdate.bonusDP = body.bonusDP
      if (body.bonusStats !== undefined) dpUpdate.bonusStats = JSON.stringify(body.bonusStats)
      if (body.bonusDPForQualities !== undefined) dpUpdate.bonusDPForQualities = body.bonusDPForQualities

      await db.update(digimon).set(dpUpdate).where(inArray(digimon.id, linkedIds))
    }
  }

  // Update digimon (remove syncBonusDP from body as it's not a DB field)
  const { syncBonusDP: _, ...updateFields } = body
  const updateData: any = {
    ...updateFields,
    updatedAt: now,
  }

  console.log('[PUT /api/digimon/:id] Received qualities:', { id, qualitiesCount: body.qualities?.length, qualities: body.qualities })

  // Stringify JSON fields for storage
  if (updateData.baseStats !== undefined) updateData.baseStats = JSON.stringify(updateData.baseStats)
  if (updateData.attacks !== undefined) updateData.attacks = JSON.stringify(updateData.attacks)
  if (updateData.qualities !== undefined) updateData.qualities = JSON.stringify(updateData.qualities)
  if (updateData.bonusStats !== undefined) updateData.bonusStats = JSON.stringify(updateData.bonusStats)
  if (updateData.evolutionPathIds !== undefined) updateData.evolutionPathIds = JSON.stringify(updateData.evolutionPathIds)

  await db.update(digimon).set(updateData).where(eq(digimon.id, id))

  // Return updated digimon
  const [updated] = await db.select().from(digimon).where(eq(digimon.id, id))
  return parseDigimonData(updated)
})

// Helper to collect all linked Digimon IDs (ancestors and descendants)
async function collectAllLinkedDigimon(currentId: string, current: Digimon): Promise<string[]> {
  const linkedIds: string[] = []
  const visited = new Set<string>([currentId])

  // Collect ancestors (follow evolvesFromId chain)
  let ancestorId = current.evolvesFromId
  while (ancestorId && !visited.has(ancestorId)) {
    visited.add(ancestorId)
    linkedIds.push(ancestorId)
    const [ancestor] = await db.select().from(digimon).where(eq(digimon.id, ancestorId))
    if (ancestor) {
      ancestorId = ancestor.evolvesFromId
    } else {
      break
    }
  }

  // Collect descendants (follow evolutionPathIds recursively)
  async function collectDescendants(ids: string[]) {
    for (const id of ids) {
      if (visited.has(id)) continue
      visited.add(id)
      linkedIds.push(id)
      const [descendant] = await db.select().from(digimon).where(eq(digimon.id, id))
      if (descendant) {
        // Parse evolutionPathIds from descendant (stored as JSON string in DB)
        let descendantPaths: string[] = []
        if (typeof descendant.evolutionPathIds === 'string') {
          try {
            descendantPaths = JSON.parse(descendant.evolutionPathIds) || []
          } catch {
            descendantPaths = []
          }
        } else {
          descendantPaths = descendant.evolutionPathIds || []
        }

        if (descendantPaths.length) {
          await collectDescendants(descendantPaths)
        }
      }
    }
  }

  // Parse evolutionPathIds from current (stored as JSON string in DB)
  let currentPaths: string[] = []
  if (typeof current.evolutionPathIds === 'string') {
    try {
      currentPaths = JSON.parse(current.evolutionPathIds) || []
    } catch {
      currentPaths = []
    }
  } else {
    currentPaths = current.evolutionPathIds || []
  }

  if (currentPaths.length) {
    await collectDescendants(currentPaths)
  }

  return linkedIds
}
