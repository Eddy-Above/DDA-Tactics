<script setup lang="ts">
import type { Encounter } from '../../server/db/schema'
import type { CombatParticipant, BattleLogEntry, Hazard } from '../../composables/useEncounters'
import type { Digimon } from '../../server/db/schema'
import type { Tamer } from '../../server/db/schema'
import { getUnlockedSpecialOrders, getOrderActionCost, getOrderUsageLimit } from '../../utils/specialOrders'
import { DIGIVOLVE_WILLPOWER_DC } from '../../types'

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
  performAttack,
  performNpcAttack,
  deleteResponse,
} = useEncounters()

const { digimonList, fetchDigimon, rollInitiative: rollDigimonInitiative, calculateDerivedStats: calcDigimonStats } = useDigimon()
const { tamers, fetchTamers, calculateDerivedStats: calcTamerStats } = useTamers()
const { fetchEvolutionLines, evolutionLines, getCurrentStage, getEvolutionOptions, updateEvolutionLine } = useEvolution()

// Special Orders state
const showSpecialOrdersModal = ref(false)
const specialOrderTargetId = ref<string | null>(null)

const showAddParticipant = ref(false)
const selectedEntityType = ref<'digimon' | 'enemy' | 'tamer'>('digimon')
const selectedEntityId = ref('')
const selectedNpcEvoLineId = ref<string>('')
const addQuantity = ref(1)
const showRequestPanel = ref(false)
const selectedTamerForRequest = ref('')

// Attack execution state
const selectedAttack = ref<{ participant: any; attack: any } | null>(null)
const showTargetSelector = ref(false)
const selectedTargetId = ref<string | null>(null)
const bolsterAttackEnabled = ref(false)
const bolsterAttackType = ref<'damage-accuracy' | 'bit-cpu'>('damage-accuracy')

// Direct action state
const showDirectTargetSelector = ref(false)
const pendingDirectBolstered = ref(false)

// Willpower roll modal state for digivolution
const showWillpowerRollModal = ref(false)
const willpowerRollResult = ref<{ rolls: number[]; total: number } | null>(null)
const hasRolledWillpower = ref(false)
const pendingDigivolve = ref<{ participant: CombatParticipant; targetChainIndex: number; targetSpecies: string; tamer: Tamer } | null>(null)

// GM Intercede modal state
const showGmIntercedeModal = ref(false)
const gmIntercedeRequest = ref<any>(null)
const gmIntercedeLoading = ref(false)
const showGmIntercedeResultModal = ref(false)
const gmIntercedeResultData = ref<any>(null)
const gmIntercedeView = ref<'main' | 'select-interceptor' | 'select-optout'>('main')
const gmOptOutSelections = ref<Set<string>>(new Set())

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

