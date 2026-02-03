import type { Digimon } from '../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize, type DigimonFamily } from '../types'

// Extended type for update requests with sync option
export type UpdateDigimonData = Partial<Digimon> & {
  syncBonusDP?: boolean
}

// Tree node structure for evolution chain display
export interface EvolutionTreeNode {
  digimon: Digimon
  children: EvolutionTreeNode[]
}

export interface CreateDigimonData {
  name: string
  species: string
  stage: DigimonStage
  attribute: 'vaccine' | 'data' | 'virus' | 'free'
  family: DigimonFamily
  type?: string
  size: DigimonSize
  baseStats: {
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }
  attacks?: Digimon['attacks']
  qualities?: Digimon['qualities']
  dataOptimization?: string
  bonusDP?: number
  partnerId?: string
  isEnemy?: boolean
  notes?: string
  spriteUrl?: string
}

export function useDigimon() {
  const digimonList = ref<Digimon[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchDigimon(filters?: { partnerId?: string; isEnemy?: boolean }) {
    loading.value = true
    error.value = null
    try {
      const query = new URLSearchParams()
      if (filters?.partnerId) query.set('partnerId', filters.partnerId)
      if (filters?.isEnemy !== undefined) query.set('isEnemy', String(filters.isEnemy))

      const url = query.toString() ? `/api/digimon?${query}` : '/api/digimon'
      digimonList.value = await $fetch<Digimon[]>(url)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch digimon'
      console.error('Failed to fetch digimon:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchDigimonById(id: string): Promise<Digimon | null> {
    loading.value = true
    error.value = null
    try {
      return await $fetch<Digimon>(`/api/digimon/${id}`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch digimon'
      console.error('Failed to fetch digimon:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createDigimon(data: CreateDigimonData): Promise<Digimon | null> {
    loading.value = true
    error.value = null
    try {
      const newDigimon = await $fetch<Digimon>('/api/digimon', {
        method: 'POST',
        body: data,
      })
      digimonList.value = [...digimonList.value, newDigimon]
      return newDigimon
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create digimon'
      console.error('Failed to create digimon:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateDigimon(id: string, data: UpdateDigimonData): Promise<Digimon | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<Digimon>(`/api/digimon/${id}`, {
        method: 'PUT',
        body: data,
      })
      digimonList.value = digimonList.value.map((d) => (d.id === id ? updated : d))
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update digimon'
      console.error('Failed to update digimon:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteDigimon(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/digimon/${id}`, { method: 'DELETE' })
      digimonList.value = digimonList.value.filter((d) => d.id !== id)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete digimon'
      console.error('Failed to delete digimon:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function copyDigimon(digimon: Digimon): Promise<Digimon | null> {
    const copyData: CreateDigimonData = {
      name: `Copy of ${digimon.name}`,
      species: digimon.species,
      stage: digimon.stage as DigimonStage,
      attribute: digimon.attribute as 'vaccine' | 'data' | 'virus' | 'free',
      family: digimon.family,
      type: digimon.type || undefined,
      size: digimon.size as DigimonSize,
      baseStats: { ...digimon.baseStats },
      attacks: digimon.attacks ? [...digimon.attacks] : [],
      qualities: digimon.qualities ? [...digimon.qualities] : [],
      dataOptimization: digimon.dataOptimization || undefined,
      bonusDP: digimon.bonusDP || 0,
      partnerId: digimon.partnerId || undefined,
      isEnemy: digimon.isEnemy,
      notes: digimon.notes || undefined,
      spriteUrl: digimon.spriteUrl || undefined,
    }
    return createDigimon(copyData)
  }

  // Calculate derived stats from base stats, stage, and size (DDA 1.4 page 111)
  function calculateDerivedStats(digimon: Digimon) {
    const { baseStats, stage, size } = digimon
    const bonusStats = (digimon as any).bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }
    const stageConfig = STAGE_CONFIG[stage as DigimonStage]
    const sizeConfig = SIZE_CONFIG[size as DigimonSize] || SIZE_CONFIG['medium']

    // Total stats = base + bonus
    const totalStats = {
      accuracy: baseStats.accuracy + (bonusStats.accuracy || 0),
      damage: baseStats.damage + (bonusStats.damage || 0),
      dodge: baseStats.dodge + (bonusStats.dodge || 0),
      armor: baseStats.armor + (bonusStats.armor || 0),
      health: baseStats.health + (bonusStats.health || 0),
    }

    // Primary Derived Stats (always round down)
    // Size affects Body and Agility differently (page 110)
    const brains = Math.floor(totalStats.accuracy / 2) + stageConfig.brainsBonus
    const body = Math.max(0, Math.floor((totalStats.health + totalStats.damage + totalStats.armor) / 3) + sizeConfig.bodyBonus)
    const agility = Math.max(0, Math.floor((totalStats.accuracy + totalStats.dodge) / 2) + sizeConfig.agilityBonus)

    // Spec Values (derived from derived stats)
    const bit = Math.floor(brains / 10) + stageConfig.stageBonus
    const cpu = Math.floor(body / 10) + stageConfig.stageBonus
    const ram = Math.floor(agility / 10) + stageConfig.stageBonus

    // Calculate movement with all modifiers
    const qualities = (digimon as any).qualities || []
    const stageBaseMovement = stageConfig.movement

    // Calculate effective base movement (after base movement modifiers)
    let effectiveBase = stageBaseMovement

    // Data Optimization modifiers
    const dataOpt = qualities.find((q: any) => q.id === 'data-optimization')
    if (dataOpt?.choiceId === 'speed-striker') effectiveBase += 2
    if (dataOpt?.choiceId === 'guardian') effectiveBase -= 1

    // Data Specialization modifiers
    const dataSpec = qualities.find((q: any) => q.id === 'data-specialization')
    if (dataSpec?.choiceId === 'mobile-artillery') effectiveBase -= 1

    // Negative quality modifiers
    const bulky = qualities.find((q: any) => q.id === 'bulky')
    if (bulky) effectiveBase -= (bulky.ranks || 0) * 3

    // Boosting quality modifiers
    const instinct = qualities.find((q: any) => q.id === 'instinct')
    if (instinct) effectiveBase += instinct.ranks || 0

    // Ensure minimum effective base of 1
    effectiveBase = Math.max(1, effectiveBase)

    // Apply Speedy bonus (capped at 2x or 3x effective base with Advanced Movement)
    const hasAdvMovement = qualities.some(
      (q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-movement'
    )
    const speedyMaxMultiplier = hasAdvMovement ? 3 : 2
    const speedyCap = effectiveBase * speedyMaxMultiplier
    const speedyQuality = qualities.find((q: any) => q.id === 'speedy')
    const speedyRanks = speedyQuality?.ranks || 0
    const speedyBonus = Math.min(speedyRanks * 2, speedyCap)

    const movement = effectiveBase + speedyBonus

    return {
      brains,
      body,
      agility,
      woundBoxes: totalStats.health + stageConfig.woundBonus,
      bit,
      cpu,
      ram,
      movement,
      stageBonus: stageConfig.stageBonus,
    }
  }

  // Roll initiative for a digimon (3d6 + Agility)
  function rollInitiative(digimon: Digimon): { total: number; roll: number } {
    const derived = calculateDerivedStats(digimon)
    const roll =
      Math.floor(Math.random() * 6) + 1 +
      Math.floor(Math.random() * 6) + 1 +
      Math.floor(Math.random() * 6) + 1
    return {
      roll,
      total: roll + derived.agility,
    }
  }

  // Get stage configuration
  function getStageConfig(stage: DigimonStage) {
    return STAGE_CONFIG[stage]
  }

  // Fetch Digimon filtered by stage
  async function fetchDigimonByStage(stage: DigimonStage): Promise<Digimon[]> {
    try {
      return await $fetch<Digimon[]>(`/api/digimon?stage=${stage}`)
    } catch (e) {
      console.error('Failed to fetch digimon by stage:', e)
      return []
    }
  }

  // Stage order for navigation
  const STAGE_ORDER: DigimonStage[] = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega', 'ultra']

  // Get the previous stage (for "evolves from" filter)
  function getPreviousStages(stage: DigimonStage): DigimonStage[] {
    const index = STAGE_ORDER.indexOf(stage)
    if (index <= 0) return []
    // Return all stages before the current one
    return STAGE_ORDER.slice(0, index)
  }

  // Get the next stages (for "evolves to" filter)
  function getNextStages(stage: DigimonStage): DigimonStage[] {
    const index = STAGE_ORDER.indexOf(stage)
    if (index < 0 || index >= STAGE_ORDER.length - 1) return []
    // Return all stages after the current one
    return STAGE_ORDER.slice(index + 1)
  }

  // Build evolution chain for display (recursive for full chain)
  function getEvolutionChain(
    digimon: Digimon,
    allDigimon: Digimon[]
  ): { ancestors: Digimon[]; current: Digimon; descendants: Digimon[]; descendantsTree: EvolutionTreeNode[] } {
    const ancestors: Digimon[] = []
    const descendants: Digimon[] = []

    // Find ancestors (follow evolvesFromId chain)
    let currentAncestor = digimon.evolvesFromId
      ? allDigimon.find((d) => d.id === digimon.evolvesFromId)
      : null
    while (currentAncestor) {
      ancestors.unshift(currentAncestor)
      currentAncestor = currentAncestor.evolvesFromId
        ? allDigimon.find((d) => d.id === currentAncestor!.evolvesFromId)
        : null
    }

    // Recursively build descendants tree (preserves hierarchy)
    function buildDescendantsTree(parent: Digimon, visited: Set<string>): EvolutionTreeNode[] {
      const nodes: EvolutionTreeNode[] = []
      for (const pathId of parent.evolutionPathIds || []) {
        if (visited.has(pathId)) continue
        const descendant = allDigimon.find((d) => d.id === pathId)
        if (descendant) {
          visited.add(pathId)
          descendants.push(descendant) // Keep flat array for backward compatibility
          nodes.push({
            digimon: descendant,
            children: buildDescendantsTree(descendant, visited),
          })
        }
      }
      return nodes
    }

    const visited = new Set<string>()
    const descendantsTree = buildDescendantsTree(digimon, visited)

    return { ancestors, current: digimon, descendants, descendantsTree }
  }

  return {
    digimonList,
    loading,
    error,
    fetchDigimon,
    fetchDigimonById,
    fetchDigimonByStage,
    createDigimon,
    updateDigimon,
    deleteDigimon,
    copyDigimon,
    calculateDerivedStats,
    rollInitiative,
    getStageConfig,
    getPreviousStages,
    getNextStages,
    getEvolutionChain,
  }
}
