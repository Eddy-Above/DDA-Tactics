<script setup lang="ts">
import type { Encounter } from '../../server/db/schema'
import type { CombatParticipant, BattleLogEntry, Hazard } from '../../composables/useEncounters'
import type { Digimon } from '../../server/db/schema'
import type { Tamer } from '../../server/db/schema'

definePageMeta({
  title: 'Encounter',
})

const route = useRoute()
const router = useRouter()

const {
  currentEncounter,
  loading,
  error,
  fetchEncounter,
  updateEncounter,
  createParticipant,
  addParticipant,
  removeParticipant,
  startCombat,
  nextTurn,
  endCombat,
  addBattleLogEntry,
  getCurrentParticipant,
  addHazard,
  removeHazard,
  updateHazard,
  createRequest,
  respondToRequest,
  cancelRequest,
  getMyPendingRequests,
  getUnprocessedResponses,
} = useEncounters()

const { digimonList, fetchDigimon, rollInitiative: rollDigimonInitiative, calculateDerivedStats: calcDigimonStats } = useDigimon()
const { tamers, fetchTamers, calculateDerivedStats: calcTamerStats } = useTamers()
const { fetchEvolutionLines, evolutionLines, getCurrentStage } = useEvolution()

const showAddParticipant = ref(false)
const selectedEntityType = ref<'digimon' | 'enemy' | 'tamer'>('digimon')
const selectedEntityId = ref('')
const addQuantity = ref(1)
const showRequestPanel = ref(false)
const selectedTamerForRequest = ref('')

// Entity lookup maps
const digimonMap = computed(() => {
  const map = new Map<string, Digimon>()
  digimonList.value.forEach((d) => map.set(d.id, d))
  return map
})

const tamerMap = computed(() => {
  const map = new Map<string, Tamer>()
  tamers.value.forEach((t) => map.set(t.id, t))
  return map
})

// Participants sorted by turn order
const sortedParticipants = computed(() => {
  if (!currentEncounter.value) return []
  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  const turnOrder = (currentEncounter.value.turnOrder as string[]) || []

  // Filter turnOrder to exclude partner digimon (for backward compatibility)
  const filteredTurnOrder = turnOrder.filter(id => {
    const participant = participants.find(p => p.id === id)
    if (!participant || participant.type !== 'digimon') return true
    return !hasPartnerTamerInEncounter(participant)
  })

  return filteredTurnOrder
    .map((id) => participants.find((p) => p.id === id))
    .filter(Boolean) as CombatParticipant[]
})

// Participants with their partner digimon grouped together
const hierarchicalParticipants = computed(() => {
  return sortedParticipants.value.map(participant => ({
    participant,
    partnerDigimon: participant.type === 'tamer'
      ? getPartnerDigimonForTamer(participant)
      : null
  }))
})

// Current active participant
const activeParticipant = computed(() => {
  if (!currentEncounter.value) return null
  return getCurrentParticipant(currentEncounter.value)
})

// Battle log
const battleLog = computed(() => {
  if (!currentEncounter.value) return []
  return ((currentEncounter.value.battleLog as BattleLogEntry[]) || []).slice().reverse()
})

// Hazards
const hazards = computed(() => {
  if (!currentEncounter.value) return []
  return (currentEncounter.value.hazards as Hazard[]) || []
})

// Pending requests
const pendingRequests = computed(() => {
  if (!currentEncounter.value) return []
  return (currentEncounter.value.pendingRequests as any[]) || []
})

// Unprocessed responses
const unprocessedResponses = computed(() => {
  if (!currentEncounter.value) return []
  return (currentEncounter.value.requestResponses as any[]) || []
})

// Check if combat can be started (all setup complete)
const canStartCombat = computed(() => {
  if (!currentEncounter.value) return false
  if (currentEncounter.value.phase !== 'setup') return false

  // Need at least 2 participants
  if (sortedParticipants.value.length < 2) return false

  // Check if there are any pending requests (waiting for players)
  if (pendingRequests.value.length > 0) return false

  // Check if there are any unprocessed responses (waiting for GM)
  if (unprocessedResponses.value.length > 0) return false

  // Check if all participants have initiative set
  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  const allHaveInitiative = participants.every(p =>
    typeof p.initiative === 'number' && p.initiative >= 0
  )
  if (!allHaveInitiative) return false

  return true
})

// Get entity details for a participant
function getEntityDetails(participant: CombatParticipant) {
  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    if (!digimon) return null
    const derived = calcDigimonStats(digimon)
    return {
      name: digimon.name,
      species: digimon.species,
      stage: digimon.stage,
      isEnemy: digimon.isEnemy,
      stats: digimon.baseStats,
      derived,
      icon: digimon.isEnemy ? '👹' : '🦖',
      spriteUrl: digimon.spriteUrl,
    }
  } else {
    const tamer = tamerMap.value.get(participant.entityId)
    if (!tamer) return null
    const derived = calcTamerStats(tamer)
    return {
      name: tamer.name,
      species: 'Tamer',
      stage: tamer.campaignLevel,
      isEnemy: false,
      stats: tamer.attributes,
      derived,
      icon: '👤',
      spriteUrl: null,
    }
  }
}

// Find partner digimon for a tamer participant
function getPartnerDigimonForTamer(tamerParticipant: CombatParticipant): CombatParticipant | null {
  if (tamerParticipant.type !== 'tamer' || !currentEncounter.value) return null

  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []

  // Find digimon participant whose partnerId matches this tamer's entityId
  return participants.find(p => {
    if (p.type !== 'digimon') return false

    // Look up the digimon entity to check its partnerId
    const digimon = digimonMap.value.get(p.entityId)
    return digimon?.partnerId === tamerParticipant.entityId
  }) || null
}

// Check if a digimon participant has a partner tamer in this encounter
function hasPartnerTamerInEncounter(digimonParticipant: CombatParticipant): boolean {
  if (digimonParticipant.type !== 'digimon' || !currentEncounter.value) return false

  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []

  // Look up the digimon entity to get its partnerId
  const digimon = digimonMap.value.get(digimonParticipant.entityId)
  if (!digimon?.partnerId) return false

  // Check if there's a tamer participant with matching entityId
  return participants.some(p => p.type === 'tamer' && p.entityId === digimon.partnerId)
}