// Get the participant whose turn it currently is
const currentTurnParticipant = computed(() => {
  if (!currentEncounter.value) return null
  if (currentEncounter.value.phase !== 'combat') return null

  const turnOrder = (currentEncounter.value.turnOrder as string[]) || []
  const currentIndex = currentEncounter.value.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  if (!currentTurnParticipantId) return null

  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  return participants.find(p => p.id === currentTurnParticipantId) || null
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

// Get display name with numbering for duplicate enemies
function getDisplayName(participant: CombatParticipant): string {
  const participants = (currentEncounter.value?.participants as CombatParticipant[]) || []

  let baseName: string
  if (participant.type === 'digimon') {
    baseName = digimonMap.value.get(participant.entityId)?.name || 'Unknown'
  } else {
    baseName = tamerMap.value.get(participant.entityId)?.name || 'Unknown'
  }

  // Only number enemy digimon when duplicates exist
  if (participant.type === 'digimon') {
    const digimonEntry = digimonMap.value.get(participant.entityId)
    if (digimonEntry?.isEnemy) {
      const duplicates = participants.filter(p => p.entityId === participant.entityId)
      if (duplicates.length > 1) {
        const sorted = [...duplicates].sort((a, b) => a.id.localeCompare(b.id))
        const index = sorted.findIndex(p => p.id === participant.id)
        return `${baseName} ${index + 1}`
      }
    }
  }
  return baseName
}

// Get entity details for a participant
function getEntityDetails(participant: CombatParticipant) {
  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    if (!digimon) return null
    const derived = calcDigimonStats(digimon)
    return {
      name: getDisplayName(participant),
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
      spriteUrl: tamer.spriteUrl || null,
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

// Get attacks for a participant
function getParticipantAttacks(participant: CombatParticipant) {
  if (participant.type !== 'digimon') return []

  // Look up digimon in digimonMap
  const digimon = digimonMap.value.get(participant.entityId)
  const attacks = digimon?.attacks || []
  // Filter out attacks already used this turn
  const usedIds = new Set(participant.usedAttackIds || [])
  return attacks.filter((a: any) => !usedIds.has(a.id))
}

// Calculate attack stats based on digimon stats, qualities, and tags (mirrors AttackSelector logic)
function getAttackStats(participant: CombatParticipant, attack: any) {
  if (participant.type !== 'digimon') {
    return { accuracy: 0, damage: 0, accuracyBonus: 0, damageBonus: 0, notes: [], range: 0, effectiveLimit: 0, attackRange: null, attackEffectiveLimit: null }
  }

  const digimon = digimonMap.value.get(participant.entityId)
  if (!digimon) {
    return { accuracy: 0, damage: 0, accuracyBonus: 0, damageBonus: 0, notes: [], range: 0, effectiveLimit: 0, attackRange: null, attackEffectiveLimit: null }
  }

  // Get base stats (baseStats + bonusStats), then apply stance modifier
  const rawAccuracy = (digimon.baseStats?.accuracy ?? 0) + ((digimon as any).bonusStats?.accuracy ?? 0)
  const baseAccuracy = applyStanceToAccuracy(rawAccuracy, participant.currentStance)
  const baseDamage = (digimon.baseStats?.damage ?? 0) + ((digimon as any).bonusStats?.damage ?? 0)

  let damageBonus = 0
  let accuracyBonus = 0
  let notes: string[] = []

  // Helper functions
  const hasQuality = (id: string) => digimon.qualities?.some((q: any) => q.id === id)
  const hasTag = (pattern: string) => attack.tags?.some((t: string) => t.toLowerCase().includes(pattern.toLowerCase()))
  const hasWeaponTag = attack.tags?.some((t: string) => /^Weapon\s+/i.test(t))
  const hasSignatureTag = attack.tags?.some((t: string) => t.toLowerCase().includes('signature'))

  // === GLOBAL QUALITY BONUSES ===

  // True Guardian: -2 Accuracy (global penalty)
  if (hasQuality('true-guardian')) {
    accuracyBonus -= 2
  }

  // Huge Power: Reroll 1s on Accuracy
  if (hasQuality('huge-power')) {
    notes.push(attack.range === 'melee' ? 'Reroll 1s' : 'Reroll 1s (1/round)')
  }

  // Overkill: Reroll 2s on Accuracy (once per round)
  if (hasQuality('overkill')) {
    notes.push('Reroll 2s (1/round)')
  }

  // Aggressive Flank: +RAM to Accuracy when near allies
  if (hasQuality('aggressive-flank')) {
    notes.push('+RAM ACC (near ally)')
  }

  // === DATA OPTIMIZATION BONUSES ===

  const dataOptQuality = digimon.qualities?.find((q: any) => q.id === 'data-optimization')
  const dataOpt = dataOptQuality?.choiceId || digimon.dataOptimization

  if (dataOpt === 'close-combat') {
    if (attack.range === 'melee') {
      accuracyBonus += 2
    } else if (attack.range === 'ranged') {
      accuracyBonus -= 1
    }
  } else if (dataOpt === 'ranged-striker') {
    if (attack.range === 'ranged') {
      accuracyBonus += 2
    }
  }

  // === DATA SPECIALIZATION BONUSES ===

  // Mobile Artillery: Add CPU to [Area] attack damage
  if (hasQuality('mobile-artillery') && hasTag('area')) {
    notes.push('+CPU DMG (Area)')
  }

  // Hit and Run: [Charge] attacks add RAM to Damage
  if (hasQuality('hit-and-run') && hasTag('charge')) {
    notes.push('+RAM DMG (Charge)')
  }

  // === WEAPON-TAGGED ATTACK BONUSES (Digizoid Weapons) ===

  if (hasWeaponTag) {
    // Digizoid Weapon: Chrome - +2 ACC, +1 DMG
    if (hasQuality('digizoid-weapon-chrome')) {
      accuracyBonus += 2
      damageBonus += 1
    }
    // Digizoid Weapon: Black - +2 ACC + random bonus
    if (hasQuality('digizoid-weapon-black')) {
      accuracyBonus += 2
      notes.push('+random (d6)')
    }
    // Digizoid Weapon: Brown - +2 Dodge, +2 DMG
    if (hasQuality('digizoid-weapon-brown')) {
      damageBonus += 2
    }
    // Digizoid Weapon: Blue - +2 ACC, +2 DMG, auto success
    if (hasQuality('digizoid-weapon-blue')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 auto success')
    }
    // Digizoid Weapon: Gold - +4 ACC, +1 DMG
    if (hasQuality('digizoid-weapon-gold')) {
      accuracyBonus += 4
      damageBonus += 1
    }
    // Digizoid Weapon: Obsidian - +2 ACC, +2 DMG, +1 AP
    if (hasQuality('digizoid-weapon-obsidian')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 Armor Piercing')
    }
    // Digizoid Weapon: Red - +6 DMG
    if (hasQuality('digizoid-weapon-red')) {
      damageBonus += 6
    }
  }

  // === SIGNATURE MOVE BONUSES ===

  if (hasSignatureTag) {
    // Signature Move: +Attacks to Accuracy and Damage (round 3+)
    notes.push('+Attacks ACC/DMG (R3+)')
  }

  // === TAG-BASED BONUSES ===

  if (attack.tags) {
    for (const tag of attack.tags) {
      // Weapon I/II/III adds +Rank to both accuracy and damage
      const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
      if (weaponMatch) {
        const rankStr = weaponMatch[1]
        const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
        const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
        damageBonus += rank
        accuracyBonus += rank
      }

      // Certain Strike adds +2 accuracy
      if (tag.startsWith('Certain Strike')) {
        accuracyBonus += 2
      }
    }
  }

  // Directed effect bonus
  const directedEffect = participant.activeEffects?.find(e => e.name === 'Directed')
  if (directedEffect?.value) {
    accuracyBonus += directedEffect.value
    notes.push(`Directed +${directedEffect.value}`)
  }

  // Return calculated stats
  const stats = calcDigimonStats(digimon)

  // Per-attack range: melee = 1 (or Reach x 2), ranged = calculated
  const reachQuality = (digimon as any).qualities?.find((q: any) => q.id === 'reach')
  const reachRanks = reachQuality?.ranks || 0
  let attackRange: number | null = null
  let attackEffectiveLimit: number | null = null
  if (attack.range === 'melee') {
    attackRange = reachRanks > 0 ? reachRanks * 2 : 1
  } else {
    attackRange = stats.range
    attackEffectiveLimit = stats.effectiveLimit
  }

  return {
    accuracy: baseAccuracy + accuracyBonus,
    damage: baseDamage + damageBonus,
    accuracyBonus,
    damageBonus,
    notes,
    range: stats.range,
    effectiveLimit: stats.effectiveLimit,
    attackRange,
    attackEffectiveLimit,
  }
}

// Check if participant can use an attack (requires 1 simple action)
function canUseAttack(participant: CombatParticipant, attack: any): boolean {
  const requiredActions = 1
  return (participant.actionsRemaining?.simple || 0) >= requiredActions
}

// Check if target is player-controlled
function isPlayerControlled(participant: CombatParticipant): boolean {
  if (participant.type === 'tamer') {
    // All tamers are player-controlled
    return true
  }
  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    // Has partnerId = player-controlled partner digimon
    return !!digimon?.partnerId
  }
  return false  // Enemies are NPC-controlled
}

// Get dodge pool for a participant (reduced by successive dodge penalty)
function getDodgePool(participant: CombatParticipant): number {
  let pool = 3  // Fallback
  if (participant.type === 'digimon') {
    const digimon = digimonMap.value.get(participant.entityId)
    if (digimon) {
      const totalDodge = (digimon.baseStats?.dodge ?? 0) + ((digimon as any).bonusStats?.dodge ?? 0)
      pool = totalDodge || 3
    }
  } else if (participant.type === 'tamer') {
    const tamer = tamerMap.value.get(participant.entityId)
    if (tamer) {
      const derived = calcTamerStats(tamer)
      pool = derived.dodgePool || 3
    }
  }
  pool = applyStanceToDodge(pool, participant.currentStance)
  pool = Math.max(1, pool - (participant.dodgePenalty ?? 0))

  // Add Directed effect bonus to dodge pool
  const directedEffect = participant.activeEffects?.find(e => e.name === 'Directed')
  if (directedEffect?.value) {
    pool += directedEffect.value
  }

  return pool
}

// Get participant name (tamer or digimon) for display
function getParticipantName(participantId: string): string | null {
  if (!currentEncounter.value) return null

  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  const participant = participants.find((p: any) => p.id === participantId)
  if (!participant) return null

  if (participant.type === 'tamer') {
    const tamer = tamerMap.value.get(participant.entityId)
    return tamer?.name || null
  } else if (participant.type === 'digimon') {
    return getDisplayName(participant as CombatParticipant)
  }
  return null
}

function getGmIntercedeOptions(request: any): any[] {
  const participants = (currentEncounter.value?.participants as any[]) || []
  return participants.filter((p: any) =>
    (p.type === 'tamer' || p.type === 'digimon') &&
    p.id !== request.data?.attackerId &&
    p.id !== request.data?.targetId
  )
}

// Get GM character opt-outs from participant data
const gmCharacterOptOuts = computed(() => {
  if (!currentEncounter.value) return {} as Record<string, string[]>
  const participants = (currentEncounter.value.participants as any[]) || []
  const gmP = participants.find((p: any) => p.id === 'gm')
  return (gmP?.gmCharacterOptOuts || {}) as Record<string, string[]>
})

// All GM intercede options (unfiltered, for opt-out selection view)
const gmIntercedeAllOptions = computed(() => {
  if (!gmIntercedeRequest.value) return []
  return getGmIntercedeOptions(gmIntercedeRequest.value).map((p: any) => ({
    id: p.id,
    name: getParticipantName(p.id) || p.id,
  }))
})

// GM intercede options filtered by per-character opt-outs (for interceptor selection)
const gmIntercedeOptionsWithNames = computed(() => {
  if (!gmIntercedeRequest.value) return []
  const targetId = gmIntercedeRequest.value.data?.targetId
  const optedOut = targetId ? (gmCharacterOptOuts.value[targetId] || []) : []
  return gmIntercedeAllOptions.value.filter((o: any) => !optedOut.includes(o.id))
})

// Auto-detect GM intercede offers
const gmIntercedeOffer = computed(() => {
  return pendingRequests.value.find(
    (r: any) => r.type === 'intercede-offer' && r.targetTamerId === 'GM'
  ) || null
})

// Auto-open GM intercede modal when a GM intercede request appears
watch(gmIntercedeOffer, (newVal) => {
  if (newVal && !showGmIntercedeModal.value) {
    openGmIntercedeModal(newVal)
  }
  // Close modal if the offer was claimed by someone else
  if (!newVal && showGmIntercedeModal.value) {
    showGmIntercedeModal.value = false
    gmIntercedeRequest.value = null
  }
})

function openGmIntercedeModal(request: any) {
  gmIntercedeRequest.value = request
  gmIntercedeView.value = 'main'
  gmOptOutSelections.value = new Set()
  showGmIntercedeModal.value = true
}

function closeGmIntercedeResultModal() {
  showGmIntercedeResultModal.value = false
  gmIntercedeResultData.value = null
}

// Get all valid targets for an attack (exclude the attacker)
function getAttackTargets(attackerId: string): CombatParticipant[] {
  if (!currentEncounter.value) return []
  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  return participants.filter(p => p.id !== attackerId && p.type !== 'gm')
}

// Open target selection modal
function selectAttackAndShowTargets(participant: CombatParticipant, attack: any) {
  selectedAttack.value = { participant, attack }
  bolsterAttackEnabled.value = false
  bolsterAttackType.value = 'damage-accuracy'
  showTargetSelector.value = true
}

// Check if an attack can be bolstered
function canBolsterAttack(participant: CombatParticipant, attack: any): boolean {
  if (participant.type !== 'digimon') return false
  if ((participant.actionsRemaining?.simple || 0) < 2) return false
  if ((participant.digimonBolsterCount ?? 0) >= 2) return false
  if (attack.tags?.some((t: string) => t.toLowerCase().includes('signature'))) return false
  return true
}

// Confirm attack and execute
async function confirmAttack(target: CombatParticipant) {
  if (!selectedAttack.value || !currentEncounter.value) return

  try {
    const { participant, attack } = selectedAttack.value

    // Calculate accuracy with bolster bonus
    const attackStats = getAttackStats(participant, attack)
    let accuracyPool = attackStats.accuracy
    if (bolsterAttackEnabled.value && bolsterAttackType.value === 'damage-accuracy') {
      accuracyPool += 2
    }

    // Roll accuracy (count successes: 5+ = 1 success)
    const accuracyDiceResults = []
    for (let i = 0; i < accuracyPool; i++) {
      accuracyDiceResults.push(Math.floor(Math.random() * 6) + 1)
    }
    const accuracySuccesses = accuracyDiceResults.filter(d => d >= 5).length

    // ALL attacks route through intercede-offer
    // Server handles: intercede offers, dodge requests, or NPC auto-resolve
    try {
      await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/intercede-offer`, {
        method: 'POST',
        body: {
          attackerId: participant.id,
          targetId: target.id,
          accuracySuccesses,
          accuracyDice: accuracyDiceResults,
          attackId: attack.id,
          attackData: {
            dicePool: accuracyPool,
            attackStats: getAttackStats(participant, attack),
          },
          bolstered: bolsterAttackEnabled.value,
          bolsterType: bolsterAttackEnabled.value ? bolsterAttackType.value : undefined,
        },
      })
      // Add attack log entry
      const entity = getEntityDetails(participant)
      const targetEntity = getEntityDetails(target)
      await addBattleLogEntry(currentEncounter.value.id, {
        round: currentEncounter.value.round,
        actorId: participant.id,
        actorName: entity?.name || 'Unknown',
        action: 'Attack',
        target: targetEntity?.name || 'Unknown',
        result: `${accuracyPool}d6 => [${accuracyDiceResults.join(',')}] = ${accuracySuccesses} successes`,
        damage: null,
        effects: ['Attack'],
      })
      showTargetSelector.value = false
      selectedAttack.value = null
      await fetchEncounter(currentEncounter.value.id)
    } catch (e: any) {
      console.error('Attack failed:', e)
      alert(e?.data?.message || 'Failed to execute attack')
    }
  } catch (error) {
    console.error('Error performing attack:', error)
  }
}

// Cancel attack selection
function cancelAttackSelection() {
  showTargetSelector.value = false
  selectedAttack.value = null
  selectedTargetId.value = null
}

// Cancel all intercede offers for a group (GM can manually cancel)
async function cancelIntercedeGroup(intercedeGroupId: string) {
  if (!currentEncounter.value || !intercedeGroupId) return
  const requests = (currentEncounter.value.pendingRequests as any[]) || []
  const groupRequests = requests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)
  for (const req of groupRequests) {
    await cancelRequest(currentEncounter.value.id, req.id)
  }
  await fetchEncounter(currentEncounter.value.id)
}

// GM intercede response functions
async function handleGmIntercedeClaim(requestId: string, interceptorId: string) {
  if (!currentEncounter.value) return

  const capturedRequest = gmIntercedeRequest.value
  gmIntercedeLoading.value = true
  try {
    const result = await $fetch<any>(`/api/encounters/${currentEncounter.value.id}/actions/intercede-claim`, {
      method: 'POST', body: { requestId, interceptorParticipantId: interceptorId }
    })

    showGmIntercedeModal.value = false

    // Extract intercede result from API response to show result modal
    if (result && capturedRequest) {
      const battleLog = (result.battleLog as any[]) || []
      const intercedeEntry = battleLog.findLast(
        (entry: any) =>
          entry.actorId === interceptorId &&
          typeof entry.action === 'string' &&
          entry.action.startsWith('Interceded for')
      )

      if (intercedeEntry) {
        gmIntercedeResultData.value = {
          attackerName: capturedRequest.data.attackerName,
          targetName: capturedRequest.data.targetName,
          interceptorName: intercedeEntry.actorName,
          accuracySuccesses: capturedRequest.data.accuracySuccesses,
          finalDamage: intercedeEntry.finalDamage,
          baseDamage: intercedeEntry.baseDamage,
          netSuccesses: intercedeEntry.netSuccesses,
          targetArmor: intercedeEntry.targetArmor,
          armorPiercing: intercedeEntry.armorPiercing,
          effectiveArmor: intercedeEntry.effectiveArmor,
        }
        showGmIntercedeResultModal.value = true
      }
    }

    await fetchEncounter(currentEncounter.value.id)
  } catch (e: any) {
    if (e?.statusCode === 409) {
      alert('Another player already interceded for this attack!')
    } else {
      alert(e?.data?.message || 'Intercede failed')
    }
  } finally {
    gmIntercedeLoading.value = false
    gmIntercedeRequest.value = null
  }
}

async function handleGmIntercedeSkip(requestId: string, optOut = false) {
  if (!currentEncounter.value) return
  gmIntercedeLoading.value = true
  try {
    await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/intercede-skip`, {
      method: 'POST', body: { requestId, optOut }
    })
    showGmIntercedeModal.value = false
    gmIntercedeRequest.value = null
    await fetchEncounter(currentEncounter.value.id)
  } finally {
    gmIntercedeLoading.value = false
  }
}

// Save per-character opt-outs for GM intercede (doesn't skip the request, just saves preferences)
async function handleGmSaveCharacterOptOuts() {
  if (!currentEncounter.value || !gmIntercedeRequest.value) return
  gmIntercedeLoading.value = true
  try {
    await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/intercede-skip`, {
      method: 'POST',
      body: {
        requestId: gmIntercedeRequest.value.id,
        characterOptOuts: Array.from(gmOptOutSelections.value),
      }
    })
    await fetchEncounter(currentEncounter.value.id)
    gmIntercedeView.value = 'main'
  } finally {
    gmIntercedeLoading.value = false
  }
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

    // Look up evolution line for partner digimon or NPC
    let evoLineId: string | undefined
    if (selectedEntityType.value === 'digimon') {
      const matchingLine = evolutionLines.value.find((line) => {
        const stage = getCurrentStage(line)
        return stage?.digimonId === selectedEntityId.value
      })
      if (matchingLine) evoLineId = matchingLine.id
    } else if (selectedEntityType.value === 'enemy' && quantity === 1 && selectedNpcEvoLineId.value) {
      evoLineId = selectedNpcEvoLineId.value
    }

    const participant = createParticipant(
      selectedEntityType.value === 'enemy' ? 'digimon' : selectedEntityType.value,
      selectedEntityId.value,
      initiative,
      initiativeRoll,
      maxWounds,
      evoLineId,
      selectedEntityType.value === 'enemy' ? true : undefined
    )

    const result = await addParticipant(currentEncounter.value.id, participant, digimonMap.value)
  }

  showAddParticipant.value = false
  selectedEntityId.value = ''
  selectedNpcEvoLineId.value = ''
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
    if (!request && response.response.type !== 'dodge-rolled') {
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

        // Remove response from list
        const currentResponses = currentEncounter.value.requestResponses || []
        const updatedResponses = currentResponses.filter(r => r.id !== response.id)
        await updateEncounter(currentEncounter.value.id, {
          requestResponses: updatedResponses
        })
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

      // Remove response from list
      const currentResponsesForDigimon = currentEncounter.value.requestResponses || []
      const updatedResponsesForDigimon = currentResponsesForDigimon.filter(r => r.id !== response.id)
      await updateEncounter(currentEncounter.value.id, {
        requestResponses: updatedResponsesForDigimon
      })
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

        // Look up evolution line for this partner digimon
        const matchingEvoLine = evolutionLines.value.find((line) => {
          const stage = getCurrentStage(line)
          return stage?.digimonId === digimon.id
        })

        // Create BOTH participants with the same initiative
        const digimonParticipant = createParticipant(
          'digimon',
          digimon.id,
          response.response.initiative,
          response.response.initiativeRoll,
          digimonDerived.woundBoxes,
          matchingEvoLine?.id
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

          // Remove response from list
          const respForInitiative = currentEncounter.value.requestResponses || []
          const updatedRespForInitiative = respForInitiative.filter(r => r.id !== response.id)
          await updateEncounter(currentEncounter.value.id, {
            requestResponses: updatedRespForInitiative
          })
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

              // Remove response from list
              const respForTamer = currentEncounter.value.requestResponses || []
              const updatedRespForTamer = respForTamer.filter(r => r.id !== response.id)
              await updateEncounter(currentEncounter.value.id, {
                requestResponses: updatedRespForTamer
              })
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

              // Remove response from list
              const respForTamerExisting = currentEncounter.value.requestResponses || []
              const updatedRespForTamerExisting = respForTamerExisting.filter(r => r.id !== response.id)
              await updateEncounter(currentEncounter.value.id, {
                requestResponses: updatedRespForTamerExisting
              })
            }
          }
        } else {
          console.error('Tamer not found:', response.tamerId)
        }
      }
    }
    // Dodge responses: damage already auto-calculated server-side. Just clean up.
    if (response.response.type === 'dodge-rolled') {
      if (request) {
        await cancelRequest(currentEncounter.value.id, request.id)
      }
      await deleteResponse(currentEncounter.value.id, response.id)
      await fetchEncounter(currentEncounter.value.id)
    }
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

  await nextTurn(currentEncounter.value.id, digimonMap.value)

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
    // Refresh evolution lines to get latest currentStageIndex values
    await fetchEvolutionLines()

    // Auto-devolve all partner digimon to rookie stage
    const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
    for (const p of participants) {
      if (p.type === 'digimon' && p.evolutionLineId) {
        const evoLine = evolutionLines.value.find(l => l.id === p.evolutionLineId)
        if (evoLine) {
          const chain = typeof evoLine.chain === 'string' ? JSON.parse(evoLine.chain) : evoLine.chain
          // Find rookie entry (or fall back to first entry)
          const rookieIndex = chain.findIndex((e: any) => e.stage === 'rookie')
          const targetIndex = rookieIndex >= 0 ? rookieIndex : 0
          if (evoLine.currentStageIndex !== targetIndex) {
            await updateEvolutionLine(p.evolutionLineId, { currentStageIndex: targetIndex })
          }
        }
      }
    }

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

// Get the tamer for a partner digimon participant
function getTamerForDigimonParticipant(participant: CombatParticipant): Tamer | null {
  const digimonEntity = digimonMap.value.get(participant.entityId)
  if (!digimonEntity?.partnerId) return null
  return tamerMap.value.get(digimonEntity.partnerId) || null
}

// Digivolve / Devolve handler
async function handleDigivolve(participant: CombatParticipant, targetChainIndex: number) {
  if (!currentEncounter.value) return

  // Check if this is an evolve (not devolve) for a partner digimon
  const evoOptions = getParticipantEvolutionOptions(participant)
  const isEvolve = evoOptions.evolveTargets.some((t: any) => t.chainIndex === targetChainIndex)
  const tamer = getTamerForDigimonParticipant(participant)

  if (isEvolve && tamer) {
    // Partner digimon evolving — need willpower roll
    const target = evoOptions.evolveTargets.find((t: any) => t.chainIndex === targetChainIndex)
    pendingDigivolve.value = { participant, targetChainIndex, targetSpecies: target?.species || 'Unknown', tamer }
    willpowerRollResult.value = null
    hasRolledWillpower.value = false
    showWillpowerRollModal.value = true
    return
  }

  // Non-partner digimon or devolve — proceed directly
  try {
    await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/digivolve`, {
      method: 'POST',
      body: { participantId: participant.id, targetChainIndex },
    })
    await fetchEncounter(currentEncounter.value.id)
    await fetchDigimon()
    await fetchEvolutionLines()
  } catch (e: any) {
    console.error('Digivolve failed:', e)
    alert(e?.data?.message || 'Failed to digivolve')
  }
}

function rollWillpowerGM() {
  if (!pendingDigivolve.value) return
  const tamer = pendingDigivolve.value.tamer
  const attrs = typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes as any) : tamer.attributes
  const willpower = attrs?.willpower || 0
  const rolls: number[] = []
  for (let i = 0; i < 3; i++) rolls.push(Math.floor(Math.random() * 6) + 1)
  const total = rolls.reduce((a: number, b: number) => a + b, 0) + willpower
  willpowerRollResult.value = { rolls, total }
  hasRolledWillpower.value = true
}

async function submitWillpowerRollGM() {
  if (!currentEncounter.value || !willpowerRollResult.value || !pendingDigivolve.value) return

  const tamer = pendingDigivolve.value.tamer
  const dc = DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel]
  const passed = willpowerRollResult.value.total >= dc

  if (passed) {
    try {
      await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/digivolve`, {
        method: 'POST',
        body: {
          participantId: pendingDigivolve.value.participant.id,
          targetChainIndex: pendingDigivolve.value.targetChainIndex,
        },
      })
    } catch (e: any) {
      console.error('Digivolve failed:', e)
      alert(e?.data?.message || 'Failed to digivolve')
    }
  } else {
    try {
      await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/digivolve-fail`, {
        method: 'POST',
        body: {
          participantId: pendingDigivolve.value.participant.id,
          targetSpecies: pendingDigivolve.value.targetSpecies,
          rollTotal: willpowerRollResult.value.total,
          dc,
        },
      })
    } catch (e: any) {
      console.error('Digivolve fail logging failed:', e)
    }
  }

  showWillpowerRollModal.value = false
  pendingDigivolve.value = null
  await fetchEncounter(currentEncounter.value.id)
  await fetchDigimon()
  await fetchEvolutionLines()
}

