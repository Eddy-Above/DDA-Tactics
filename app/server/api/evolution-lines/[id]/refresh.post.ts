import { entityWrite } from '../../../utils/entitySecurity'
import { requireEntityAccess, requireLinkedEntity, filterReadableEntities, entityCampaignId } from '../../../utils/entitySecurity'
import { eq } from 'drizzle-orm'
import { db, evolutionLines, digimon as digimonTable, type EvolutionLine, type Digimon } from '../../../db'
import { requireEvolutionGmFields } from '../../../utils/libraryGmFields'

type EvolutionChainEntry = EvolutionLine['chain'][number]

export default defineEventHandler(async (event) => entityWrite(async () => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Evolution line ID is required',
    })
  }

  // Get existing evolution line
  const [existing] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id)).for('update')

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Evolution line with ID ${id} not found`,
    })
  }

  await requireEntityAccess(event, 'evolution-line', existing, true)
  const scope = await entityCampaignId('evolution-line', existing)

  const existingChain = existing.chain

  // Build map of existing lock states
  const lockStates = new Map<string, boolean>()
  existingChain.forEach((entry: EvolutionChainEntry) => {
    lockStates.set(entry.digimonId, entry.isUnlocked)
  })

  // Get all library Digimon
  const allDigimon = await filterReadableEntities(event, await db.select().from(digimonTable), 'digimon')

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

  function buildForwardChain(digimon: Digimon, parentIndex: number | null) {
    if (visited.has(digimon.id)) return

    visited.add(digimon.id)

    const currentIndex = newChain.length
    const wasUnlocked = lockStates.get(digimon.id)

    newChain.push({
      stage: digimon.stage,
      species: digimon.name,
      digimonId: digimon.id,
      isUnlocked: wasUnlocked !== undefined ? wasUnlocked : (parentIndex === null), // Preserve state or unlock root
      evolvesFromIndex: parentIndex,
    })

    const evolutionPathIds: string[] = digimon.evolutionPathIds || []

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

  await requireEvolutionGmFields(event, scope, { chain: newChain }, existing)
  for (const entry of newChain) await requireLinkedEntity(event, 'digimon', entry.digimonId, scope)

  // Update evolution line with new chain
  const updateData = {
    chain: newChain,
    updatedAt: new Date(),
  }

  await db.update(evolutionLines).set(updateData).where(eq(evolutionLines.id, id))

  // Return updated evolution line
  const [updated] = await db.select().from(evolutionLines).where(eq(evolutionLines.id, id))

  return {
    ...updated,
    chain: newChain,
  }
}))