// Check if a participant can act this turn (either their turn, or their partner's turn)
function canParticipantAct(participant: CombatParticipant): boolean {
  if (!currentEncounter.value) return false

  const turnOrder = (currentEncounter.value.turnOrder as string[]) || []
  const currentIndex = currentEncounter.value.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  // Can act if it's directly their turn
  if (participant.id === currentTurnParticipantId) return true

  // Digimon can act if it's their partner tamer's turn
  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    if (digimon?.partnerId) {
      const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
      const partnerTamer = participants.find(p =>
        p.type === 'tamer' && p.entityId === digimon.partnerId
      )
      if (partnerTamer && partnerTamer.id === currentTurnParticipantId) {
        return true
      }
    }
  }

  return false
}

// Add participant handler - supports adding multiple of the same entity
async function handleAddParticipant() {
  if (!currentEncounter.value || !selectedEntityId.value) return

  // For tamers, create a digimon selection request instead of directly adding
  if (selectedEntityType.value === 'tamer') {
    await createRequest(
      currentEncounter.value.id,
      'digimon-selection',
      selectedEntityId.value
    )
    showAddParticipant.value = false
    selectedEntityId.value = ''
    addQuantity.value = 1
    return
  }

  // For digimon/enemies, add directly with rolled initiative
  const quantity = addQuantity.value || 1

  for (let i = 0; i < quantity; i++) {
    let initiative = 0
    let initiativeRoll = 0
    let maxWounds = 5

    if (selectedEntityType.value === 'digimon' || selectedEntityType.value === 'enemy') {
      const digimon = digimonMap.value.get(selectedEntityId.value)
      if (digimon) {
        const result = rollDigimonInitiative(digimon)
        initiative = result.total
        initiativeRoll = result.roll
        const derived = calcDigimonStats(digimon)
        maxWounds = derived.woundBoxes
      }
    }

    const participant = createParticipant(
      selectedEntityType.value === 'enemy' ? 'digimon' : selectedEntityType.value,
      selectedEntityId.value,
      initiative,
      initiativeRoll,
      maxWounds
    )

    const result = await addParticipant(currentEncounter.value.id, participant, digimonMap.value)
  }

  showAddParticipant.value = false
  selectedEntityId.value = ''
  addQuantity.value = 1
}

// Remove participant
async function handleRemoveParticipant(participantId: string) {
  if (!currentEncounter.value) return
  if (confirm('Remove this participant from the encounter?')) {
    await removeParticipant(currentEncounter.value.id, participantId)
  }
}

// Request digimon selection from a tamer
async function requestDigimonSelection() {
  if (!currentEncounter.value || !selectedTamerForRequest.value) return

  await createRequest(
    currentEncounter.value.id,
    'digimon-selection',
    selectedTamerForRequest.value
  )

  showRequestPanel.value = false
  selectedTamerForRequest.value = ''
}

// Request initiative roll from a tamer
async function requestInitiativeRoll(tamerId: string) {
  if (!currentEncounter.value) return

  await createRequest(
    currentEncounter.value.id,
    'initiative-roll',
    tamerId
  )
}

// Request dodge roll from a participant's tamer
async function requestDodgeRoll(participantId: string) {
  if (!currentEncounter.value) return

  const participant = (currentEncounter.value.participants as any[])?.find((p: any) => p.id === participantId)
  if (!participant) return

  // For digimon, we need the tamer's ID
  let tamerId = participant.entityId
  if (participant.type === 'digimon') {
    // This is simplified - in reality, we'd need to look up which tamer owns this digimon
    // For now, we'll just use the entityId
    tamerId = participant.entityId
  }

  await createRequest(
    currentEncounter.value.id,
    'dodge-roll',
    tamerId,
    participantId,
    {
      attackName: 'Attack',
      attackerName: 'Attacker',
    }
  )
}

