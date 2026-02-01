import { eq } from 'drizzle-orm'
import { db, evolutionLines, digimon as digimonTable } from '../../../db'

interface EvolutionChainEntry {
  stage: string
  species: string
  digimonId: string
  isUnlocked: boolean
  evolvesFromIndex: number | null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Evolution line ID is required',
    })
  }

  // Get existing evolution line
  const [existing] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  // Parse existing chain
  const existingChain = typeof existing.chain === 'string'
    ? JSON.parse(existing.chain)
    : existing.chain

  // Build map of existing lock states
  const lockStates = new Map<string, boolean>()
  existingChain.forEach((entry: EvolutionChainEntry) => {
    lockStates.set(entry.digimonId, entry.isUnlocked)
  })

  // Get all library Digimon
  const allDigimon = await db.select().from(digimonTable)

  // Find root Digimon from existing chain
  const rootEntry = existingChain.find((e: EvolutionChainEntry) => e.evolvesFromIndex === null)
  if (!rootEntry) {
    throw createError({
      statusCode: 400,
      message: 'No root found in existing chain',
    })
  }

  const rootDigimon = allDigimon.find((d) => d.id === rootEntry.digimonId)
  if (!rootDigimon) {
    throw createError({
      statusCode: 404,
      message: 'Root Digimon no longer exists in library',
    })
  }

  // Rebuild chain from library
  const newChain: EvolutionChainEntry[] = []
  const visited = new Set<string>()

  function buildForwardChain(digimon: any, parentIndex: number | null) {
    if (visited.has(digimon.id)) return

    visited.add(digimon.id)

    const currentIndex = newChain.length
    const wasUnlocked = lockStates.get(digimon.id)

    newChain.push({
      stage: digimon.stage,
      species: digimon.species,
      digimonId: digimon.id,
      isUnlocked: wasUnlocked !== undefined ? wasUnlocked : (parentIndex === null), // Preserve state or unlock root
      evolvesFromIndex: parentIndex,
    })

    // Parse evolutionPathIds (forward links)
    let evolutionPathIds: string[] = []
    if (digimon.evolutionPathIds) {
      if (typeof digimon.evolutionPathIds === 'string') {
        try {
          evolutionPathIds = JSON.parse(digimon.evolutionPathIds)
        } catch {
          evolutionPathIds = []
        }
      } else if (Array.isArray(digimon.evolutionPathIds)) {
        evolutionPathIds = digimon.evolutionPathIds
      }
    }

    // Also find any Digimon that evolve FROM this one (backward links)
    const childrenByEvolvesFrom = allDigimon.filter((d) => d.evolvesFromId === digimon.id)

    // Combine forward links and backward links
    const allChildren = new Set([
      ...evolutionPathIds,
      ...childrenByEvolvesFrom.map((d) => d.id),
    ])

    // Recursively add all evolution paths
    allChildren.forEach((evolutionId) => {
      const nextDigimon = allDigimon.find((d) => d.id === evolutionId)
      if (nextDigimon) {
        buildForwardChain(nextDigimon, currentIndex)
      }
    })
  }

  buildForwardChain(rootDigimon, null)

  // Update evolution line with new chain
  const updateData = {
    chain: JSON.stringify(newChain),
    updatedAt: new Date(),
  }

  await db.update(evolutionLines).set(updateData).where(eq(evolutionLines.id, id))

  // Return updated evolution line
  const [updated] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  return {
    ...updated,
    chain: newChain,
  }
})
