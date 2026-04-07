import type { Encounter } from '../server/db/schema'
import type { Digimon } from '../server/db/schema'
import type { Tamer } from '../server/db/schema'
import { PERMANENT_EFFECTS } from '../data/attackConstants'

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
    value?: number
  }>
  isActive: boolean
  hasActed: boolean
  currentWounds: number
  maxWounds: number
  currentTempWounds?: number
  usedAttackIds?: string[]
  dodgePenalty?: number
  evolutionLineId?: string
  woundsHistory?: Array<{ stageIndex: number; wounds: number; entityId: string; maxWounds: number }>
  usedSpecialOrders?: string[]
  interceptPenalty?: number
  intercedeOptOuts?: string[]
  hasDirectedThisTurn?: boolean
  digimonBolsterCount?: number
  lastBitCpuBolsterRound?: number
  lastHugePowerRound?: number
  lastHugePowerRank2Round?: number
  isEnemy?: boolean
  battery?: number
  usedSignatureMoveThisTurn?: boolean
  combatMonsterBonus?: number
  hasAttemptedDigivolve?: boolean
  npcStageIndex?: number
  clash?: {
    clashId: string
    opponentParticipantId: string
    isController: boolean
    isPinned: boolean
    clashPinsUsed?: number
    clashCheckNeeded: boolean
    pendingRoll?: number
    reachInitiated?: boolean
    reachDistance?: number
  }
  clashCooldownUntilRound?: number
  usedFreeClashThisRound?: boolean
  usedCounterattackThisCombat?: boolean
  moodValue?: number  // Positive Reinforcement: mood meter (1–6, starts at 3)
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

  async function fetchEncounters(campaignId?: string) {
    loading.value = true
    error.value = null
    try {
      const query = campaignId ? `?campaignId=${campaignId}` : ''
      encounters.value = await $fetch<Encounter[]>(`/api/encounters${query}`)
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
      encounters.value = encounters.value.map((e) => e.id === id ? encounter : e)
      return encounter
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch encounter'
      console.error('Failed to fetch encounter:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createEncounter(name: string, description?: string, campaignId?: string): Promise<Encounter | null> {
    loading.value = true
    error.value = null
    try {
      const newEncounter = await $fetch<Encounter>('/api/encounters', {
        method: 'POST',
        body: { name, description, campaignId },
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
    maxWounds: number = 5,
    evolutionLineId?: string,
    isEnemy?: boolean,
    initialWounds: number = 0
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
      currentWounds: initialWounds,
      maxWounds,
      ...(evolutionLineId ? { evolutionLineId } : {}),
      ...(isEnemy ? { isEnemy } : {}),
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
        // Exclude GM metadata participant
        if (p.type === 'gm') return false
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

  async function nextTurn(encounterId: string, digimonMap?: Map<string, any>, houseRules?: { signatureMoveBattery?: boolean } | null): Promise<Encounter | null> {
    const encounter = await fetchEncounter(encounterId)
    if (!encounter) return null

    const participants = encounter.participants as CombatParticipant[]
    const turnOrder = encounter.turnOrder as string[]
    let nextIndex = (encounter.currentTurnIndex + 1) % turnOrder.length

    // Skip any turn-order slots whose participant was removed from the encounter
    let skipped = 0
    while (!participants.find((p) => p.id === turnOrder[nextIndex]) && skipped < turnOrder.length) {
      nextIndex = (nextIndex + 1) % turnOrder.length
      skipped++
    }

    let newRound = encounter.round
    const poisonLogEntries: any[] = []

    // If we've wrapped around, start a new round
    if (nextIndex === 0) {
      newRound += 1
      // Reset actions and hasActed for all participants
      participants.forEach((p) => {
        p.actionsRemaining = { simple: 2 }
        p.hasActed = false
        p.usedAttackIds = []
        p.hasAttemptedDigivolve = false
        // Apply intercept penalty from previous round
        if (p.interceptPenalty) {
          p.actionsRemaining.simple = Math.max(0, 2 - p.interceptPenalty)
          p.interceptPenalty = 0
        }
        // Apply Stun action penalty (skip if already reduced mid-round when Stun was applied)
        if (!p.stunActionReducedThisRound) {
          const stunEffect = (p.activeEffects || []).find((e: any) => e.name === 'Stun')
          if (stunEffect) {
            p.actionsRemaining.simple = Math.max(0, p.actionsRemaining.simple - 1)
          }
        }
        p.stunActionReducedThisRound = false
        // Decrement effect durations; skip permanent effects
        p.activeEffects = (p.activeEffects || [])
          .map((e) => PERMANENT_EFFECTS.has(e.name) ? e : { ...e, duration: e.duration - 1 })
          .filter((e) => e.duration > 0 || PERMANENT_EFFECTS.has(e.name))
        // Clash round resets
        if (p.clash) {
          const opponent = participants.find((o) => o.id === (p.clash as any).opponentParticipantId)
          const eitherPinned = (p.clash as any).isPinned || (opponent?.clash as any)?.isPinned
          p.clash.clashCheckNeeded = !eitherPinned  // pinned side skips the check; controller retains
          p.clash.isPinned = false                  // pins expire after one turn
        }
        p.usedFreeClashThisRound = false  // Wrestlemania free clash resets each round
      })

      // Apply Poison damage to all affected participants
      participants.forEach((p) => {
        const poisonEffect = (p.activeEffects || []).find((e: any) => e.name === 'Poison')
        if (!poisonEffect) return

        const dmg = (poisonEffect as any).potency ?? 1
        const tempAvailable = p.currentTempWounds ?? 0
        const tempAbsorb = Math.min(tempAvailable, dmg)
        const remainder = dmg - tempAbsorb
        p.currentTempWounds = tempAvailable - tempAbsorb
        if (tempAbsorb > 0 && p.currentTempWounds === 0) {
          p.activeEffects = (p.activeEffects || []).filter((e: any) => e.name !== 'Shield')
        }
        p.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + remainder)

        poisonLogEntries.push({
          id: `log-poison-${p.id}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          round: newRound,
          actorId: p.id,
          actorName: p.id,
          action: 'Poison',
          target: p.id,
          result: `${dmg} poison damage`,
          damage: dmg,
          effects: ['Poison'],
        })
      })

      // Signature Move Battery: grant +1 Battery at end of round to digimon who did not use Signature Move
      if (houseRules?.signatureMoveBattery && digimonMap) {
        participants.forEach((p) => {
          if (p.type !== 'digimon') return
          const digimon = digimonMap.get(p.entityId)
          const stage = digimon?.stage as string | undefined
          const stageBatteryCapacity: Record<string, number> = {
            'champion': 2, 'ultimate': 3, 'mega': 4, 'ultra': 5,
          }
          const cap = stage ? (stageBatteryCapacity[stage] ?? 0) : 0
          if (cap > 0) {
            if (!p.usedSignatureMoveThisTurn) {
              p.battery = Math.min(cap, (p.battery ?? 0) + 1)
            }
            p.usedSignatureMoveThisTurn = false
          }
        })
      }
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
      nextParticipant.dodgePenalty = 0
      nextParticipant.hasDirectedThisTurn = false

      // Also reset partner digimon's dodge penalty (partner excluded from turnOrder)
      if (digimonMap && nextParticipant.type === 'tamer') {
        const partner = participants.find((p) => {
          if (p.type !== 'digimon') return false
          const digimon = digimonMap.get(p.entityId)
          return digimon?.partnerId === nextParticipant.entityId
        })
        if (partner) {
          partner.dodgePenalty = 0
        }
      }
    }

    const updatePayload: Partial<Encounter> = { participants, currentTurnIndex: nextIndex, round: newRound }
    if (poisonLogEntries.length > 0) {
      const existingLog = [...((encounter?.battleLog as any[]) || [])]
      updatePayload.battleLog = existingLog.concat(poisonLogEntries)
    }
    return updateEncounter(encounterId, updatePayload)
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
    type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll' | 'intercede-offer',
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
      type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled' | 'health-rolled'
      digimonId?: string
      initiative?: number
      initiativeRoll?: number
      participantId?: string
      dodgeDicePool?: number
      dodgeSuccesses?: number
      dodgeDiceResults?: number[]
      healthDicePool?: number
      healthSuccesses?: number
      healthDiceResults?: number[]
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
    tamerId: string,
    attackName?: string,
    bolsterData?: {
      bolstered: boolean
      bolsterType?: 'damage-accuracy' | 'bit-cpu'
    },
    hugePowerData?: {
      hugePowerUsed: boolean
      attackRange: 'melee' | 'ranged'
      hugePowerRank?: number
      hugePowerTrackAll?: boolean
    },
    lifestealData?: {
      lifestealed: boolean
    }
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
          attackName,
          bolstered: bolsterData?.bolstered || false,
          bolsterType: bolsterData?.bolsterType,
          hugePowerUsed: hugePowerData?.hugePowerUsed || false,
          hugePowerAttackRange: hugePowerData?.attackRange,
          hugePowerRank: hugePowerData?.hugePowerRank,
          hugePowerTrackAll: hugePowerData?.hugePowerTrackAll,
          lifestealed: lifestealData?.lifestealed || false,
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