// Process player response
async function processResponse(response: any) {
  if (!currentEncounter.value) return

  try {
    const request = pendingRequests.value.find((r: any) => r.id === response.requestId)
    if (!request) {
      console.error('Request not found:', response.requestId)
      return
    }

    if (response.response.type === 'digimon-selected') {
      // Check if player selected "None" (tamer-only, no digimon)
      if (!response.response.digimonId) {
        // Create initiative roll request for TAMER only (no digimonId in data)
        await createRequest(
          currentEncounter.value.id,
          'initiative-roll',
          response.tamerId,
          undefined, // No participant ID yet
          {} // Empty data object - no digimonId means tamer-only
        )

        // Clear the original digimon selection request
        await cancelRequest(currentEncounter.value.id, request.id)
        return
      }

      // Verify the digimon exists
      const digimon = digimonMap.value.get(response.response.digimonId)
      if (!digimon) {
        console.error('Digimon not found:', response.response.digimonId)
        return
      }

      // Create initiative roll request for the player with digimon
      // Note: We'll pass the digimonId in the request data so we can retrieve it later
      await createRequest(
        currentEncounter.value.id,
        'initiative-roll',
        response.tamerId,
        undefined, // No participant ID yet
        { digimonId: response.response.digimonId } // Store for later
      )

      // Clear the original digimon selection request
      await cancelRequest(currentEncounter.value.id, request.id)
    } else if (response.response.type === 'initiative-rolled') {
      // Check if this initiative request has a digimonId (from digimon selection flow)
      if (request.data?.digimonId) {
        // This is for a digimon participant
        const digimon = digimonMap.value.get(request.data.digimonId)
        if (!digimon) {
          console.error('Digimon not found:', request.data.digimonId)
          return
        }

        const tamer = tamers.value.find((t) => t.id === response.tamerId)
        if (!tamer) {
          console.error('Tamer not found:', response.tamerId)
          return
        }

        const digimonDerived = calcDigimonStats(digimon)
        const tamerDerived = calcTamerStats(tamer)

        // Create BOTH participants with the same initiative
        const digimonParticipant = createParticipant(
          'digimon',
          digimon.id,
          response.response.initiative,
          response.response.initiativeRoll,
          digimonDerived.woundBoxes
        )

        const tamerParticipant = createParticipant(
          'tamer',
          tamer.id,
          response.response.initiative,
          response.response.initiativeRoll,
          tamerDerived.woundBoxes
        )

        // Add both to participants array
        const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
        const updatedParticipants = [...participants, digimonParticipant, tamerParticipant]

        // Create turnOrder with ONLY tamer (not partner digimon)
        // Partner digimon act on their tamer's turn
        const turnOrder = updatedParticipants
          .sort((a, b) => b.initiative - a.initiative)
          .filter(p => {
            // Include tamer and non-partnered digimon
            if (p.type === 'tamer') return true
            // For digimon, only include if not a partner (no partnerId match)
            const d = digimonMap.value.get(p.entityId)
            return !d?.partnerId
          })
          .map(p => p.id)

        const result = await updateEncounter(currentEncounter.value.id, {
          participants: updatedParticipants,
          turnOrder
        })

        if (result) {
          await cancelRequest(currentEncounter.value.id, request.id)
        }
      } else {
        // This is for a standalone tamer participant (if needed)
        const participants = (currentEncounter.value.participants as any[]) || []
        const tamer = tamers.value.find((t) => t.id === response.tamerId)

        if (tamer) {
          let participant = participants.find((p: any) => p.entityId === tamer.id && p.type === 'tamer')

          if (!participant) {
            const derived = calcTamerStats(tamer)
            participant = createParticipant('tamer', tamer.id, response.response.initiative, response.response.initiativeRoll, derived.woundBoxes)
            const result = await addParticipant(currentEncounter.value.id, participant, digimonMap.value)
            if (result) {
              await cancelRequest(currentEncounter.value.id, request.id)
            }
          } else {
            const updated = participants.map((p: any) => {
              if (p.id === participant.id) {
                return {
                  ...p,
                  initiative: response.response.initiative,
                  initiativeRoll: response.response.initiativeRoll,
                }
              }
              return p
            })
            const result = await updateEncounter(currentEncounter.value.id, { participants: updated })
            if (result) {
              await cancelRequest(currentEncounter.value.id, request.id)
            }
          }
        } else {
          console.error('Tamer not found:', response.tamerId)
        }
      }
    }
    // For dodge rolls, we don't auto-process - GM uses the damage calculator
  } catch (error) {
    console.error('Error processing response:', error)
  }
}

// Start combat
async function handleStartCombat() {
  if (!currentEncounter.value) return
  if (sortedParticipants.value.length < 2) {
    alert('Need at least 2 participants to start combat')
    return
  }

  // Mark first participant as active
  const participants = currentEncounter.value.participants as CombatParticipant[]
  const turnOrder = currentEncounter.value.turnOrder as string[]
  const firstId = turnOrder[0]
  const first = participants.find((p) => p.id === firstId)
  if (first) {
    first.isActive = true
  }

  await updateEncounter(currentEncounter.value.id, { participants })
  await startCombat(currentEncounter.value.id)

  const entity = first ? getEntityDetails(first) : null
  if (entity) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: 1,
      actorId: first!.id,
      actorName: entity.name,
      action: 'Combat started',
      target: null,
      result: `${entity.name}'s turn begins`,
      damage: null,
      effects: [],
    })
  }
}

// Next turn
async function handleNextTurn() {
  if (!currentEncounter.value) return

  const current = activeParticipant.value
  const entity = current ? getEntityDetails(current) : null

  await nextTurn(currentEncounter.value.id)

  // Refetch to get updated state
  await fetchEncounter(currentEncounter.value.id)

  const newActive = activeParticipant.value
  const newEntity = newActive ? getEntityDetails(newActive) : null

  if (newEntity && currentEncounter.value) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: newActive!.id,
      actorName: newEntity.name,
      action: 'Turn started',
      target: null,
      result: `${newEntity.name}'s turn begins`,
      damage: null,
      effects: [],
    })
  }
}

// End combat
async function handleEndCombat() {
  if (!currentEncounter.value) return
  if (confirm('End this combat encounter?')) {
    await endCombat(currentEncounter.value.id)
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: 'system',
      actorName: 'System',
      action: 'Combat ended',
      target: null,
      result: 'The encounter has concluded',
      damage: null,
      effects: [],
    })
  }
}

// Use action (simple or complex)
async function useAction(type: 'simple' | 'complex', description: string) {
  if (!currentEncounter.value || !activeParticipant.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const active = participants.find((p) => p.id === activeParticipant.value!.id)
  if (!active) return

  if (type === 'simple' && active.actionsRemaining.simple >= 1) {
    active.actionsRemaining.simple -= 1
  } else if (type === 'complex' && active.actionsRemaining.simple >= 2) {
    active.actionsRemaining.simple -= 2
  } else {
    return // Not enough actions remaining
  }

  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(active)
  if (entity) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: active.id,
      actorName: entity.name,
      action: `${type} action`,
      target: null,
      result: description,
      damage: null,
      effects: [],
    })
  }
}

// Change stance
async function changeStance(stance: CombatParticipant['currentStance']) {
  if (!currentEncounter.value || !activeParticipant.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const active = participants.find((p) => p.id === activeParticipant.value!.id)
  if (!active) return

  active.currentStance = stance
  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(active)
  if (entity) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: active.id,
      actorName: entity.name,
      action: 'Changed stance',
      target: null,
      result: `Switched to ${stance} stance`,
      damage: null,
      effects: [],
    })
  }
}

