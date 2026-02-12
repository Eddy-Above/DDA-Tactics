import type { Encounter } from '../server/db/schema'
import type { Digimon } from '../server/db/schema'
import type { Tamer } from '../server/db/schema'

export interface CombatParticipant {
  id: string
  type: 'tamer' | 'digimon'
  entityId: string
  initiative: number
  initiativeRoll: number
  actionsRemaining: { simple: number }
  currentStance: 'neutral' | 'defensive' | 'offensive' | 'sniper' | 'brave'
  activeEffects: Array<{
    id: string
    name: string
    type: 'buff' | 'debuff' | 'status'
    duration: number
    source: string
    description: string
  }>
  isActive: boolean
  hasActed: boolean
  currentWounds: number
  maxWounds: number
  usedAttackIds?: string[]
}

export interface BattleLogEntry {
  id: string
  timestamp: string
  round: number
  actorId: string
  actorName: string
  action: string
  target: string | null
  result: string
  damage: number | null
  effects: string[]

  // Damage calculation breakdown fields (optional for backward compatibility)
  baseDamage?: number
  netSuccesses?: number
  targetArmor?: number
  armorPiercing?: number
  effectiveArmor?: number
  finalDamage?: number
  hit?: boolean
}

export interface Hazard {
  id: string
  name: string
  description: string
  effect: string
  affectedArea: string
  duration: number | null
}

