import type { EvolutionLine } from '../server/db/schema'
import type { DigimonStage } from '../types'

export interface EvolutionChainEntry {
  stage: DigimonStage
  species: string
  digimonId: string // Required: must link to library Digimon
  isUnlocked: boolean // GM-controlled unlock state
  evolvesFromIndex: number | null // Index of parent form (null for root)
}

export interface CreateEvolutionLineData {
  name: string
  description?: string
  chain: EvolutionChainEntry[] // All entries must have valid digimonId
  partnerId?: string
}

export function useEvolution() {
  const evolutionLines = ref<EvolutionLine[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchEvolutionLines(partnerId?: string) {
    loading.value = true
    error.value = null
    try {
      const query = partnerId ? `?partnerId=${partnerId}` : ''
      evolutionLines.value = await $fetch<EvolutionLine[]>(`/api/evolution-lines${query}`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch evolution lines'
      console.error('Failed to fetch evolution lines:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchEvolutionLine(id: string): Promise<EvolutionLine | null> {
    loading.value = true
    error.value = null
    try {
      return await $fetch<EvolutionLine>(`/api/evolution-lines/${id}`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch evolution line'
      console.error('Failed to fetch evolution line:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createEvolutionLine(data: CreateEvolutionLineData): Promise<EvolutionLine | null> {
    loading.value = true
    error.value = null
    try {
      const newLine = await $fetch<EvolutionLine>('/api/evolution-lines', {
        method: 'POST',
        body: data,
      })
      evolutionLines.value = [...evolutionLines.value, newLine]
      return newLine
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create evolution line'
      console.error('Failed to create evolution line:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateEvolutionLine(id: string, data: Partial<EvolutionLine>): Promise<EvolutionLine | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<EvolutionLine>(`/api/evolution-lines/${id}`, {
        method: 'PUT',
        body: data,
      })
      evolutionLines.value = evolutionLines.value.map((l) => (l.id === id ? updated : l))
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update evolution line'
      console.error('Failed to update evolution line:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteEvolutionLine(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/evolution-lines/${id}`, { method: 'DELETE' })
      evolutionLines.value = evolutionLines.value.filter((l) => l.id !== id)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete evolution line'
      console.error('Failed to delete evolution line:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  // Evolve to specific target stage (must be child of current stage)
  async function evolve(evolutionLineId: string, targetIndex?: number): Promise<EvolutionLine | null> {
    // Try to find in the list array first
    let line = evolutionLines.value.find((l) => l.id === evolutionLineId)

    // If not found, fetch it directly
    if (!line) {
      line = await fetchEvolutionLine(evolutionLineId)
      if (!line) return null
    }

    // Parse chain from JSON if needed
    const chainData = typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain
    const chain = chainData as EvolutionChainEntry[]
    const currentIndex = line.currentStageIndex

    // Find all unlocked children of current form
    const children = chain
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.evolvesFromIndex === currentIndex && entry.isUnlocked)

    if (children.length === 0) {
      error.value = 'No unlocked evolution paths available'
      return null
    }

    // If targetIndex specified, use it; otherwise use first child
    const target = targetIndex !== undefined
      ? children.find(({ index }) => index === targetIndex)
      : children[0]

    if (!target) {
      error.value = 'Invalid evolution target'
      return null
    }

    // Evolution successful - set to target stage
    return updateEvolutionLine(evolutionLineId, {
      currentStageIndex: target.index,
    })
  }

  // Devolve to parent form
  async function devolve(evolutionLineId: string): Promise<EvolutionLine | null> {
    // Try to find in the list array first
    let line = evolutionLines.value.find((l) => l.id === evolutionLineId)

    // If not found, fetch it directly
    if (!line) {
      line = await fetchEvolutionLine(evolutionLineId)
      if (!line) return null
    }

    // Parse chain from JSON if needed
    const chainData = typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain
    const chain = chainData as EvolutionChainEntry[]
    const currentEntry = chain[line.currentStageIndex]

    if (currentEntry.evolvesFromIndex === null) {
      error.value = 'Already at base form'
      return null
    }

    return updateEvolutionLine(evolutionLineId, {
      currentStageIndex: currentEntry.evolvesFromIndex,
    })
  }

  // Lock/unlock a stage
  async function toggleStageLock(
    evolutionLineId: string,
    stageIndex: number,
    isUnlocked: boolean
  ): Promise<EvolutionLine | null> {
    // Try to find in the list array first
    let line = evolutionLines.value.find((l) => l.id === evolutionLineId)

    // If not found, fetch it directly
    if (!line) {
      line = await fetchEvolutionLine(evolutionLineId)
      if (!line) return null
    }

    // Parse chain from JSON if needed
    const chainData = typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain
    const chain = [...(chainData as EvolutionChainEntry[])]
    if (stageIndex < 0 || stageIndex >= chain.length) return null

    // First stage must always be unlocked
    if (stageIndex === 0 && !isUnlocked) {
      error.value = 'First stage must always be unlocked'
      return null
    }

    chain[stageIndex] = { ...chain[stageIndex], isUnlocked }
    return updateEvolutionLine(evolutionLineId, { chain })
  }

  // Set the current form
  async function setCurrentForm(
    evolutionLineId: string,
    stageIndex: number
  ): Promise<EvolutionLine | null> {
    const line = evolutionLines.value.find((l) => l.id === evolutionLineId)
    if (!line) return null

    // Parse chain from JSON if needed
    const chainData = typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain
    const chain = chainData as EvolutionChainEntry[]
    if (stageIndex < 0 || stageIndex >= chain.length) return null

    // Can only set to unlocked stages
    if (!chain[stageIndex].isUnlocked) {
      error.value = 'Cannot set locked stage as current form'
      return null
    }

    return updateEvolutionLine(evolutionLineId, { currentStageIndex: stageIndex })
  }

  // Get current stage info
  function getCurrentStage(evolutionLine: EvolutionLine): EvolutionChainEntry | null {
    const chainData = typeof evolutionLine.chain === 'string' ? JSON.parse(evolutionLine.chain) : evolutionLine.chain
    const chain = chainData as EvolutionChainEntry[]
    return chain[evolutionLine.currentStageIndex] || null
  }

  // Get next stage options (may be multiple for branching)
  function getNextStageOptions(evolutionLine: EvolutionLine): EvolutionChainEntry[] {
    return getEvolutionOptions(evolutionLine)
  }

  // Link a Digimon sheet to a chain entry
  async function linkDigimonToChainEntry(
    evolutionLineId: string,
    chainIndex: number,
    digimonId: string | null
  ): Promise<EvolutionLine | null> {
    const line = evolutionLines.value.find((l) => l.id === evolutionLineId)
    if (!line) {
      // Try fetching it
      const fetchedLine = await fetchEvolutionLine(evolutionLineId)
      if (!fetchedLine) return null
      const chainData = typeof fetchedLine.chain === 'string' ? JSON.parse(fetchedLine.chain) : fetchedLine.chain
      const chain = [...(chainData as EvolutionChainEntry[])]
      if (chainIndex < 0 || chainIndex >= chain.length) return null
      chain[chainIndex] = { ...chain[chainIndex], digimonId }
      return updateEvolutionLine(evolutionLineId, { chain })
    }

    const chainData = typeof line.chain === 'string' ? JSON.parse(line.chain) : line.chain
    const chain = [...(chainData as EvolutionChainEntry[])]
    if (chainIndex < 0 || chainIndex >= chain.length) return null

    chain[chainIndex] = { ...chain[chainIndex], digimonId }
    return updateEvolutionLine(evolutionLineId, { chain })
  }

  // Get available evolution options from current form
  function getEvolutionOptions(evolutionLine: EvolutionLine): EvolutionChainEntry[] {
    const chainData = typeof evolutionLine.chain === 'string' ? JSON.parse(evolutionLine.chain) : evolutionLine.chain
    const chain = chainData as EvolutionChainEntry[]
    const currentIndex = evolutionLine.currentStageIndex

    // Find all unlocked children of current form
    return chain.filter(
      (entry) => entry.evolvesFromIndex === currentIndex && entry.isUnlocked
    )
  }

  // Check if can evolve
  function canEvolve(evolutionLine: EvolutionLine): { canEvolve: boolean; reason: string } {
    const options = getEvolutionOptions(evolutionLine)

    if (options.length === 0) {
      return { canEvolve: false, reason: 'No unlocked evolution paths' }
    }

    return { canEvolve: true, reason: `${options.length} evolution option(s) available` }
  }

  // Refresh chain from library
  async function refreshChainFromLibrary(evolutionLineId: string): Promise<EvolutionLine | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<EvolutionLine>(`/api/evolution-lines/${evolutionLineId}/refresh`, {
        method: 'POST',
      })
      // Update the list if it exists
      const index = evolutionLines.value.findIndex((l) => l.id === evolutionLineId)
      if (index >= 0) {
        evolutionLines.value[index] = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to refresh evolution chain'
      console.error('Failed to refresh evolution chain:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    evolutionLines,
    loading,
    error,
    fetchEvolutionLines,
    fetchEvolutionLine,
    createEvolutionLine,
    updateEvolutionLine,
    deleteEvolutionLine,
    evolve,
    devolve,
    toggleStageLock,
    setCurrentForm,
    getCurrentStage,
    getNextStageOptions,
    getEvolutionOptions,
    canEvolve,
    linkDigimonToChainEntry,
    refreshChainFromLibrary,
  }
}