// Re-roll initiative for a participant
async function rerollInitiative(participantId: string) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const participant = participants.find((p) => p.id === participantId)
  if (!participant) return

  let initiative = 0
  let initiativeRoll = 0

  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    if (digimon) {
      const result = rollDigimonInitiative(digimon)
      initiative = result.total
      initiativeRoll = result.roll
    }
  } else {
    const tamer = tamerMap.value.get(participant.entityId)
    if (tamer) {
      initiativeRoll = Math.floor(Math.random() * 6) + 1 +
        Math.floor(Math.random() * 6) + 1 +
        Math.floor(Math.random() * 6) + 1
      initiative = initiativeRoll + tamer.attributes.agility
    }
  }

  participant.initiative = initiative
  participant.initiativeRoll = initiativeRoll

  // Resort turn order (exclude partner digimon - hierarchical children)
  const turnOrder = [...participants]
    .sort((a, b) => b.initiative - a.initiative)
    .filter(p => {
      // Include tamer and non-partnered digimon
      if (p.type === 'tamer') return true
      // For digimon, only include if not a partner (no partnerId match)
      const d = digimonMap.value.get(p.entityId)
      return !d?.partnerId
    })
    .map((p) => p.id)

  await updateEncounter(currentEncounter.value.id, { participants, turnOrder })
}

// Update wounds for a participant
async function updateWounds(participantId: string, wounds: number) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const participant = participants.find((p) => p.id === participantId)
  if (!participant) return

  const previousWounds = participant.currentWounds
  participant.currentWounds = wounds
  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(participant)
  if (entity) {
    const diff = wounds - previousWounds
    if (diff !== 0) {
      await addBattleLogEntry(currentEncounter.value.id, {
        round: currentEncounter.value.round,
        actorId: participant.id,
        actorName: entity.name,
        action: diff > 0 ? 'Took damage' : 'Healed',
        target: null,
        result: diff > 0 ? `${entity.name} took ${diff} wound(s)` : `${entity.name} healed ${Math.abs(diff)} wound(s)`,
        damage: diff > 0 ? diff : null,
        effects: [],
      })
    }
  }
}

// Add effect to a participant
async function addEffect(participantId: string, effect: CombatParticipant['activeEffects'][0]) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const participant = participants.find((p) => p.id === participantId)
  if (!participant) return

  participant.activeEffects = [...participant.activeEffects, effect]
  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(participant)
  if (entity) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: participant.id,
      actorName: entity.name,
      action: 'Effect applied',
      target: null,
      result: `${effect.name} applied to ${entity.name}`,
      damage: null,
      effects: [effect.name],
    })
  }
}

// Remove effect from a participant
async function removeEffect(participantId: string, effectId: string) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const participant = participants.find((p) => p.id === participantId)
  if (!participant) return

  const effect = participant.activeEffects.find((e) => e.id === effectId)
  participant.activeEffects = participant.activeEffects.filter((e) => e.id !== effectId)
  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(participant)
  if (entity && effect) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: participant.id,
      actorName: entity.name,
      action: 'Effect removed',
      target: null,
      result: `${effect.name} removed from ${entity.name}`,
      damage: null,
      effects: [],
    })
  }
}

// Selected participant for detailed view
const selectedParticipantId = ref<string | null>(null)
const selectedParticipant = computed(() => {
  if (!selectedParticipantId.value || !currentEncounter.value) return null
  const participants = currentEncounter.value.participants as CombatParticipant[]
  return participants.find((p) => p.id === selectedParticipantId.value) || null
})

let refreshInterval: ReturnType<typeof setInterval>