export function useEncounters() {
  const encounters = ref<Encounter[]>([])
  const currentEncounter = ref<Encounter | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchEncounters() {
    loading.value = true
    error.value = null
    try {
      encounters.value = await $fetch<Encounter[]>('/api/encounters')
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch encounters'
      console.error('Failed to fetch encounters:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchEncounter(id: string): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const encounter = await $fetch<Encounter>(`/api/encounters/${id}`)
      currentEncounter.value = encounter
      return encounter
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch encounter'
      console.error('Failed to fetch encounter:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createEncounter(name: string, description?: string): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const newEncounter = await $fetch<Encounter>('/api/encounters', {
        method: 'POST',
        body: { name, description },
      })
      encounters.value = [...encounters.value, newEncounter]
      return newEncounter
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create encounter'
      console.error('Failed to create encounter:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateEncounter(id: string, data: Partial<Encounter>): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<Encounter>(`/api/encounters/${id}`, {
        method: 'PUT',
        body: data,
      })
      encounters.value = encounters.value.map((e) => (e.id === id ? updated : e))
      if (currentEncounter.value?.id === id) {
        currentEncounter.value = updated
      }
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update encounter'
      console.error('Failed to update encounter:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteEncounter(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/encounters/${id}`, { method: 'DELETE' })
      encounters.value = encounters.value.filter((e) => e.id !== id)
      if (currentEncounter.value?.id === id) {
        currentEncounter.value = null
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete encounter'
      console.error('Failed to delete encounter:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  // === Combat Management Functions ===

  function createParticipant(
    type: 'tamer' | 'digimon',
    entityId: string,
    initiative: number,
    initiativeRoll: number,
    maxWounds: number = 5
  ): CombatParticipant {
    return {
      id: `${type}-${entityId}-${Date.now()}`,
      type,
      entityId,
      initiative,
      initiativeRoll,
      actionsRemaining: { simple: 2 },
      currentStance: 'neutral',
      activeEffects: [],
      isActive: false,
      hasActed: false,
      currentWounds: 0,
      maxWounds,
    }
  }

  async function addParticipant(
    encounterId: string,
    participant: CombatParticipant,
    digimonMap?: Map<string, any>  // Optional: for hierarchical filtering of partner digimon
  ): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const participants = [...((encounter.participants as CombatParticipant[]) || []), participant]

    // Sort by initiative (highest first)
    let sortedParticipants = participants.sort((a, b) => b.initiative - a.initiative)

    // Apply hierarchical filter if digimonMap provided (exclude partner digimon from turnOrder)
    if (digimonMap) {
      sortedParticipants = sortedParticipants.filter(p => {
        // Always include tamers and enemies
        if (p.type === 'tamer' || p.type === 'enemy') return true
        // For digimon, only include if NOT a partner (no partnerId)
        if (p.type === 'digimon') {
          const d = digimonMap.get(p.entityId)
          return !d?.partnerId  // Exclude if has partnerId (is a partner digimon)
        }
        return true
      })
    }

    const turnOrder = sortedParticipants.map((p) => p.id)

    const result = await updateEncounter(encounterId, { participants, turnOrder })
    return result
  }

  async function removeParticipant(
    encounterId: string,
    participantId: string
  ): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const participants = (encounter.participants as CombatParticipant[]).filter(
      (p) => p.id !== participantId
    )
    const turnOrder = (encounter.turnOrder as string[]).filter((id) => id !== participantId)

    return updateEncounter(encounterId, { participants, turnOrder })
  }

  async function startCombat(encounterId: string): Promise<Encounter | null> {
    return updateEncounter(encounterId, {
      phase: 'combat',
      round: 1,
      currentTurnIndex: 0,
    })
  }

  async function nextTurn(encounterId: string): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const participants = encounter.participants as CombatParticipant[]
    const turnOrder = encounter.turnOrder as string[]
    let nextIndex = (encounter.currentTurnIndex + 1) % turnOrder.length
    let newRound = encounter.round

    // If we've wrapped around, start a new round
    if (nextIndex === 0) {
      newRound += 1
      // Reset actions and hasActed for all participants
      participants.forEach((p) => {
        p.actionsRemaining = { simple: 2 }
        p.hasActed = false
        p.usedAttackIds = []
        // Decrement effect durations
        p.activeEffects = p.activeEffects
          .map((e) => ({ ...e, duration: e.duration - 1 }))
          .filter((e) => e.duration > 0)
      })
    }

    // Mark current participant as having acted
    const currentParticipantId = turnOrder[encounter.currentTurnIndex]
    const currentParticipant = participants.find((p) => p.id === currentParticipantId)
    if (currentParticipant) {
      currentParticipant.hasActed = true
      currentParticipant.isActive = false
    }

    // Mark next participant as active
    const nextParticipantId = turnOrder[nextIndex]
    const nextParticipant = participants.find((p) => p.id === nextParticipantId)
    if (nextParticipant) {
      nextParticipant.isActive = true
    }

    return updateEncounter(encounterId, {
      participants,
      currentTurnIndex: nextIndex,
      round: newRound,
    })
  }

  async function endCombat(encounterId: string): Promise<Encounter | null> {
    return updateEncounter(encounterId, { phase: 'ended' })
  }

  async function addBattleLogEntry(
    encounterId: string,
    entry: Omit<BattleLogEntry, 'id' | 'timestamp'>
  ): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const newEntry: BattleLogEntry = {
      ...entry,
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
    }

    const battleLog = [...((encounter.battleLog as BattleLogEntry[]) || []), newEntry]
    return updateEncounter(encounterId, { battleLog })
  }

  // Get current turn participant
  function getCurrentParticipant(encounter: Encounter): CombatParticipant | null {
    const turnOrder = (encounter.turnOrder as string[]) || []
    const participants = (encounter.participants as CombatParticipant[]) || []
    const currentId = turnOrder[encounter.currentTurnIndex]
    return participants.find((p) => p.id === currentId) || null
  }

  // === Hazard Management Functions ===

  async function addHazard(encounterId: string, hazard: Hazard): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const hazards = [...((encounter.hazards as Hazard[]) || []), hazard]
    return updateEncounter(encounterId, { hazards })
  }

  async function removeHazard(encounterId: string, hazardId: string): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const hazards = (encounter.hazards as Hazard[]).filter((h) => h.id !== hazardId)
    return updateEncounter(encounterId, { hazards })
  }

  async function updateHazard(encounterId: string, hazard: Hazard): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const hazards = (encounter.hazards as Hazard[]).map((h) => (h.id === hazard.id ? hazard : h))
    return updateEncounter(encounterId, { hazards })
  }

  async function decrementHazardDurations(encounterId: string): Promise<Encounter | null> {
    const encounter = encounters.value.find((e) => e.id === encounterId) || currentEncounter.value
    if (!encounter) return null

    const hazards = (encounter.hazards as Hazard[])
      .map((h) => {
        if (h.duration === null) return h
        return { ...h, duration: h.duration - 1 }
      })
      .filter((h) => h.duration === null || h.duration > 0)

    return updateEncounter(encounterId, { hazards })
  }

  // === Request/Response Management Functions ===

  async function createRequest(
    encounterId: string,
    type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll',
    targetTamerId: string,
    targetParticipantId?: string,
    data?: any
  ): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/requests`, {
        method: 'POST',
        body: { type, targetTamerId, targetParticipantId, data },
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create request'
      console.error('Failed to create request:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function respondToRequest(
    encounterId: string,
    requestId: string,
    tamerId: string,
    response: {
      type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled'
      digimonId?: string
      initiative?: number
      initiativeRoll?: number
      participantId?: string
      dodgeDicePool?: number
      dodgeSuccesses?: number
      dodgeDiceResults?: number[]
      timestamp?: string
    }
  ): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/responses`, {
        method: 'POST',
        body: { requestId, tamerId, response },
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to submit response'
      console.error('Failed to submit response:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function cancelRequest(encounterId: string, requestId: string): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/requests/${requestId}`, {
        method: 'DELETE',
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to cancel request'
      console.error('Failed to cancel request:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteResponse(encounterId: string, responseId: string): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/responses/${responseId}`, {
        method: 'DELETE',
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete response'
      console.error('Failed to delete response:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  // Helper functions for request/response
  function getMyPendingRequests(encounter: Encounter, tamerId: string) {
    const requests = (encounter.pendingRequests as any[]) || []
    return requests.filter((r) => r.targetTamerId === tamerId)
  }

  function getUnprocessedResponses(encounter: Encounter) {
    return (encounter.requestResponses as any[]) || []
  }

  // === Combat Action Functions ===

  async function performAttack(
    encounterId: string,
    participantId: string,
    attackId: string,
    targetId: string,
    accuracyData: {
      dicePool: number
      successes: number
      diceResults: number[]
    },
    tamerId: string
  ): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/actions/attack`, {
        method: 'POST',
        body: {
          participantId,
          attackId,
          targetId,
          accuracyDicePool: accuracyData.dicePool,
          accuracySuccesses: accuracyData.successes,
          accuracyDiceResults: accuracyData.diceResults,
          tamerId,
        },
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to perform attack'
      console.error('Failed to perform attack:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function performNpcAttack(
    encounterId: string,
    participantId: string,
    attackId: string,
    targetId: string,
    accuracyData: {
      dicePool: number
      successes: number
      diceResults: number[]
    },
    dodgeData: {
      dicePool: number
      successes: number
      diceResults: number[]
    }
  ): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<Encounter>(`/api/encounters/${encounterId}/actions/npc-attack`, {
        method: 'POST',
        body: {
          participantId,
          attackId,
          targetId,
          accuracyDicePool: accuracyData.dicePool,
          accuracySuccesses: accuracyData.successes,
          accuracyDiceResults: accuracyData.diceResults,
          dodgeDicePool: dodgeData.dicePool,
          dodgeSuccesses: dodgeData.successes,
          dodgeDiceResults: dodgeData.diceResults,
        },
      })
      // Update local state
      encounters.value = encounters.value.map((e) => (e.id === encounterId ? result : e))
      if (currentEncounter.value?.id === encounterId) {
        currentEncounter.value = result
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to perform NPC attack'
      console.error('Failed to perform NPC attack:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    encounters,
    currentEncounter,
    loading,
    error,
    fetchEncounters,
    fetchEncounter,
    createEncounter,
    updateEncounter,
    deleteEncounter,
    // Combat management
    createParticipant,
    addParticipant,
    removeParticipant,
    startCombat,
    nextTurn,
    endCombat,
    addBattleLogEntry,
    getCurrentParticipant,
    // Hazard management
    addHazard,
    removeHazard,
    updateHazard,
    decrementHazardDurations,
    // Request/response management
    createRequest,
    respondToRequest,
    cancelRequest,
    deleteResponse,
    getMyPendingRequests,
    getUnprocessedResponses,
    // Combat actions
    performAttack,
    performNpcAttack,
  }
}