// Get evolution options for a participant
function getParticipantEvolutionOptions(participant: CombatParticipant) {
  if (!participant.evolutionLineId) return { canEvolve: false, canDevolve: false, evolveTargets: [] as any[], devolveTarget: null as any }
  const evoLine = evolutionLines.value.find(l => l.id === participant.evolutionLineId)
  if (!evoLine) return { canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null }

  const chain = typeof evoLine.chain === 'string' ? JSON.parse(evoLine.chain) : evoLine.chain
  const currentIndex = evoLine.currentStageIndex

  // Find unlocked children (evolution targets)
  const evolveTargets = chain
    .map((entry: any, index: number) => ({ ...entry, chainIndex: index }))
    .filter((entry: any) => entry.evolvesFromIndex === currentIndex && entry.isUnlocked)

  // Find parent (devolve target) - only if we have wounds history
  const currentEntry = chain[currentIndex]
  const canDevolve = (participant.woundsHistory?.length || 0) > 0 && currentEntry?.evolvesFromIndex !== null
  const devolveTarget = canDevolve ? { ...chain[currentEntry.evolvesFromIndex], chainIndex: currentEntry.evolvesFromIndex } : null

  return {
    canEvolve: evolveTargets.length > 0,
    canDevolve,
    evolveTargets,
    devolveTarget,
  }
}