onMounted(async () => {
  await Promise.all([
    fetchEncounter(route.params.id as string),
    fetchDigimon(),
    fetchTamers(),
    fetchEvolutionLines(),
  ])

  // Auto-refresh encounter every 5 seconds to see player responses
  refreshInterval = setInterval(() => {
    fetchEncounter(route.params.id as string)
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

// Get set of digimon IDs that are current forms for partners
const currentPartnerDigimonIds = computed(() => {
  const ids = new Set<string>()

  for (const evolutionLine of evolutionLines.value) {
    // Only process evolution lines with partners
    if (!evolutionLine.partnerId) continue

    const currentStage = getCurrentStage(evolutionLine)
    if (currentStage?.digimonId) {
      ids.add(currentStage.digimonId)
    }
  }

  return ids
})

// Available entities to add (all entities - can add multiples)
const availableDigimon = computed(() => {
  return digimonList.value.filter((digimon) => {
    // Only show partner digimon (those with a partnerId)
    if (!digimon.partnerId) {
      return false
    }

    // For partners, only show if they're at their current stage
    return currentPartnerDigimonIds.value.has(digimon.id)
  })
})

const availableEnemyDigimon = computed(() => {
  return digimonList.value.filter((digimon) => digimon.isEnemy)
})

const availableTamers = computed(() => tamers.value)

function getStanceColor(stance: string) {
  const colors: Record<string, string> = {
    neutral: 'bg-gray-600',
    defensive: 'bg-blue-600',
    offensive: 'bg-red-600',
    sniper: 'bg-purple-600',
    brave: 'bg-yellow-600',
  }
  return colors[stance] || 'bg-gray-600'
}

// Hazard handlers
async function handleAddHazard(hazard: Hazard) {
  if (!currentEncounter.value) return
  await addHazard(currentEncounter.value.id, hazard)
  await addBattleLogEntry(currentEncounter.value.id, {
    round: currentEncounter.value.round,
    actorId: 'system',
    actorName: 'Environment',
    action: 'Hazard added',
    target: null,
    result: `${hazard.name} is now active (${hazard.affectedArea})`,
    damage: null,
    effects: [hazard.name],
  })
}

async function handleRemoveHazard(hazardId: string) {
  if (!currentEncounter.value) return
  const hazard = hazards.value.find((h) => h.id === hazardId)
  await removeHazard(currentEncounter.value.id, hazardId)
  if (hazard) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: 'system',
      actorName: 'Environment',
      action: 'Hazard removed',
      target: null,
      result: `${hazard.name} is no longer active`,
      damage: null,
      effects: [],
    })
  }
}

async function handleUpdateHazard(hazard: Hazard) {
  if (!currentEncounter.value) return
  await updateHazard(currentEncounter.value.id, hazard)
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div v-if="loading && !currentEncounter" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading encounter...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="!currentEncounter" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Encounter Not Found</h2>
      <NuxtLink to="/encounters" class="text-digimon-orange-400 hover:text-digimon-orange-300">
        Return to Encounters
      </NuxtLink>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex justify-between items-start mb-6">
        <div>
          <NuxtLink to="/encounters" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Encounters
          </NuxtLink>
          <h1 class="font-display text-3xl font-bold text-white">{{ currentEncounter.name }}</h1>
          <p v-if="currentEncounter.description" class="text-digimon-dark-400">
            {{ currentEncounter.description }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <span
            :class="[
              'text-sm px-3 py-1 rounded uppercase font-semibold',
              currentEncounter.phase === 'setup' && 'bg-blue-900/30 text-blue-400',
              currentEncounter.phase === 'combat' && 'bg-red-900/30 text-red-400',
              currentEncounter.phase === 'ended' && 'bg-gray-900/30 text-gray-400',
            ]"
          >
            {{ currentEncounter.phase }}
          </span>
          <span v-if="currentEncounter.phase === 'combat'" class="text-white font-semibold">
            Round {{ currentEncounter.round }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Turn Order / Participants -->
        <div class="lg:col-span-2 space-y-4">
          <!-- Combat Controls -->
          <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
            <div class="flex gap-3 flex-wrap">
              <button
                v-if="currentEncounter.phase === 'setup'"
                :disabled="!canStartCombat"
                :class="[
                  'px-4 py-2 rounded-lg font-semibold transition-colors',
                  canStartCombat
                    ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                    : 'bg-digimon-dark-700 text-digimon-dark-400 cursor-not-allowed opacity-50'
                ]"
                :title="canStartCombat ? 'Start combat with current participants' : 'Complete all player setup first (process pending requests/responses)'"
                @click="handleStartCombat"
              >
                ▶ Start Combat
              </button>
              <button
                v-if="currentEncounter.phase === 'combat'"
                class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                @click="handleNextTurn"
              >
                Next Turn →
              </button>
              <button
                v-if="currentEncounter.phase === 'combat'"
                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                @click="handleEndCombat"
              >
                End Combat
              </button>
              <button
                v-if="currentEncounter.phase !== 'ended'"
                class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                @click="showAddParticipant = true"
              >
                + Add Participant
              </button>
            </div>

            <!-- Setup Status Indicator -->
            <div v-if="currentEncounter.phase === 'setup' && !canStartCombat" class="text-xs text-digimon-dark-400 mt-3 p-2 bg-digimon-dark-700 rounded">
              <span v-if="sortedParticipants.length < 2">
                ⚠️ Need at least 2 participants
              </span>
              <span v-else-if="pendingRequests.length > 0">
                ⏳ Waiting for {{ pendingRequests.length }} player response(s)
              </span>
              <span v-else-if="unprocessedResponses.length > 0">
                ⚙️ Process {{ unprocessedResponses.length }} response(s) to continue
              </span>
              <span v-else>
                ⚠️ Some participants missing initiative
              </span>
            </div>
          </div>

          <!-- Turn Order List -->
          <div class="space-y-3">
            <template
              v-for="(item, index) in hierarchicalParticipants"
              :key="`turn-${item.participant.id}`"
            >
              <!-- Main Participant Card (Tamer or Enemy) -->
              <div
                :class="[
                  'bg-digimon-dark-800 rounded-xl p-4 border-2 transition-all',
                  item.participant.isActive ? 'border-digimon-orange-500 shadow-lg shadow-digimon-orange-500/20' : 'border-digimon-dark-700',
                ]"
              >
                <div class="flex gap-4">
                  <!-- Turn indicator -->
                  <div class="flex flex-col items-center justify-center w-12">
                    <div
                      :class="[
                        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                        item.participant.isActive ? 'bg-digimon-orange-500 text-white' : 'bg-digimon-dark-700 text-digimon-dark-400',
                      ]"
                    >
                      {{ index + 1 }}
                    </div>
                    <div class="text-xs text-digimon-dark-400 mt-1">
                      {{ item.participant.initiative }}
                    </div>
                  </div>

                  <!-- Entity info -->
                  <div class="flex-1">
                    <div class="flex items-center gap-3 mb-2">
                      <div class="w-10 h-10 rounded bg-digimon-dark-700 flex items-center justify-center overflow-hidden">
                        <img
                          v-if="getEntityDetails(item.participant)?.spriteUrl"
                          :src="getEntityDetails(item.participant)!.spriteUrl!"
                          :alt="getEntityDetails(item.participant)?.name || 'participant'"
                          class="max-w-full max-h-full object-contain"
                        />
                        <span v-else class="text-2xl">{{ getEntityDetails(item.participant)?.icon }}</span>
                      </div>
                      <div>
                        <h3 class="font-semibold text-white">
                          {{ getEntityDetails(item.participant)?.name || 'Unknown' }}
                        </h3>
                        <div class="text-xs text-digimon-dark-400">
                          {{ getEntityDetails(item.participant)?.species }}
                          <span v-if="getEntityDetails(item.participant)?.isEnemy" class="text-red-400 ml-1">(Enemy)</span>
                        </div>
                      </div>
                      <div :class="['ml-auto px-2 py-0.5 rounded text-xs uppercase', getStanceColor(item.participant.currentStance)]">
                        {{ item.participant.currentStance }}
                      </div>
                    </div>

                    <!-- Wounds bar -->
                    <div class="mb-2">
                      <div class="flex items-center gap-2 text-xs">
                        <span class="text-digimon-dark-400">Wounds:</span>
                        <div class="flex-1 h-2 bg-digimon-dark-600 rounded-full overflow-hidden">
                          <div
                            class="h-full transition-all duration-300"
                            :class="[
                              item.participant.currentWounds === 0 ? 'bg-green-500' :
                              item.participant.currentWounds < item.participant.maxWounds / 2 ? 'bg-yellow-500' :
                              item.participant.currentWounds < item.participant.maxWounds ? 'bg-orange-500' : 'bg-red-500'
                            ]"
                            :style="{ width: `${((item.participant.maxWounds - item.participant.currentWounds) / item.participant.maxWounds) * 100}%` }"
                          />
                        </div>
                        <span class="text-digimon-dark-300">{{ item.participant.currentWounds }}/{{ item.participant.maxWounds }}</span>
                      </div>
                    </div>

                    <!-- Actions remaining -->
                    <div class="flex gap-4 text-sm">
                      <div class="flex items-center gap-2">
                        <span class="text-digimon-dark-400">Actions:</span>
                        <div class="flex gap-1">
                          <div
                            v-for="i in 2"
                            :key="`action-${i}`"
                            :class="[
                              'w-4 h-4 rounded',
                              i <= item.participant.actionsRemaining.simple ? 'bg-blue-500' : 'bg-digimon-dark-600',
                            ]"
                          />
                        </div>
                        <span class="text-xs text-digimon-dark-400">
                          ({{ item.participant.actionsRemaining.simple }}/2)
                        </span>
                      </div>
                      <button
                        class="ml-auto text-xs text-digimon-dark-400 hover:text-white"
                        @click.stop="selectedParticipantId = item.participant.id"
                      >
                        Manage →
                      </button>
                    </div>

                    <!-- Effects -->
                    <div v-if="item.participant.activeEffects.length > 0" class="flex flex-wrap gap-1 mt-2">
                      <span
                        v-for="effect in item.participant.activeEffects"
                        :key="effect.id"
                        :class="[
                          'text-xs px-2 py-0.5 rounded',
                          effect.type === 'buff' && 'bg-green-900/30 text-green-400',
                          effect.type === 'debuff' && 'bg-red-900/30 text-red-400',
                          effect.type === 'status' && 'bg-yellow-900/30 text-yellow-400',
                        ]"
                        :title="effect.description"
                      >
                        {{ effect.name }} ({{ effect.duration }})
                      </span>
                    </div>
                  </div>

                  <!-- Actions (when active) -->
                  <div v-if="item.participant.isActive && currentEncounter.phase === 'combat'" class="flex flex-col gap-2">
                    <button
                      class="text-xs bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-2 py-1 rounded"
                      @click="rerollInitiative(item.participant.id)"
                    >
                      🎲 Reroll
                    </button>
                    <button
                      class="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-2 py-1 rounded"
                      @click="handleRemoveParticipant(item.participant.id)"
                    >
                      Remove
                    </button>
                  </div>
                  <div v-else-if="currentEncounter.phase === 'setup'" class="flex flex-col gap-2">
                    <button
                      class="text-xs bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-2 py-1 rounded"
                      @click="rerollInitiative(item.participant.id)"
                    >
                      🎲 Reroll
                    </button>
                    <button
                      class="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-2 py-1 rounded"
                      @click="handleRemoveParticipant(item.participant.id)"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              <!-- Partner Digimon Card (Indented Child) -->
              <div
                v-if="item.partnerDigimon"
                :class="[
                  'bg-digimon-dark-800 rounded-xl p-3 border transition-all ml-8',
                  canParticipantAct(item.partnerDigimon)
                    ? 'border-digimon-orange-400/50'
                    : 'border-digimon-dark-600',
                ]"
              >
                <div class="flex items-center gap-4">
                  <!-- Entity Info -->
                  <div class="flex items-center gap-3 flex-1">
                    <!-- Digimon Sprite -->
                    <div class="w-10 h-10 rounded-lg bg-digimon-dark-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      <img
                        v-if="getEntityDetails(item.partnerDigimon)?.spriteUrl"
                        :src="getEntityDetails(item.partnerDigimon)?.spriteUrl"
                        :alt="getEntityDetails(item.partnerDigimon)?.name"
                        class="max-w-full max-h-full object-contain"
                      />
                      <span v-else class="text-xl">🦖</span>
                    </div>

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-white truncate text-sm">
                          Partner: {{ getEntityDetails(item.partnerDigimon)?.name }}
                        </span>
                        <span class="text-xs text-digimon-dark-400">
                          {{ getEntityDetails(item.partnerDigimon)?.species || 'Digimon' }}
                        </span>
                      </div>
                    </div>

                    <!-- Stance Badge -->
                    <span
                      :class="[
                        'px-2 py-0.5 rounded text-xs font-medium uppercase flex-shrink-0',
                        getStanceColor(item.partnerDigimon.currentStance),
                      ]"
                    >
                      {{ item.partnerDigimon.currentStance }}
                    </span>
                  </div>
                </div>

                <!-- Wounds and Actions (Condensed) -->
                <div class="mt-2 flex items-center gap-4 text-xs">
                  <!-- Wounds -->
                  <div class="flex items-center gap-2 flex-1">
                    <span class="text-digimon-dark-400">HP:</span>
                    <div class="flex-1 bg-digimon-dark-700 rounded-full h-2 overflow-hidden">
                      <div
                        class="h-full transition-all duration-300"
                        :class="[
                          item.partnerDigimon.currentWounds === 0 ? 'bg-green-500' :
                          item.partnerDigimon.currentWounds < item.partnerDigimon.maxWounds / 2 ? 'bg-yellow-500' :
                          item.partnerDigimon.currentWounds < item.partnerDigimon.maxWounds ? 'bg-orange-500' : 'bg-red-500'
                        ]"
                        :style="{ width: `${((item.partnerDigimon.maxWounds - item.partnerDigimon.currentWounds) / item.partnerDigimon.maxWounds) * 100}%` }"
                      />
                    </div>
                    <span class="text-digimon-dark-300">{{ item.partnerDigimon.currentWounds }}/{{ item.partnerDigimon.maxWounds }}</span>
                  </div>

                  <!-- Actions -->
                  <div class="flex items-center gap-2">
                    <span class="text-digimon-dark-400">Actions:</span>
                    <div class="flex gap-0.5">
                      <div v-for="i in 2" :key="i" :class="['w-3 h-3 rounded', i <= item.partnerDigimon.actionsRemaining.simple ? 'bg-blue-500' : 'bg-digimon-dark-600']" />
                    </div>
                    <span class="text-digimon-dark-400">({{ item.partnerDigimon.actionsRemaining.simple }}/2)</span>
                  </div>

                  <button
                    class="text-xs text-digimon-dark-400 hover:text-white flex-shrink-0"
                    @click.stop="selectedParticipantId = item.partnerDigimon.id"
                  >
                    Manage →
                  </button>
                </div>

                <!-- Active Effects (if any) -->
                <div v-if="item.partnerDigimon.activeEffects.length > 0" class="flex flex-wrap gap-1 mt-2">
                  <span
                    v-for="effect in item.partnerDigimon.activeEffects"
                    :key="effect.id"
                    :class="[
                      'text-xs px-1.5 py-0.5 rounded',
                      effect.type === 'buff' && 'bg-green-900/30 text-green-400',
                      effect.type === 'debuff' && 'bg-red-900/30 text-red-400',
                      effect.type === 'status' && 'bg-blue-900/30 text-blue-400',
                    ]"
                  >
                    {{ effect.name }} ({{ effect.duration }})
                  </span>
                </div>
              </div>
            </template>

            <div v-if="hierarchicalParticipants.length === 0" class="text-center py-8 text-digimon-dark-400">
              No participants yet. Add Tamers and Digimon to begin.
            </div>
          </div>
        </div>

        <!-- Right sidebar -->
        <div class="space-y-4">
          <!-- Active Turn Actions -->
          <div v-if="activeParticipant && currentEncounter.phase === 'combat'" class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-orange-500">
            <h3 class="font-display text-lg font-semibold text-digimon-orange-400 mb-3">
              {{ getEntityDetails(activeParticipant)?.name }}'s Turn
            </h3>

            <!-- Quick Actions -->
            <div class="space-y-2 mb-4">
              <button
                :disabled="activeParticipant.actionsRemaining.simple < 1"
                class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-3 py-2 rounded text-sm font-medium"
                @click="useAction('simple', 'Used simple action (1 action)')"
              >
                Use Simple Action (1)
              </button>
              <button
                :disabled="activeParticipant.actionsRemaining.simple < 2"
                class="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-3 py-2 rounded text-sm font-medium"
                @click="useAction('complex', 'Used complex action (2 actions)')"
              >
                Use Complex Action (2)
              </button>
            </div>

            <!-- Stance Selector -->
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-2">Change Stance</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="stance in ['neutral', 'defensive', 'offensive', 'sniper', 'brave'] as const"
                  :key="stance"
                  :class="[
                    'px-2 py-1 rounded text-xs capitalize transition-colors',
                    activeParticipant.currentStance === stance
                      ? getStanceColor(stance) + ' text-white'
                      : 'bg-digimon-dark-700 text-digimon-dark-300 hover:bg-digimon-dark-600',
                  ]"
                  @click="changeStance(stance)"
                >
                  {{ stance }}
                </button>
              </div>
            </div>
          </div>

          <!-- Environmental Hazards -->
          <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-3">Environmental Hazards</h3>
            <HazardManager
              :hazards="hazards"
              @add="handleAddHazard"
              @remove="handleRemoveHazard"
              @update="handleUpdateHazard"
            />
          </div>

          <!-- Pending Player Requests -->
          <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-3">
              Pending Player Requests
            </h3>

            <div v-if="pendingRequests.length === 0" class="text-digimon-dark-400 text-sm">
              No pending requests
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="request in pendingRequests"
                :key="request.id"
                class="bg-digimon-dark-700 rounded-lg p-3 flex justify-between items-center"
              >
                <div>
                  <span class="text-white font-medium">
                    {{ tamerMap.get(request.targetTamerId)?.name || 'Unknown Player' }}
                  </span>
                  <span class="text-digimon-dark-400 text-sm ml-2">
                    {{ request.type === 'digimon-selection' ? 'Select Digimon' : request.type === 'initiative-roll' ? 'Roll Initiative' : 'Roll Dodge' }}
                  </span>
                </div>
                <button
                  @click="cancelRequest(currentEncounter.id, request.id)"
                  class="text-red-400 hover:text-red-300 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>

          <!-- Unprocessed Player Responses -->
          <div
            v-if="unprocessedResponses.length > 0"
            class="bg-green-900/20 border border-green-500 rounded-xl p-4"
          >
            <h3 class="font-display text-lg font-semibold text-green-400 mb-3">
              Player Responses ({{ unprocessedResponses.length }})
            </h3>

            <div class="space-y-2">
              <div
                v-for="response in unprocessedResponses"
                :key="response.id"
                class="bg-digimon-dark-800 rounded-lg p-3 flex justify-between items-center"
              >
                <div>
                  <span class="text-white font-medium">
                    {{ tamerMap.get(response.tamerId)?.name || 'Unknown Player' }}
                  </span>
                  <span class="text-digimon-dark-400 text-sm ml-2">
                    {{ response.response.type === 'digimon-selected' ? 'Selected Digimon' : response.response.type === 'initiative-rolled' ? 'Rolled Initiative: ' + response.response.initiative : 'Rolled Dodge: ' + response.response.dodgeRoll }}
                  </span>
                </div>
                <button
                  v-if="response.response.type !== 'dodge-rolled'"
                  @click="processResponse(response)"
                  class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-semibold transition-colors"
                >
                  Process
                </button>
                <span v-else class="text-green-400 text-sm font-semibold">Processed</span>
              </div>
            </div>
          </div>

          <!-- Battle Log -->
          <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-3">Battle Log</h3>
            <div class="space-y-2 max-h-96 overflow-y-auto">
              <div
                v-for="entry in battleLog"
                :key="entry.id"
                class="text-sm border-l-2 border-digimon-dark-600 pl-3 py-1"
              >
                <div class="text-digimon-dark-400 text-xs">
                  Round {{ entry.round }} • {{ entry.actorName }}
                </div>
                <div class="text-white">{{ entry.result }}</div>
              </div>
              <div v-if="battleLog.length === 0" class="text-digimon-dark-400 text-sm">
                No actions yet.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Participant Modal -->
      <Teleport to="body">
        <div
          v-if="showAddParticipant"
          class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          @click.self="showAddParticipant = false"
        >
          <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border border-digimon-dark-700">
            <h2 class="font-display text-xl font-semibold text-white mb-4">Add Participant</h2>

            <div class="mb-4">
              <label class="block text-sm text-digimon-dark-400 mb-2">Type</label>
              <div class="flex gap-2">
                <button
                  :class="[
                    'flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm',
                    selectedEntityType === 'digimon'
                      ? 'bg-digimon-orange-500 text-white'
                      : 'bg-digimon-dark-700 text-digimon-dark-400',
                  ]"
                  @click="selectedEntityType = 'digimon'; selectedEntityId = ''"
                >
                  🦖 Partner
                </button>
                <button
                  :class="[
                    'flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm',
                    selectedEntityType === 'enemy'
                      ? 'bg-digimon-orange-500 text-white'
                      : 'bg-digimon-dark-700 text-digimon-dark-400',
                  ]"
                  @click="selectedEntityType = 'enemy'; selectedEntityId = ''"
                >
                  ⚔️ Enemy
                </button>
                <button
                  :class="[
                    'flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm',
                    selectedEntityType === 'tamer'
                      ? 'bg-digimon-orange-500 text-white'
                      : 'bg-digimon-dark-700 text-digimon-dark-400',
                  ]"
                  @click="selectedEntityType = 'tamer'; selectedEntityId = ''"
                >
                  👤 Tamer
                </button>
              </div>
            </div>

            <div class="mb-6">
              <label class="block text-sm text-digimon-dark-400 mb-2">
                Select {{ selectedEntityType === 'digimon' ? 'Partner Digimon' : selectedEntityType === 'enemy' ? 'Enemy Digimon' : 'Tamer' }}
              </label>
              <select
                v-model="selectedEntityId"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              >
                <option value="">Choose...</option>
                <template v-if="selectedEntityType === 'digimon'">
                  <option v-for="d in availableDigimon" :key="d.id" :value="d.id">
                    {{ d.name }} ({{ d.stage }})
                  </option>
                </template>
                <template v-else-if="selectedEntityType === 'enemy'">
                  <option v-for="d in availableEnemyDigimon" :key="d.id" :value="d.id">
                    {{ d.name }} ({{ d.stage }})
                  </option>
                </template>
                <template v-else>
                  <option v-for="t in availableTamers" :key="t.id" :value="t.id">
                    {{ t.name }}
                  </option>
                </template>
              </select>
            </div>

            <div class="mb-6">
              <label class="block text-sm text-digimon-dark-400 mb-2">Quantity</label>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="w-10 h-10 bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg text-white font-bold"
                  @click="addQuantity = Math.max(1, addQuantity - 1)"
                >
                  -
                </button>
                <input
                  v-model.number="addQuantity"
                  type="number"
                  min="1"
                  max="20"
                  class="w-20 bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
                <button
                  type="button"
                  class="w-10 h-10 bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg text-white font-bold"
                  @click="addQuantity = Math.min(20, addQuantity + 1)"
                >
                  +
                </button>
              </div>
              <p class="text-xs text-digimon-dark-400 mt-2">
                {{ selectedEntityType === 'tamer'
                  ? 'Tamers must respond with digimon selection before rolling initiative'
                  : 'Each will roll initiative separately (3d6 + Agility)' }}
              </p>
            </div>

            <div class="flex gap-3">
              <button
                :disabled="!selectedEntityId"
                class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                       text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                @click="handleAddParticipant"
              >
                {{ selectedEntityType === 'tamer'
                  ? 'Request Digimon Selection'
                  : `Add ${addQuantity > 1 ? `${addQuantity}x ` : ''}& Roll Initiative` }}
              </button>
              <button
                class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                       rounded-lg font-semibold transition-colors"
                @click="showAddParticipant = false"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Participant Management Modal -->
      <Teleport to="body">
        <div
          v-if="selectedParticipant"
          class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          @click.self="selectedParticipantId = null"
        >
          <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-lg border border-digimon-dark-700 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-start mb-4">
              <div class="flex items-center gap-3">
                <span class="text-3xl">{{ getEntityDetails(selectedParticipant)?.icon }}</span>
                <div>
                  <h2 class="font-display text-xl font-semibold text-white">
                    {{ getEntityDetails(selectedParticipant)?.name }}
                  </h2>
                  <div class="text-sm text-digimon-dark-400">
                    {{ getEntityDetails(selectedParticipant)?.species }}
                  </div>
                </div>
              </div>
              <button
                class="text-digimon-dark-400 hover:text-white text-xl"
                @click="selectedParticipantId = null"
              >
                ✕
              </button>
            </div>

            <!-- Wound Tracker -->
            <div class="mb-6">
              <h3 class="font-semibold text-white mb-3">Wounds</h3>
              <WoundTracker
                :max-wounds="selectedParticipant.maxWounds"
                :current-wounds="selectedParticipant.currentWounds"
                :name="getEntityDetails(selectedParticipant)?.name || 'Unknown'"
                @update="(wounds) => updateWounds(selectedParticipant!.id, wounds)"
              />
            </div>

            <!-- Effect Manager -->
            <EffectManager
              :effects="selectedParticipant.activeEffects"
              :participant-name="getEntityDetails(selectedParticipant)?.name || 'Unknown'"
              @add="(effect) => addEffect(selectedParticipant!.id, effect)"
              @remove="(effectId) => removeEffect(selectedParticipant!.id, effectId)"
            />

            <!-- Quick Stats -->
            <div class="mt-6 bg-digimon-dark-700 rounded-lg p-4">
              <h3 class="font-semibold text-white mb-3">Combat Stats</h3>
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span class="text-digimon-dark-400">Initiative:</span>
                  <span class="text-white ml-2">{{ selectedParticipant.initiative }}</span>
                </div>
                <div>
                  <span class="text-digimon-dark-400">Stance:</span>
                  <span class="text-white ml-2 capitalize">{{ selectedParticipant.currentStance }}</span>
                </div>
                <div>
                  <span class="text-digimon-dark-400">Actions Remaining:</span>
                  <span class="text-white ml-2">{{ selectedParticipant.actionsRemaining.simple }}/2</span>
                  <span class="text-xs text-digimon-dark-400 ml-2">
                    (Simple: 1 action, Complex: 2 actions)
                  </span>
                </div>
              </div>
            </div>

            <button
              class="w-full mt-4 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                     rounded-lg font-semibold transition-colors"
              @click="selectedParticipantId = null"
            >
              Close
            </button>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