// Special Orders
function getTamerSpecialOrders(participant: CombatParticipant) {
  if (participant.type !== 'tamer') return []
  const tamer = tamers.value.find(t => t.id === participant.entityId)
  if (!tamer) return []

  const attrs = typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes as any) : tamer.attributes
  const xpB = typeof tamer.xpBonuses === 'string' ? JSON.parse(tamer.xpBonuses as any) : tamer.xpBonuses
  return getUnlockedSpecialOrders(attrs, xpB, tamer.campaignLevel)
}

async function handleUseSpecialOrder(participant: CombatParticipant, orderName: string, targetId?: string) {
  if (!currentEncounter.value) return
  try {
    await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/special-order`, {
      method: 'POST',
      body: { participantId: participant.id, orderName, targetId },
    })
    await fetchEncounter(currentEncounter.value.id)
    showSpecialOrdersModal.value = false
  } catch (e: any) {
    console.error('Special order failed:', e)
    alert(e?.data?.message || 'Failed to use special order')
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
async function changeStance(stance: CombatParticipant['currentStance'], participantId?: string) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const targetId = participantId || activeParticipant.value?.id
  if (!targetId) return

  const active = participants.find((p) => p.id === targetId)
  if (!active) return

  // Stance change costs 1 simple action
  if ((active.actionsRemaining?.simple || 0) < 1) return
  active.actionsRemaining.simple = Math.max(0, (active.actionsRemaining?.simple || 0) - 1)

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

// Movement action (costs 1 simple action)
async function useMovement(participantId?: string) {
  if (!currentEncounter.value) return

  const participants = currentEncounter.value.participants as CombatParticipant[]
  const targetId = participantId || activeParticipant.value?.id
  if (!targetId) return

  const active = participants.find((p) => p.id === targetId)
  if (!active) return
  if ((active.actionsRemaining?.simple || 0) < 1) return

  active.actionsRemaining.simple = Math.max(0, (active.actionsRemaining?.simple || 0) - 1)
  await updateEncounter(currentEncounter.value.id, { participants })

  const entity = getEntityDetails(active)
  if (entity) {
    await addBattleLogEntry(currentEncounter.value.id, {
      round: currentEncounter.value.round,
      actorId: active.id,
      actorName: entity.name,
      action: 'Movement',
      target: null,
      result: 'Used movement action',
      damage: null,
      effects: [],
    })
  }
}

// Tamer direct action - opens target selector
function openDirectTargetSelector(bolstered: boolean) {
  pendingDirectBolstered.value = bolstered
  showDirectTargetSelector.value = true
}

// Get eligible digimon targets for Direct
function getDirectTargets(): CombatParticipant[] {
  if (!currentEncounter.value) return []
  const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
  return participants.filter(p => p.type === 'digimon')
}

// Confirm direct action on selected digimon
async function confirmDirect(targetDigimon: CombatParticipant) {
  if (!currentEncounter.value) return
  const tamer = activeParticipant.value
  if (!tamer || tamer.type !== 'tamer') return

  try {
    await $fetch(`/api/encounters/${currentEncounter.value.id}/actions/direct`, {
      method: 'POST',
      body: {
        participantId: tamer.id,
        targetDigimonId: targetDigimon.id,
        bolstered: pendingDirectBolstered.value,
      },
    })
    showDirectTargetSelector.value = false
    await fetchEncounter(currentEncounter.value.id)
  } catch (e: any) {
    console.error('Direct failed:', e)
    alert(e?.data?.message || 'Failed to execute Direct')
  }
}

function cancelDirectSelection() {
  showDirectTargetSelector.value = false
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

  // Auto-remove NPC if defeated
  const updated = (currentEncounter.value.participants as CombatParticipant[]).find(p => p.id === participantId)
  if (updated?.isEnemy && wounds >= updated.maxWounds) {
    await removeParticipant(currentEncounter.value.id, participantId)
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

// GM rolls dodge for NPC enemy
async function handleGmDodgeRoll(request: any) {
  if (!currentEncounter.value) return

  try {
    // Find the target participant
    const participants = (currentEncounter.value.participants as CombatParticipant[]) || []
    const target = participants.find(p => p.id === request.targetParticipantId)

    if (!target) {
      console.error('Target participant not found:', request.targetParticipantId)
      return
    }

    // Get dodge pool for the target
    const dodgePool = getDodgePool(target)

    // Roll dice (count successes: 5+ = 1 success)
    const dodgeDiceResults = []
    for (let i = 0; i < dodgePool; i++) {
      dodgeDiceResults.push(Math.floor(Math.random() * 6) + 1)
    }
    const dodgeSuccesses = dodgeDiceResults.filter(d => d >= 5).length

    // Submit response using targetTamerId from request
    const result = await respondToRequest(
      currentEncounter.value.id,
      request.id,
      request.targetTamerId,  // Use value from request (already correct)
      {
        type: 'dodge-rolled',
        dodgeDicePool: dodgePool,
        dodgeSuccesses,
        dodgeDiceResults,
        timestamp: new Date().toISOString(),
      }
    )

    if (result) {
      // Remove the processed request from pending list
      await cancelRequest(currentEncounter.value.id, request.id)
      // Refresh encounter to see updated state
      await fetchEncounter(currentEncounter.value.id)
    }
  } catch (error) {
    console.error('Error rolling dodge for GM:', error)
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
    fetchEvolutionLines()
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

const npcEvolutionLineOptions = computed(() => {
  if (selectedEntityType.value !== 'enemy' || !selectedEntityId.value) return []
  return evolutionLines.value.filter((line) => {
    if (line.partnerId) return false
    const stage = getCurrentStage(line)
    return stage?.digimonId === selectedEntityId.value
  })
})

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

          <!-- Active Participant's Attacks (GM Reference) -->
          <div v-if="currentEncounter.phase === 'combat' && currentTurnParticipant && currentTurnParticipant.type === 'digimon'" class="mb-6">
            <div class="bg-digimon-dark-800 rounded-xl p-6 border-2 border-digimon-orange-500">
              <h3 class="text-lg font-display font-semibold text-white mb-4 flex items-center gap-2">
                <span class="text-2xl">⚔️</span>
                {{ getEntityDetails(currentTurnParticipant)?.name || 'Unknown' }}'s Attacks
                <span class="text-sm text-digimon-dark-400 font-normal ml-2">(Current Turn)</span>
              </h3>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  v-for="attack in getParticipantAttacks(currentTurnParticipant)"
                  :key="attack.id"
                  @click="selectAttackAndShowTargets(currentTurnParticipant, attack)"
                  :disabled="!canUseAttack(currentTurnParticipant, attack)"
                  :class="[
                    'bg-digimon-dark-700 rounded-lg p-4 border text-left transition-all w-full',
                    canUseAttack(currentTurnParticipant, attack)
                      ? 'border-digimon-dark-600 hover:border-digimon-orange-500 hover:bg-digimon-dark-600 cursor-pointer'
                      : 'border-digimon-dark-700 opacity-50 cursor-not-allowed'
                  ]"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <h4 class="font-semibold text-white">{{ attack.name }}</h4>
                    <span class="px-2 py-0.5 bg-digimon-dark-600 text-digimon-dark-300 text-xs rounded uppercase font-medium">
                      {{ attack.type }}
                    </span>
                    <span v-if="attack.range" class="px-2 py-0.5 bg-digimon-dark-600 text-digimon-dark-300 text-xs rounded">
                      {{ attack.range }}
                    </span>
                  </div>

                  <p v-if="attack.description" class="text-sm text-digimon-dark-300 mb-3">
                    {{ attack.description }}
                  </p>

                  <!-- Attack stats with calculated values -->
                  <div class="flex flex-wrap gap-3 text-sm mb-3">
                    <!-- Accuracy -->
                    <div class="flex items-center gap-1">
                      <span class="text-digimon-dark-400">ACC:</span>
                      <span class="text-white font-medium">{{ getAttackStats(currentTurnParticipant, attack).accuracy }}d6</span>
                      <span v-if="getAttackStats(currentTurnParticipant, attack).accuracyBonus > 0" class="text-green-400">
                        (+{{ getAttackStats(currentTurnParticipant, attack).accuracyBonus }})
                      </span>
                      <span v-else-if="getAttackStats(currentTurnParticipant, attack).accuracyBonus < 0" class="text-red-400">
                        ({{ getAttackStats(currentTurnParticipant, attack).accuracyBonus }})
                      </span>
                    </div>

                    <!-- Damage (only for damage-type attacks) -->
                    <div v-if="attack.type === 'damage'" class="flex items-center gap-1">
                      <span class="text-digimon-dark-400">DMG:</span>
                      <span class="text-white font-medium">{{ getAttackStats(currentTurnParticipant, attack).damage }}</span>
                      <span v-if="getAttackStats(currentTurnParticipant, attack).damageBonus > 0" class="text-green-400">
                        (+{{ getAttackStats(currentTurnParticipant, attack).damageBonus }})
                      </span>
                      <span v-else-if="getAttackStats(currentTurnParticipant, attack).damageBonus < 0" class="text-red-400">
                        ({{ getAttackStats(currentTurnParticipant, attack).damageBonus }})
                      </span>
                    </div>

                    <!-- Range & Effective Limit -->
                    <div v-if="getAttackStats(currentTurnParticipant, attack).attackRange != null" class="flex items-center gap-1">
                      <span class="text-digimon-dark-400">Range:</span>
                      <span class="text-white font-medium">{{ getAttackStats(currentTurnParticipant, attack).attackRange }}m</span>
                      <template v-if="getAttackStats(currentTurnParticipant, attack).attackEffectiveLimit != null">
                        <span class="text-digimon-dark-400 ml-1">Limit:</span>
                        <span class="text-white font-medium">{{ getAttackStats(currentTurnParticipant, attack).attackEffectiveLimit }}m</span>
                      </template>
                    </div>

                    <!-- Tags -->
                    <div v-if="attack.tags?.length" class="flex items-center gap-1">
                      <span class="text-digimon-dark-400">Tags:</span>
                      <span class="text-digimon-dark-300 text-xs">{{ attack.tags.join(', ') }}</span>
                    </div>

                    <!-- Effect -->
                    <div v-if="attack.effect" class="flex items-center gap-1">
                      <span class="text-digimon-dark-400">Effect:</span>
                      <span class="text-purple-400 text-xs font-medium">{{ attack.effect }}</span>
                    </div>

                    <!-- Special notes (rerolls, conditional bonuses, etc.) -->
                    <span v-for="note in getAttackStats(currentTurnParticipant, attack).notes" :key="note" class="text-xs text-cyan-400">
                      {{ note }}
                    </span>
                  </div>

                  <div v-if="!canUseAttack(currentTurnParticipant, attack)" class="text-xs text-red-400 mt-2">
                    Not enough actions (requires 1)
                  </div>
                </button>

                <div v-if="getParticipantAttacks(currentTurnParticipant).length === 0" class="col-span-full text-center text-digimon-dark-400 py-4">
                  No attacks defined for this participant.
                </div>
              </div>
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

                    <!-- Speed/Movement and Dodge penalty -->
                    <div class="flex gap-3 mb-2 text-xs">
                      <span v-if="getEntityDetails(item.participant)?.derived" class="text-digimon-dark-400">
                        {{ item.participant.type === 'tamer' ? 'Speed' : 'Movement' }}:
                        <span class="text-digimon-dark-300">{{ item.participant.type === 'tamer' ? getEntityDetails(item.participant)?.derived.speed : getEntityDetails(item.participant)?.derived.movement }}</span>
                      </span>
                      <span v-if="item.participant.dodgePenalty" class="text-red-400">Dodge -{{ item.participant.dodgePenalty }}</span>
                    </div>

                    <!-- Digivolve/Devolve buttons for non-partner digimon -->
                    <div
                      v-if="item.participant.type === 'digimon' && item.participant.evolutionLineId && canParticipantAct(item.participant) && currentEncounter.phase === 'combat'"
                      class="mb-2 flex flex-wrap gap-1"
                    >
                      <button
                        v-for="target in getParticipantEvolutionOptions(item.participant).evolveTargets"
                        :key="`evo-main-${target.chainIndex}`"
                        :disabled="(item.participant.actionsRemaining?.simple || 0) < 2"
                        :class="[
                          'text-xs px-2 py-1 rounded font-medium',
                          (item.participant.actionsRemaining?.simple || 0) >= 2
                            ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
                            : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                        ]"
                        @click="handleDigivolve(item.participant, target.chainIndex)"
                      >
                        Digivolve → {{ target.species }}
                      </button>
                      <button
                        v-if="getParticipantEvolutionOptions(item.participant).canDevolve"
                        :disabled="(item.participant.actionsRemaining?.simple || 0) < 2"
                        :class="[
                          'text-xs px-2 py-1 rounded font-medium',
                          (item.participant.actionsRemaining?.simple || 0) >= 2
                            ? 'bg-amber-700 hover:bg-amber-600 text-white cursor-pointer'
                            : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                        ]"
                        @click="handleDigivolve(item.participant, getParticipantEvolutionOptions(item.participant).devolveTarget.chainIndex)"
                      >
                        Devolve → {{ getParticipantEvolutionOptions(item.participant).devolveTarget?.species }}
                      </button>
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

                  <!-- Movement -->
                  <span v-if="getEntityDetails(item.partnerDigimon)?.derived" class="text-digimon-dark-400">
                    Mov: <span class="text-digimon-dark-300">{{ getEntityDetails(item.partnerDigimon)?.derived.movement }}</span>
                  </span>

                  <!-- Dodge penalty -->
                  <span v-if="item.partnerDigimon.dodgePenalty" class="text-red-400">Dodge -{{ item.partnerDigimon.dodgePenalty }}</span>

                  <button
                    class="text-xs text-digimon-dark-400 hover:text-white flex-shrink-0"
                    @click.stop="selectedParticipantId = item.partnerDigimon.id"
                  >
                    Manage →
                  </button>
                </div>

                <!-- Digivolve/Devolve buttons -->
                <div
                  v-if="canParticipantAct(item.partnerDigimon) && currentEncounter.phase === 'combat' && item.partnerDigimon.evolutionLineId"
                  class="mt-2 flex flex-wrap gap-1"
                >
                  <button
                    v-for="target in getParticipantEvolutionOptions(item.partnerDigimon).evolveTargets"
                    :key="`evo-${target.chainIndex}`"
                    :disabled="(item.partnerDigimon.actionsRemaining?.simple || 0) < 2 || item.participant.hasAttemptedDigivolve"
                    :class="[
                      'text-xs px-2 py-1 rounded font-medium',
                      (item.partnerDigimon.actionsRemaining?.simple || 0) >= 2 && !item.participant.hasAttemptedDigivolve
                        ? 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
                        : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                    ]"
                    @click="handleDigivolve(item.partnerDigimon, target.chainIndex)"
                  >
                    {{ item.participant.hasAttemptedDigivolve ? 'Digivolve attempted' : `Digivolve → ${target.species}` }}
                  </button>
                  <button
                    v-if="getParticipantEvolutionOptions(item.partnerDigimon).canDevolve"
                    :disabled="(item.partnerDigimon.actionsRemaining?.simple || 0) < 2"
                    :class="[
                      'text-xs px-2 py-1 rounded font-medium',
                      (item.partnerDigimon.actionsRemaining?.simple || 0) >= 2
                        ? 'bg-amber-700 hover:bg-amber-600 text-white cursor-pointer'
                        : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                    ]"
                    @click="handleDigivolve(item.partnerDigimon, getParticipantEvolutionOptions(item.partnerDigimon).devolveTarget.chainIndex)"
                  >
                    Devolve → {{ getParticipantEvolutionOptions(item.partnerDigimon).devolveTarget?.species }}
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

            <!-- Movement Action -->
            <div class="mb-4">
              <button
                :disabled="activeParticipant.actionsRemaining.simple < 1"
                class="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-3 py-2 rounded text-sm font-medium"
                @click="useMovement()"
              >
                Move (1 Simple)
              </button>
            </div>

            <!-- Tamer Direct Actions -->
            <div v-if="activeParticipant.type === 'tamer'" class="space-y-2 mb-4">
              <label class="block text-sm text-digimon-dark-400">Tamer Actions</label>
              <button
                :disabled="activeParticipant.actionsRemaining.simple < 1 || activeParticipant.hasDirectedThisTurn"
                class="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-3 py-2 rounded text-sm font-medium"
                @click="openDirectTargetSelector(false)"
              >
                Direct (1 Simple){{ activeParticipant.hasDirectedThisTurn ? ' - Used' : '' }}
              </button>
              <button
                :disabled="activeParticipant.actionsRemaining.simple < 2 || activeParticipant.hasDirectedThisTurn"
                class="w-full bg-amber-700 hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white px-3 py-2 rounded text-sm font-medium"
                @click="openDirectTargetSelector(true)"
              >
                Bolster Direct (2 Simple){{ activeParticipant.hasDirectedThisTurn ? ' - Used' : '' }}
              </button>
            </div>

            <!-- Special Orders (Tamer only) -->
            <div v-if="activeParticipant.type === 'tamer' && getTamerSpecialOrders(activeParticipant).length > 0" class="space-y-2 mb-4">
              <label class="block text-sm text-digimon-dark-400">Special Orders</label>
              <div class="space-y-1">
                <button
                  v-for="order in getTamerSpecialOrders(activeParticipant)"
                  :key="order.name"
                  :disabled="
                    (activeParticipant.usedSpecialOrders || []).includes(order.name) ||
                    (activeParticipant.actionsRemaining?.simple || 0) < getOrderActionCost(order.type) ||
                    getOrderUsageLimit(order.type) === 'passive'
                  "
                  :class="[
                    'w-full px-3 py-2 rounded text-xs text-left transition-colors',
                    (activeParticipant.usedSpecialOrders || []).includes(order.name)
                      ? 'bg-digimon-dark-700 text-digimon-dark-500 line-through cursor-not-allowed'
                      : getOrderUsageLimit(order.type) === 'passive'
                        ? 'bg-digimon-dark-700 text-digimon-dark-400 cursor-default'
                        : (activeParticipant.actionsRemaining?.simple || 0) < getOrderActionCost(order.type)
                          ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed'
                          : 'bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 cursor-pointer'
                  ]"
                  @click="
                    order.name === 'Enemy Scan'
                      ? (showSpecialOrdersModal = true, specialOrderTargetId = null)
                      : handleUseSpecialOrder(activeParticipant, order.name)
                  "
                >
                  <div class="flex items-center justify-between">
                    <span class="font-medium">{{ order.name }}</span>
                    <span class="text-digimon-dark-400 ml-2">
                      {{ getOrderUsageLimit(order.type) === 'passive' ? 'Passive' : getOrderActionCost(order.type) === 0 ? 'Free' : getOrderActionCost(order.type) === 1 ? '1 Action' : '2 Actions' }}
                    </span>
                  </div>
                  <div class="text-digimon-dark-400 mt-0.5">{{ order.effect }}</div>
                  <div v-if="(activeParticipant.usedSpecialOrders || []).includes(order.name)" class="text-red-400 mt-0.5">Used</div>
                </button>
              </div>
            </div>

            <!-- Enemy Scan Target Modal -->
            <div v-if="showSpecialOrdersModal && activeParticipant.type === 'tamer'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showSpecialOrdersModal = false">
              <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-600 max-w-md w-full mx-4">
                <h3 class="text-lg font-semibold text-white mb-4">Enemy Scan - Select Target</h3>
                <div class="space-y-2 max-h-60 overflow-y-auto">
                  <button
                    v-for="p in (currentEncounter?.participants as CombatParticipant[] || []).filter(p => p.id !== activeParticipant.id && p.type !== 'gm')"
                    :key="p.id"
                    class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-3 py-2 rounded text-sm text-left"
                    @click="handleUseSpecialOrder(activeParticipant, 'Enemy Scan', p.id)"
                  >
                    {{ getEntityDetails(p)?.name || 'Unknown' }}
                    <span class="text-digimon-dark-400 text-xs ml-2">({{ p.currentWounds }}/{{ p.maxWounds }} wounds)</span>
                  </button>
                </div>
                <button class="mt-4 text-sm text-digimon-dark-400 hover:text-white" @click="showSpecialOrdersModal = false">Cancel</button>
              </div>
            </div>

            <!-- Stance Selector -->
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-2">Change Stance (1 Simple)</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="stance in ['neutral', 'defensive', 'offensive', 'sniper', 'brave'] as const"
                  :key="stance"
                  :disabled="activeParticipant.actionsRemaining.simple < 1 && activeParticipant.currentStance !== stance"
                  :class="[
                    'px-2 py-1 rounded text-xs capitalize transition-colors',
                    activeParticipant.currentStance === stance
                      ? getStanceColor(stance) + ' text-white'
                      : activeParticipant.actionsRemaining.simple < 1
                        ? 'bg-digimon-dark-700 text-digimon-dark-500 opacity-50 cursor-not-allowed'
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
                  <!-- Show target name (tamer or NPC) -->
                  <span class="text-white font-medium">
                    <template v-if="request.targetTamerId === 'GM'">
                      <!-- NPC Enemy - show digimon name from request.data -->
                      {{ getParticipantName(request.targetParticipantId) || request.data?.targetName || 'NPC Enemy' }}
                    </template>
                    <template v-else>
                      <!-- Player tamer -->
                      {{ tamerMap.get(request.targetTamerId)?.name || 'Unknown Player' }}
                    </template>
                  </span>

                  <!-- Show request type info -->
                  <span v-if="request.type === 'dodge-roll'" class="text-digimon-dark-400 text-sm ml-2">
                    <!-- Show attack context for dodge rolls -->
                    vs {{ request.data?.attackerName || 'Unknown' }}'s {{ request.data?.attackName || 'Attack' }}
                  </span>
                  <span v-else-if="request.type === 'intercede-offer' && request.targetTamerId !== 'GM'" class="text-yellow-400 text-sm ml-2">
                    Intercede? {{ request.data?.attackerName || 'Unknown' }} → {{ request.data?.targetName || 'Unknown' }}
                  </span>
                  <span v-else-if="request.type === 'intercede-offer' && request.targetTamerId === 'GM'" class="text-yellow-400 text-sm ml-2">
                    Intercede? {{ request.data?.attackerName || 'Unknown' }} → {{ request.data?.targetName || 'Unknown' }}
                  </span>
                  <span v-else class="text-digimon-dark-400 text-sm ml-2">
                    {{ request.type === 'digimon-selection' ? 'Select Digimon' : 'Roll Initiative' }}
                  </span>
                </div>
                <div class="flex gap-2">
                  <template v-if="request.type === 'dodge-roll'">
                    <button
                      @click="handleGmDodgeRoll(request)"
                      class="bg-digimon-orange-600 hover:bg-digimon-orange-700 text-white px-3 py-1 rounded text-sm font-semibold transition-colors"
                    >
                      Roll Dodge
                    </button>
                    <button
                      @click="cancelRequest(currentEncounter.id, request.id)"
                      class="text-red-400 hover:text-red-300 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                  </template>
                  <template v-else-if="request.type === 'intercede-offer' && request.targetTamerId === 'GM'">
                    <!-- GM intercede modal auto-appears -->
                  </template>
                  <template v-else-if="request.type === 'intercede-offer'">
                    <!-- Player intercede: just cancel button -->
                    <button
                      @click="cancelIntercedeGroup(request.data?.intercedeGroupId)"
                      class="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-sm font-semibold transition-colors"
                    >
                      Cancel Intercede
                    </button>
                    <button
                      @click="cancelRequest(currentEncounter.id, request.id)"
                      class="text-red-400 hover:text-red-300 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                  </template>
                  <template v-else>
                    <button
                      @click="cancelRequest(currentEncounter.id, request.id)"
                      class="text-red-400 hover:text-red-300 text-sm font-semibold"
                    >
                      Cancel
                    </button>
                  </template>
                </div>
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
                    {{ response.response.type === 'digimon-selected' ? 'Selected Digimon' : response.response.type === 'initiative-rolled' ? 'Rolled Initiative: ' + response.response.initiative : `Rolled Dodge: ${response.response.dodgeDicePool}d6 => [${response.response.dodgeDiceResults?.join(', ')}] = ${response.response.dodgeSuccesses} successes` }}
                  </span>
                </div>
                <button
                  @click="processResponse(response)"
                  :class="[
                    'px-3 py-1 rounded text-sm font-semibold transition-colors text-white',
                    response.response.type === 'dodge-rolled'
                      ? 'bg-digimon-dark-600 hover:bg-digimon-dark-500'
                      : 'bg-green-600 hover:bg-green-700'
                  ]"
                >
                  {{ response.response.type === 'dodge-rolled' ? 'Dismiss' : 'Process' }}
                </button>
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
                class="mb-3 p-3 bg-digimon-dark-700 rounded-lg"
              >
                <div class="text-digimon-dark-400 text-xs mb-1">
                  Round {{ entry.round }} • {{ entry.actorName }}
                </div>
                <div class="text-white text-sm">{{ entry.result }}</div>

                <!-- Damage calculation breakdown (if available) -->
                <div v-if="entry.hit !== undefined && entry.baseDamage !== undefined" class="mt-2 p-2 bg-digimon-dark-600 rounded border-l-4" :class="[
                  entry.hit ? 'border-green-500' : 'border-red-500'
                ]">
                  <div class="text-xs font-semibold mb-1" :class="[
                    entry.hit ? 'text-green-400' : 'text-red-400'
                  ]">
                    {{ entry.hit ? 'HIT!' : 'MISS!' }}
                  </div>

                  <!-- Show calculation breakdown if hit -->
                  <div v-if="entry.hit" class="text-xs text-digimon-dark-300 space-y-1">
                    <div class="flex justify-between">
                      <span>Base Damage:</span>
                      <span class="text-white font-mono">{{ entry.baseDamage }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Net Successes:</span>
                      <span class="text-white font-mono">{{ entry.netSuccesses >= 0 ? '+' : '' }}{{ entry.netSuccesses }}</span>
                    </div>
                    <div v-if="entry.targetArmor !== undefined && entry.targetArmor > 0" class="flex justify-between">
                      <span>Target Armor:</span>
                      <span class="text-white font-mono">{{ entry.targetArmor }}</span>
                    </div>
                    <div v-if="entry.armorPiercing !== undefined && entry.armorPiercing > 0" class="flex justify-between">
                      <span>Armor Piercing:</span>
                      <span class="text-cyan-400 font-mono">-{{ entry.armorPiercing }}</span>
                    </div>
                    <div v-if="entry.effectiveArmor !== undefined" class="flex justify-between">
                      <span>Effective Armor:</span>
                      <span class="text-white font-mono">{{ entry.effectiveArmor }}</span>
                    </div>
                    <div class="flex justify-between pt-1 mt-1 border-t border-digimon-dark-500">
                      <span class="font-semibold">Final Damage:</span>
                      <span class="text-red-400 font-bold font-mono">{{ entry.finalDamage }}</span>
                    </div>
                    <div class="text-xs text-digimon-dark-400 italic mt-1">
                      Formula: max(1, {{ entry.baseDamage }} + {{ entry.netSuccesses }} - {{ entry.effectiveArmor }}) = {{ entry.finalDamage }}
                    </div>
                  </div>
                </div>

                <!-- Fallback: simple damage display for old entries without breakdown -->
                <div v-else-if="entry.damage !== null && entry.damage !== undefined && entry.damage > 0" class="text-red-400 text-xs mt-2">
                  Damage: {{ entry.damage }}
                </div>
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
                  @click="selectedEntityType = 'digimon'; selectedEntityId = ''; selectedNpcEvoLineId = ''"
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
                  @click="selectedEntityType = 'enemy'; selectedEntityId = ''; selectedNpcEvoLineId = ''"
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
                  @click="selectedEntityType = 'tamer'; selectedEntityId = ''; selectedNpcEvoLineId = ''"
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

            <!-- NPC Evolution Line (only for single enemy with matching lines) -->
            <div v-if="selectedEntityType === 'enemy' && addQuantity === 1 && npcEvolutionLineOptions.length > 0" class="mb-6">
              <label class="block text-sm text-digimon-dark-400 mb-2">Evolution Line (optional)</label>
              <select
                v-model="selectedNpcEvoLineId"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              >
                <option value="">None</option>
                <option v-for="line in npcEvolutionLineOptions" :key="line.id" :value="line.id">
                  {{ line.name }}
                </option>
              </select>
              <p class="text-xs text-digimon-dark-400 mt-1">
                Assign an evolution line to allow this NPC to digivolve during combat
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

      <!-- Target Selection Modal -->
      <Teleport to="body">
        <div
          v-if="showTargetSelector && selectedAttack"
          class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          @click.self="cancelAttackSelection"
        >
          <div class="bg-digimon-dark-800 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto border-2 border-digimon-orange-500">
            <h2 class="text-xl font-display font-semibold text-white mb-4">
              Select Target for {{ selectedAttack.attack.name }}
            </h2>

            <div class="space-y-3 mb-6">
              <button
                v-for="target in getAttackTargets(selectedAttack.participant.id)"
                :key="target.id"
                @click="selectedTargetId = target.id"
                class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg p-4 border border-digimon-dark-600 transition-all text-left"
                :class="{
                  'bg-digimon-orange-500/20 border-digimon-orange-500': selectedTargetId === target.id
                }"
              >
                <div class="flex items-center gap-3 mb-2">
                  <!-- Checkbox with tick -->
                  <div class="w-5 h-5 rounded border border-digimon-dark-500 flex items-center justify-center shrink-0">
                    <span v-if="selectedTargetId === target.id" class="text-digimon-orange-400">✓</span>
                  </div>
                  <div class="w-10 h-10 rounded bg-digimon-dark-600 flex items-center justify-center overflow-hidden">
                    <img
                      v-if="getEntityDetails(target)?.spriteUrl"
                      :src="getEntityDetails(target)!.spriteUrl!"
                      :alt="getEntityDetails(target)?.name || 'target'"
                      class="max-w-full max-h-full object-contain"
                    />
                    <span v-else class="text-2xl">{{ getEntityDetails(target)?.icon }}</span>
                  </div>
                  <div class="flex-1">
                    <div class="font-semibold text-white">
                      {{ getEntityDetails(target)?.name || 'Unknown' }}
                    </div>
                    <div class="text-xs text-digimon-dark-400">
                      {{ getEntityDetails(target)?.species }}
                      <span v-if="getEntityDetails(target)?.isEnemy" class="text-red-400 ml-1">(Enemy)</span>
                    </div>
                  </div>
                  <div :class="['px-2 py-0.5 rounded text-xs uppercase', getStanceColor(target.currentStance)]">
                    {{ target.currentStance }}
                  </div>
                </div>

                <!-- Health bar -->
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-2 bg-digimon-dark-600 rounded-full overflow-hidden">
                    <div
                      class="h-full transition-all duration-300"
                      :class="[
                        target.currentWounds === 0 ? 'bg-green-500' :
                        target.currentWounds < target.maxWounds / 2 ? 'bg-yellow-500' :
                        target.currentWounds < target.maxWounds ? 'bg-orange-500' : 'bg-red-500'
                      ]"
                      :style="{ width: `${((target.maxWounds - target.currentWounds) / target.maxWounds) * 100}%` }"
                    />
                  </div>
                  <span class="text-xs text-digimon-dark-400 whitespace-nowrap">
                    {{ Math.round(((target.maxWounds - target.currentWounds) / target.maxWounds) * 100) }}%
                  </span>
                </div>
              </button>

              <div v-if="getAttackTargets(selectedAttack.participant.id).length === 0" class="text-center text-digimon-dark-400 py-8">
                No valid targets available.
              </div>
            </div>

            <!-- Bolster Attack Toggle -->
            <div
              v-if="selectedAttack && canBolsterAttack(selectedAttack.participant, selectedAttack.attack)"
              class="mb-4 p-3 bg-digimon-dark-700 rounded-lg border border-digimon-dark-600"
            >
              <label class="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  v-model="bolsterAttackEnabled"
                  class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-amber-500"
                />
                <span class="text-sm text-amber-400 font-medium">Bolster Attack (2 Simple Actions)</span>
                <span class="text-xs text-digimon-dark-400 ml-auto">
                  {{ (selectedAttack.participant.digimonBolsterCount ?? 0) }}/2 used
                </span>
              </label>
              <div v-if="bolsterAttackEnabled" class="flex gap-2 mt-2">
                <button
                  @click="bolsterAttackType = 'damage-accuracy'"
                  :class="[
                    'flex-1 text-xs px-2 py-1.5 rounded transition-colors',
                    bolsterAttackType === 'damage-accuracy'
                      ? 'bg-amber-600 text-white'
                      : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                >
                  +2 Damage & Accuracy
                </button>
                <button
                  @click="bolsterAttackType = 'bit-cpu'"
                  :disabled="selectedAttack.participant.lastBitCpuBolsterRound !== undefined &&
                    (currentEncounter?.round || 0) - selectedAttack.participant.lastBitCpuBolsterRound < 2"
                  :class="[
                    'flex-1 text-xs px-2 py-1.5 rounded transition-colors',
                    bolsterAttackType === 'bit-cpu'
                      ? 'bg-amber-600 text-white'
                      : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  ]"
                >
                  +1 BIT/CPU (Effect)
                </button>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex gap-3">
              <button
                @click="confirmAttack(getAttackTargets(selectedAttack.participant.id).find(t => t.id === selectedTargetId))"
                :disabled="!selectedTargetId"
                class="flex-1 bg-digimon-orange-600 hover:bg-digimon-orange-700 disabled:bg-digimon-dark-600 disabled:text-digimon-dark-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                {{ bolsterAttackEnabled ? 'Bolster ' : '' }}Attack{{ selectedAttack?.attack?.name ? ` with ${selectedAttack.attack.name}` : '' }}
              </button>
              <button
                @click="cancelAttackSelection"
                class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <!-- Direct Target Selection Modal -->
    <Teleport to="body">
      <div
        v-if="showDirectTargetSelector"
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
        @click.self="cancelDirectSelection"
      >
        <div class="bg-digimon-dark-800 rounded-xl p-6 max-w-md w-full border-2 border-amber-500">
          <h2 class="text-xl font-display font-semibold text-amber-400 mb-4">
            {{ pendingDirectBolstered ? 'Bolster Direct' : 'Direct' }} — Select Digimon
          </h2>
          <p class="text-sm text-digimon-dark-400 mb-4">
            Choose a Digimon to direct. They will receive a bonus to their next Accuracy or Dodge roll.
          </p>

          <div class="space-y-2 mb-6">
            <button
              v-for="target in getDirectTargets()"
              :key="target.id"
              @click="confirmDirect(target)"
              class="w-full bg-digimon-dark-700 hover:bg-amber-900/30 rounded-lg p-3 border border-digimon-dark-600 hover:border-amber-500 transition-all text-left"
            >
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded bg-digimon-dark-600 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="getEntityDetails(target)?.spriteUrl"
                    :src="getEntityDetails(target)!.spriteUrl!"
                    :alt="getEntityDetails(target)?.name || 'target'"
                    class="max-w-full max-h-full object-contain"
                  />
                  <span v-else class="text-lg">{{ getEntityDetails(target)?.icon }}</span>
                </div>
                <div class="flex-1">
                  <div class="font-semibold text-white text-sm">
                    {{ getEntityDetails(target)?.name || 'Unknown' }}
                  </div>
                  <div class="text-xs text-digimon-dark-400">
                    {{ getEntityDetails(target)?.species }}
                  </div>
                </div>
              </div>
            </button>

            <div v-if="getDirectTargets().length === 0" class="text-center text-digimon-dark-400 py-4">
              No digimon targets available.
            </div>
          </div>

          <button
            @click="cancelDirectSelection"
            class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Willpower Roll Modal (for digivolution) -->
    <Teleport to="body">
      <div
        v-if="showWillpowerRollModal && pendingDigivolve"
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      >
        <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-purple-500">
          <h2 class="font-display text-xl font-semibold text-purple-400 mb-4">
            Willpower Check — Digivolve to {{ pendingDigivolve.targetSpecies }}
          </h2>

          <div class="mb-4 p-3 bg-purple-900/20 rounded-lg">
            <p class="text-white text-sm">
              <span class="font-semibold">{{ pendingDigivolve.tamer.name }}</span> must pass a Willpower check
            </p>
            <p class="text-white text-sm mt-1">
              DC <span class="font-semibold">{{ DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] }}</span>
              <span class="text-digimon-dark-400 ml-1">({{ pendingDigivolve.tamer.campaignLevel }})</span>
            </p>
            <p class="text-digimon-dark-300 text-sm mt-1">
              3d6 + {{ (typeof pendingDigivolve.tamer.attributes === 'string' ? JSON.parse(pendingDigivolve.tamer.attributes as any) : pendingDigivolve.tamer.attributes)?.willpower || 0 }} (Willpower)
            </p>
          </div>

          <!-- Dice Roller -->
          <div class="mb-4">
            <div class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
              <div class="flex gap-2 items-center justify-center mb-4">
                <span class="text-white font-semibold">3d6 + Willpower</span>
              </div>

              <button
                :disabled="hasRolledWillpower"
                @click="rollWillpowerGM"
                :class="[
                  'w-full text-white px-4 py-2 rounded-lg font-semibold transition-colors',
                  hasRolledWillpower ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'
                ]"
              >
                {{ hasRolledWillpower ? 'Already Rolled' : 'Roll Willpower' }}
              </button>
            </div>

            <div
              v-if="willpowerRollResult"
              class="bg-digimon-dark-700 rounded-lg p-4 mb-4 text-center"
            >
              <div class="text-sm text-digimon-dark-400 mb-2">Willpower Roll</div>
              <div class="flex justify-center gap-1 mb-2">
                <span
                  v-for="(die, idx) in willpowerRollResult.rolls"
                  :key="idx"
                  class="w-8 h-8 flex items-center justify-center rounded font-bold text-sm bg-digimon-dark-600 text-white"
                >
                  {{ die }}
                </span>
                <span class="w-8 h-8 flex items-center justify-center text-digimon-dark-400 font-bold">+</span>
                <span class="w-8 h-8 flex items-center justify-center rounded font-bold text-sm bg-purple-700 text-white">
                  {{ (typeof pendingDigivolve.tamer.attributes === 'string' ? JSON.parse(pendingDigivolve.tamer.attributes as any) : pendingDigivolve.tamer.attributes)?.willpower || 0 }}
                </span>
              </div>
              <div class="text-3xl font-bold mb-1" :class="willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] ? 'text-green-400' : 'text-red-400'">
                {{ willpowerRollResult.total }}
              </div>
              <div class="text-sm" :class="willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] ? 'text-green-400' : 'text-red-400'">
                {{ willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] ? 'SUCCESS' : 'FAILURE' }}
                <span class="text-digimon-dark-400 ml-1">(vs DC {{ DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] }})</span>
              </div>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              @click="showWillpowerRollModal = false; pendingDigivolve = null"
              class="flex-1 bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              :disabled="hasRolledWillpower"
            >
              Cancel
            </button>
            <button
              :disabled="!willpowerRollResult"
              @click="submitWillpowerRollGM"
              :class="[
                'flex-1 text-white px-4 py-2 rounded-lg font-semibold transition-colors',
                !willpowerRollResult ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' :
                willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              ]"
            >
              {{ willpowerRollResult && willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[pendingDigivolve.tamer.campaignLevel] ? 'Digivolve!' : 'Accept Failure' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- GM Intercede Modal -->
    <Teleport to="body">
      <div
        v-if="showGmIntercedeModal && gmIntercedeRequest"
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      >
        <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-yellow-500">

          <!-- Main View -->
          <template v-if="gmIntercedeView === 'main'">
            <h2 class="font-display text-xl font-semibold text-yellow-400 mb-4">
              Intercede?
            </h2>

            <div class="mb-4 p-3 bg-yellow-900/20 rounded-lg">
              <p class="text-white text-sm">
                <span class="font-semibold">{{ gmIntercedeRequest.data?.attackerName }}</span>
                is attacking
                <span class="font-semibold">{{ gmIntercedeRequest.data?.targetName }}</span>!
              </p>
              <p class="text-yellow-300 text-xs mt-1">
                {{ gmIntercedeRequest.data?.accuracySuccesses }} accuracy successes
              </p>
            </div>

            <div class="mb-4 p-3 bg-digimon-dark-700 rounded-lg text-sm text-digimon-dark-300">
              <p class="mb-1">If you intercede:</p>
              <ul class="list-disc list-inside space-y-1 text-xs">
                <li>Your chosen participant takes the hit instead (0 dodge)</li>
                <li>The interceptor loses 1 simple action on their next turn</li>
              </ul>
            </div>

            <div class="flex flex-col gap-2">
              <button
                :disabled="gmIntercedeLoading || gmIntercedeOptionsWithNames.length === 0"
                @click="gmIntercedeView = 'select-interceptor'"
                class="w-full bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                {{ gmIntercedeOptionsWithNames.length === 0 ? 'No eligible interceptors' : 'Intercede' }}
              </button>
              <button
                :disabled="gmIntercedeLoading"
                @click="handleGmIntercedeSkip(gmIntercedeRequest.id)"
                class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                {{ gmIntercedeLoading ? 'Processing...' : 'Skip' }}
              </button>
              <button
                :disabled="gmIntercedeLoading"
                @click="() => {
                  const targetId = gmIntercedeRequest.data?.targetId
                  const existing = targetId ? (gmCharacterOptOuts[targetId] || []) : []
                  gmOptOutSelections = new Set(existing)
                  gmIntercedeView = 'select-optout'
                }"
                class="w-full bg-red-800/50 hover:bg-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed text-red-300 px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Never Intercede
              </button>
            </div>
          </template>

          <!-- Select Interceptor View -->
          <template v-else-if="gmIntercedeView === 'select-interceptor'">
            <h2 class="font-display text-xl font-semibold text-yellow-400 mb-4">
              Select Interceptor
            </h2>

            <div class="mb-4 p-3 bg-yellow-900/20 rounded-lg">
              <p class="text-white text-sm">
                Choose who will intercede for
                <span class="font-semibold">{{ gmIntercedeRequest.data?.targetName }}</span>
              </p>
            </div>

            <div class="flex flex-col gap-2">
              <button
                v-for="option in gmIntercedeOptionsWithNames"
                :key="option.id"
                :disabled="gmIntercedeLoading"
                @click="handleGmIntercedeClaim(gmIntercedeRequest.id, option.id)"
                class="w-full bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                {{ gmIntercedeLoading ? 'Processing...' : option.name }}
              </button>
              <button
                :disabled="gmIntercedeLoading"
                @click="gmIntercedeView = 'main'"
                class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                Back
              </button>
            </div>
          </template>

          <!-- Select Opt-Out View -->
          <template v-else-if="gmIntercedeView === 'select-optout'">
            <h2 class="font-display text-xl font-semibold text-yellow-400 mb-4">
              Never Intercede
            </h2>

            <div class="mb-4 p-3 bg-yellow-900/20 rounded-lg">
              <p class="text-white text-sm">
                Select characters that should never intercede for
                <span class="font-semibold">{{ gmIntercedeRequest.data?.targetName }}</span>
              </p>
            </div>

            <div class="flex flex-col gap-2 mb-4">
              <label
                v-for="option in gmIntercedeAllOptions"
                :key="option.id"
                class="flex items-center gap-3 p-2 rounded-lg bg-digimon-dark-700 hover:bg-digimon-dark-600 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  :checked="gmOptOutSelections.has(option.id)"
                  @change="() => {
                    const newSet = new Set(gmOptOutSelections)
                    if (newSet.has(option.id)) {
                      newSet.delete(option.id)
                    } else {
                      newSet.add(option.id)
                    }
                    gmOptOutSelections = newSet
                  }"
                  class="w-4 h-4 rounded accent-red-500"
                />
                <span class="text-white text-sm">{{ option.name }}</span>
              </label>
            </div>

            <div class="flex flex-col gap-2">
              <button
                :disabled="gmIntercedeLoading"
                @click="handleGmSaveCharacterOptOuts"
                class="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                {{ gmIntercedeLoading ? 'Saving...' : 'Confirm' }}
              </button>
              <button
                :disabled="gmIntercedeLoading"
                @click="gmIntercedeView = 'main'"
                class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </template>

        </div>
      </div>
    </Teleport>

    <!-- GM Intercede Result Modal -->
    <Teleport to="body">
      <div
        v-if="showGmIntercedeResultModal && gmIntercedeResultData"
        class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      >
        <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-2xl border-2 border-yellow-500">
          <h2 class="text-2xl font-bold text-yellow-500 mb-2">
            Intercede Result
          </h2>
          <p class="text-digimon-dark-300 mb-4">
            <span class="text-white font-semibold">{{ gmIntercedeResultData.interceptorName }}</span>
            took the hit for
            <span class="text-white font-semibold">{{ gmIntercedeResultData.targetName }}</span>!
          </p>

          <div class="mb-4 p-4 bg-digimon-dark-700 rounded-lg">
            <h3 class="text-lg font-semibold text-orange-400 mb-2">Attack Details</h3>
            <div class="flex items-center gap-2">
              <span class="text-digimon-dark-400">Attacker:</span>
              <span class="text-white">{{ gmIntercedeResultData.attackerName }}</span>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-digimon-dark-400">Accuracy Successes:</span>
              <span class="text-orange-400 font-bold text-xl">{{ gmIntercedeResultData.accuracySuccesses }}</span>
            </div>
          </div>

          <div class="mb-6 p-4 bg-digimon-dark-700 rounded-lg border-2 border-red-500">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-lg font-semibold text-red-400">
                HIT! (Intercede = 0 Dodge)
              </h3>
              <div class="text-digimon-dark-400">
                Net Successes:
                <span class="text-orange-400 font-bold text-xl ml-2">
                  {{ gmIntercedeResultData.netSuccesses >= 0 ? '+' : '' }}{{ gmIntercedeResultData.netSuccesses }}
                </span>
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-digimon-dark-600">
              <div class="flex items-center justify-between">
                <span class="text-red-400 font-semibold text-lg">Damage Taken:</span>
                <span class="text-red-500 font-bold text-3xl">{{ gmIntercedeResultData.finalDamage }}</span>
              </div>
            </div>
          </div>

          <div class="flex justify-end">
            <button
              @click="closeGmIntercedeResultModal"
              class="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
