<script setup lang="ts">
import type { Tamer, Digimon, Encounter } from '../../server/db/schema'
import type { CombatParticipant } from '../../composables/useEncounters'
import { skillsByAttribute, skillLabels } from '../../constants/tamer-skills'
import type { DigimonStage } from '../../types'
import { STAGE_CONFIG, DIGIVOLVE_WILLPOWER_DC } from '../../types'
import { getStageColor } from '../../utils/displayHelpers'
import { getUnlockedSpecialOrders, getOrderActionCost, getOrderUsageLimit } from '../../utils/specialOrders'

definePageMeta({
  layout: 'player',
  title: 'Player Dashboard',
})

const route = useRoute()
const tamerId = computed(() => route.params.tamerId as string)

// Check if we're on a child route (e.g., /player/:tamerId/digimon/new or /player/:tamerId/digimon/:id)
const isChildRoute = computed(() => {
  const path = route.path
  const basePath = `/player/${tamerId.value}`
  return path !== basePath && path.startsWith(basePath + '/')
})

// State
const tamer = ref<Tamer | null>(null)
const partnerDigimon = ref<Digimon[]>([])
const allDigimon = ref<Digimon[]>([])
const activeEncounter = ref<Encounter | null>(null)
const loading = ref(true)
const lastRefresh = ref(new Date())
const myRequests = ref<any[]>([])
const initiativeRollResult = ref<{ rolls: number[]; total: number } | null>(null)
const dodgeRollResult = ref<{ rolls: number[]; successes: number; dicePool: number } | null>(null)
const hasRolledInitiative = ref(false)
const hasRolledDodge = ref(false)
const selectedAttack = ref<any>(null)
const showTargetSelector = ref(false)
const selectedTargetId = ref<string | null>(null)
const selectedDigimonId = ref<string | null>(null)
const allTamers = ref<Tamer[]>([])

// Track attacks awaiting dodge responses (use array for proper Vue reactivity)
const pendingAttacks = ref<Array<{
  trackingId: string;
  timestamp: number;
  attackName: string;
  targetName: string;
  accuracyDicePool: number;
  accuracyDiceResults: number[];
  accuracySuccesses: number;
  participantId: string;
  attackData: any;
}>>([])

// Attack result modal state - queue to handle multiple attacks in one turn
const showAttackResultModal = ref(false)
const showPlayerSpecialOrdersModal = ref(false)
const attackResultQueue = ref<Array<{
  responseId: string
  attackerName: string
  attackName: string
  targetName: string
  accuracyDicePool: number
  accuracyDiceResults: number[]
  accuracySuccesses: number
  dodgeDicePool: number
  dodgeDiceResults: number[]
  dodgeSuccesses: number
  netSuccesses: number
  hit: boolean
  baseDamage?: number
  armorPiercing?: number
  targetArmor?: number
  finalDamage?: number
}>>([])

// Computed property to get the current result (first in queue)
// Important: Check length first to properly establish reactivity dependency
const attackResultData = computed(() => {
  return attackResultQueue.value.length > 0 ? attackResultQueue.value[0] : null
})

// Dodge result modal state - shown to the defender after they submit their dodge roll
const showDodgeResultModal = ref(false)
const dodgeResponseId = ref<string | null>(null)
const dodgeRequestId = ref<string | null>(null)
const dodgeResultData = ref<{
  attackName: string
  attackerName: string
  targetName: string
  dodgeDicePool: number
  dodgeDiceResults: number[]
  dodgeSuccesses: number
  accuracySuccesses: number
  netSuccesses: number
  hit: boolean
  finalDamage: number
  baseDamage: number
  targetArmor: number
  armorPiercing: number
  effectiveArmor: number | undefined
} | null>(null)

// Intercede result modal state - shown to the interceptor after they claim intercede
const showIntercedeResultModal = ref(false)
const intercedeResultData = ref<{
  attackerName: string
  targetName: string
  interceptorName: string
  accuracySuccesses: number
  finalDamage: number
  baseDamage: number
  netSuccesses: number
  targetArmor: number
  armorPiercing: number
  effectiveArmor: number
} | null>(null)

// Willpower roll modal state for digivolution
const showWillpowerRollModal = ref(false)
const willpowerRollResult = ref<{ rolls: number[]; total: number } | null>(null)
const hasRolledWillpower = ref(false)
const pendingDigivolve = ref<{ participant: CombatParticipant; targetChainIndex: number; targetSpecies: string } | null>(null)

// Direct action state
const showDirectTargetSelector = ref(false)
const pendingDirectBolstered = ref(false)

// Bolster attack state
const bolsterAttackEnabled = ref(false)
const bolsterAttackType = ref<'damage-accuracy' | 'bit-cpu'>('damage-accuracy')

// Note: Evolution chain navigation now uses currentDigimonId (see digimonChains computed)

// Composables
const { fetchTamer, fetchTamers, tamers: allTamersFromComposable, calculateDerivedStats: calcTamerStats } = useTamers()
const { fetchDigimon, calculateDerivedStats: calcDigimonStats } = useDigimon()
const { encounters, fetchEncounters, fetchEncounter, getCurrentParticipant, respondToRequest, getMyPendingRequests, performAttack, deleteResponse, cancelRequest, updateEncounter, addBattleLogEntry } = useEncounters()
const { fetchEvolutionLines, evolutionLines, getCurrentStage } = useEvolution()

// Auto-refresh every 5 seconds
let refreshInterval: ReturnType<typeof setInterval>

async function loadData() {
  loading.value = true
  try {
    // Fetch tamer
    const fetchedTamer = await fetchTamer(tamerId.value)
    tamer.value = fetchedTamer

    if (fetchedTamer) {
      // Fetch partner Digimon
      await fetchDigimon({ partnerId: fetchedTamer.id })
      partnerDigimon.value = await $fetch<Digimon[]>(`/api/digimon?partnerId=${fetchedTamer.id}`)

      // Fetch evolution lines for current stage filtering
      await fetchEvolutionLines(fetchedTamer.id)

      // Fetch encounters to find active one
      await fetchEncounters()

      // Fetch all tamers for turn tracker participant images
      await fetchTamers()
      allTamers.value = allTamersFromComposable.value

      // Find an active encounter that this tamer is relevant to (participating or has pending requests)
      const active = encounters.value.find((e) => {
        if (e.phase !== 'combat' && e.phase !== 'setup' && e.phase !== 'initiative') return false
        const pts = (e.participants as CombatParticipant[]) || []
        const reqs = (e.pendingRequests as any[]) || []
        const isParticipating = pts.some(
          (p) =>
            (p.type === 'tamer' && p.entityId === fetchedTamer.id) ||
            (p.type === 'digimon' && partnerDigimon.value.some((d) => d.id === p.entityId))
        )
        const hasPendingRequests = reqs.some((r) => r.targetTamerId === fetchedTamer.id)
        return isParticipating || hasPendingRequests
      })
      if (active) {
        // Fetch all digimon in the encounter (partner and enemy)
        const participants = active.participants as CombatParticipant[]
        const digimonEntityIds = participants
          .filter((p) => p.type === 'digimon')
          .map((p) => p.entityId)

        if (digimonEntityIds.length > 0) {
          try {
            allDigimon.value = await $fetch<Digimon[]>(`/api/digimon?ids=${digimonEntityIds.join(',')}`)
          } catch (e) {
            console.warn('Failed to fetch encounter digimon:', e)
          }
        }

        activeEncounter.value = active
        // Extract my pending requests
        myRequests.value = getMyPendingRequests(active, fetchedTamer.id)

        // Reconstruct attack results from persisted responses (handles page refresh)
        const responses = (active.requestResponses as any[]) || []
        const pendingRequests = (active.pendingRequests as any[]) || []
        const myPartIds = new Set(
          participants
            .filter((p) =>
              (p.type === 'tamer' && p.entityId === fetchedTamer.id) ||
              (p.type === 'digimon' && partnerDigimon.value.some((d) => d.id === p.entityId))
            )
            .map((p) => p.id)
        )

        for (const resp of responses) {
          if (resp.response?.type !== 'dodge-rolled') continue
          if (!myPartIds.has(resp.attackerParticipantId)) continue
          // Skip if already in queue
          if (attackResultQueue.value.some((r) => r.responseId === resp.id)) continue
          // Skip if already being tracked as pending
          if (pendingAttacks.value.some((pa) => pa.participantId === resp.attackerParticipantId)) continue

          // Find matching request
          const matchingRequest = pendingRequests.find((req: any) => req.id === resp.requestId)
          if (!matchingRequest) continue

          // Reconstruct synthetic pending attack from request data
          const syntheticPendingAttack = {
            trackingId: `reconstructed-${resp.id}`,
            timestamp: new Date(resp.response.timestamp).getTime(),
            attackName: matchingRequest.data?.attackName || 'Unknown',
            targetName: matchingRequest.data?.targetName || 'Unknown',
            accuracyDicePool: matchingRequest.data?.accuracyDicePool || 0,
            accuracyDiceResults: matchingRequest.data?.accuracyDiceResults || [],
            accuracySuccesses: matchingRequest.data?.accuracySuccesses || 0,
            participantId: resp.attackerParticipantId,
            attackData: { id: matchingRequest.data?.attackId, name: matchingRequest.data?.attackName, tags: [] }
          }

          // Find the attack definition with tags from the digimon's attacks for proper damage calc
          const attackerParticipant = participants.find((p: any) => p.id === resp.attackerParticipantId)
          if (attackerParticipant?.type === 'digimon') {
            const attackerDigi = allDigimon.value.find((d) => d.id === attackerParticipant.entityId)
            if (attackerDigi?.attacks) {
              const attacks = typeof attackerDigi.attacks === 'string' ? JSON.parse(attackerDigi.attacks) : attackerDigi.attacks
              const attackDef = attacks?.find((a: any) => a.id === matchingRequest.data?.attackId)
              if (attackDef) {
                syntheticPendingAttack.attackData = attackDef
              }
            }
          }

          showAttackResult(syntheticPendingAttack, matchingRequest, resp)
        }
      } else {
        activeEncounter.value = null
        myRequests.value = []
      }
    }

    lastRefresh.value = new Date()
  } catch (e) {
    console.error('Failed to load player data:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
  // Auto-refresh
  refreshInterval = setInterval(loadData, 5000)
})

onUnmounted(() => {
  clearInterval(refreshInterval)
})

// Watch for new dodge responses (deep watch on nested array)
// Using watch instead of watchEffect to properly detect changes to nested requestResponses array
watch(
  () => activeEncounter.value?.requestResponses,
  (newResponses, oldResponses) => {
    console.log('[ATTACK RESULT] Watch triggered, pendingAttacks:', pendingAttacks.value.length)

    if (!newResponses || !activeEncounter.value) {
      console.log('[ATTACK RESULT] Early return - no responses or no encounter')
      return
    }

    const responses = newResponses
    const requests = activeEncounter.value.pendingRequests || []

    console.log('[ATTACK RESULT] Responses:', responses.length, 'Requests:', requests.length)

    // Iterate backwards to safely splice during iteration
    for (let i = pendingAttacks.value.length - 1; i >= 0; i--) {
      const pendingAttack = pendingAttacks.value[i]

      console.log(`[ATTACK RESULT] Checking pending attack #${i}:`, {
        attackName: pendingAttack.attackName,
        participantId: pendingAttack.participantId,
        age: Date.now() - pendingAttack.timestamp
      })

      // SIMPLIFIED: Match directly to response using attackerParticipantId
      // This works even if the original request was deleted after response creation
      const matchingResponse = responses.find((resp: any) =>
        resp.response?.type === 'dodge-rolled' &&
        resp.attackerParticipantId === pendingAttack.participantId &&
        Math.abs(new Date(resp.response?.timestamp || 0).getTime() - pendingAttack.timestamp) < 30000
      )

      if (!matchingResponse) {
        console.log('[ATTACK RESULT] No matching response yet for:', pendingAttack.attackName)
        // Clean up expired attacks (>60 seconds)
        const now = Date.now()
        if (now - pendingAttack.timestamp > 60000) {
          console.log('[ATTACK RESULT] Removing expired attack:', pendingAttack.attackName)
          pendingAttacks.value.splice(i, 1)
        }
        continue
      }

      console.log('[ATTACK RESULT] ✓ Found matching response! Showing modal for:', pendingAttack.attackName)

      // Reconstruct request-like object for showAttackResult (maintains backward compatibility)
      const syntheticRequest = {
        id: matchingResponse.requestId,
        type: 'dodge-roll',
        targetParticipantId: matchingResponse.participantId,
        data: {
          attackerParticipantId: matchingResponse.attackerParticipantId,
          attackerName: matchingResponse.attackerName,
          targetName: pendingAttack.targetName,
          attackId: pendingAttack.attackData.id,
          attackName: pendingAttack.attackName,
          accuracyDicePool: pendingAttack.accuracyDicePool,
          accuracySuccesses: pendingAttack.accuracySuccesses,
          accuracyDiceResults: pendingAttack.accuracyDiceResults,
        }
      }

      // Show result modal
      showAttackResult(pendingAttack, syntheticRequest, matchingResponse)
      // Remove from array (splice in reverse order iteration)
      pendingAttacks.value.splice(i, 1)
    }
  },
  { deep: true, immediate: true }
)

// Helper functions to calculate total values (base + xpBonuses)
const getTotalAttribute = (attr: keyof Tamer['attributes']): number => {
  if (!tamer.value) return 0
  const base = tamer.value.attributes[attr] || 0
  const bonus = tamer.value.xpBonuses?.attributes[attr] || 0
  return base + bonus
}

const getTotalSkill = (skill: keyof Tamer['skills']): number => {
  if (!tamer.value) return 0
  const base = tamer.value.skills[skill] || 0
  const bonus = tamer.value.xpBonuses?.skills[skill] || 0
  return base + bonus
}

// Computed
const totalAttributes = computed(() => {
  if (!tamer.value) return {}
  return {
    agility: getTotalAttribute('agility'),
    body: getTotalAttribute('body'),
    charisma: getTotalAttribute('charisma'),
    intelligence: getTotalAttribute('intelligence'),
    willpower: getTotalAttribute('willpower'),
  }
})

const totalSkills = computed(() => {
  if (!tamer.value) return {}
  return {
    dodge: getTotalSkill('dodge'),
    fight: getTotalSkill('fight'),
    stealth: getTotalSkill('stealth'),
    athletics: getTotalSkill('athletics'),
    endurance: getTotalSkill('endurance'),
    featsOfStrength: getTotalSkill('featsOfStrength'),
    manipulate: getTotalSkill('manipulate'),
    perform: getTotalSkill('perform'),
    persuasion: getTotalSkill('persuasion'),
    computer: getTotalSkill('computer'),
    survival: getTotalSkill('survival'),
    knowledge: getTotalSkill('knowledge'),
    perception: getTotalSkill('perception'),
    decipherIntent: getTotalSkill('decipherIntent'),
    bravery: getTotalSkill('bravery'),
  }
})

const tamerStats = computed(() => {
  if (!tamer.value) return null

  // Calculate derived stats using total values (base + xpBonuses)
  return {
    woundBoxes: Math.max(2, getTotalAttribute('body') + getTotalSkill('endurance')),
    speed: getTotalAttribute('agility') + getTotalSkill('survival'),
    accuracyPool: getTotalAttribute('agility') + getTotalSkill('fight'),
    dodgePool: getTotalAttribute('agility') + getTotalSkill('dodge'),
    armor: getTotalAttribute('body') + getTotalSkill('endurance'),
    damage: getTotalAttribute('body') + getTotalSkill('fight'),
    maxInspiration: Math.max(1, getTotalAttribute('willpower')),
  }
})

const specialOrders = computed(() => {
  if (!tamer.value) return []
  const attrs = typeof tamer.value.attributes === 'string' ? JSON.parse(tamer.value.attributes) : tamer.value.attributes
  const xpB = typeof tamer.value.xpBonuses === 'string' ? JSON.parse(tamer.value.xpBonuses) : tamer.value.xpBonuses
  return getUnlockedSpecialOrders(attrs, xpB, tamer.value.campaignLevel)
})

// Get current stage digimon for this tamer (for digimon selection)
const currentPartnerDigimon = computed(() => {
  if (!tamer.value) return []

  // Build set of current partner digimon IDs
  const currentStageIds = new Set<string>()

  for (const evolutionLine of evolutionLines.value) {
    // Only process evolution lines with this tamer as partner
    if (evolutionLine.partnerId !== tamer.value.id) continue

    const currentStage = getCurrentStage(evolutionLine)
    if (currentStage?.digimonId) {
      currentStageIds.add(currentStage.digimonId)
    }
  }

  // Filter partner digimon to only show current stages
  return partnerDigimon.value.filter((d) => currentStageIds.has(d.id))
})

const myParticipants = computed(() => {
  if (!activeEncounter.value || !tamer.value) return []
  const participants = activeEncounter.value.participants as CombatParticipant[]
  return participants.filter(
    (p) =>
      (p.type === 'tamer' && p.entityId === tamer.value!.id) ||
      (p.type === 'digimon' && partnerDigimon.value.some((d) => d.id === p.entityId))
  )
})

const myTamerParticipant = computed(() =>
  myParticipants.value.find((p) => p.type === 'tamer') ?? null
)

const currentTurnParticipant = computed(() => {
  if (!activeEncounter.value) return null
  return getCurrentParticipant(activeEncounter.value)
})

const isMyTurn = computed(() => {
  if (!currentTurnParticipant.value || !tamer.value) return false
  return myParticipants.value.some((p) => p.id === currentTurnParticipant.value!.id)
})

// Request detection
const hasDigimonRequest = computed(() => myRequests.value.some((r) => r.type === 'digimon-selection'))
const hasInitiativeRequest = computed(() => myRequests.value.some((r) => r.type === 'initiative-roll'))
const hasDodgeRequest = computed(() => myRequests.value.some((r) => r.type === 'dodge-roll'))
const hasIntercedeRequest = computed(() => myRequests.value.some((r) => r.type === 'intercede-offer'))

const currentDigimonRequest = computed(() => myRequests.value.find((r) => r.type === 'digimon-selection'))
const currentInitiativeRequest = computed(() => myRequests.value.find((r) => r.type === 'initiative-roll'))
const currentDodgeRequest = computed(() => myRequests.value.find((r) => r.type === 'dodge-roll'))
const currentIntercedeRequest = computed(() => myRequests.value.find((r) => r.type === 'intercede-offer'))

// Reset roll flags when requests change (new request arrives)
// Watch by ID to avoid resetting on every 5-second data refresh (new object references)
watch(() => currentInitiativeRequest.value?.id, () => {
  hasRolledInitiative.value = false
  initiativeRollResult.value = null
})

watch(() => currentDodgeRequest.value?.id, () => {
  hasRolledDodge.value = false
  dodgeRollResult.value = null
})

watch(() => currentDigimonRequest.value?.id, () => {
  selectedDigimonId.value = null
})

// Check if request has already been responded to (hide modal if response exists)
const hasUnrespondedDigimonRequest = computed(() => {
  if (!activeEncounter.value || !tamer.value) return false

  const digimonRequest = currentDigimonRequest.value
  if (!digimonRequest) return false

  // Check if response already exists for this request
  const responses = (activeEncounter.value.requestResponses as any[]) || []
  const hasResponse = responses.some((r) => r.requestId === digimonRequest.id && r.tamerId === tamer.value!.id)

  return !hasResponse // Only show modal if no response yet
})

const hasUnrespondedInitiativeRequest = computed(() => {
  if (!activeEncounter.value || !tamer.value) return false

  const initiativeRequest = currentInitiativeRequest.value
  if (!initiativeRequest) return false

  const responses = (activeEncounter.value.requestResponses as any[]) || []
  const hasResponse = responses.some((r) => r.requestId === initiativeRequest.id && r.tamerId === tamer.value!.id)

  return !hasResponse
})

const hasUnrespondedDodgeRequest = computed(() => {
  if (!activeEncounter.value || !tamer.value) return false

  const dodgeRequest = currentDodgeRequest.value
  if (!dodgeRequest) return false

  const responses = (activeEncounter.value.requestResponses as any[]) || []
  const hasResponse = responses.some((r) => r.requestId === dodgeRequest.id && r.tamerId === tamer.value!.id)

  return !hasResponse
})

// Dodge dice pool for the target participant in a dodge request (reduced by successive dodge penalty)
const dodgeDicePool = computed(() => {
  if (!activeEncounter.value || !currentDodgeRequest.value) return 3

  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const targetParticipant = participants.find((p) => p.id === currentDodgeRequest.value!.targetParticipantId)
  if (!targetParticipant) return 3

  let pool = 3
  if (targetParticipant.type === 'digimon') {
    const digi = allDigimon.value.find((d) => d.id === targetParticipant.entityId)
    if (digi) {
      const baseStats = typeof digi.baseStats === 'string' ? JSON.parse(digi.baseStats) : digi.baseStats
      const bonusStats = typeof (digi as any).bonusStats === 'string' ? JSON.parse((digi as any).bonusStats) : (digi as any).bonusStats
      const totalDodge = (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0)
      pool = totalDodge || 3
    }
  } else if (targetParticipant.type === 'tamer') {
    const targetTamer = allTamers.value.find((t) => t.id === targetParticipant.entityId)
    if (targetTamer) {
      const derived = calcTamerStats(targetTamer)
      pool = derived.dodgePool || 3
    }
  }

  pool = applyStanceToDodge(pool, targetParticipant.currentStance)
  const penalty = currentDodgeRequest.value?.data?.dodgePenalty ?? 0
  pool = Math.max(1, pool - penalty)

  // Add Directed effect bonus to dodge pool
  const directedEffect = targetParticipant.activeEffects?.find(e => e.name === 'Directed')
  if (directedEffect?.value) {
    pool += directedEffect.value
  }

  return pool
})

// Initiative modifiers
const initiativeModifierA = computed(() => {
  // Digimon AGI
  if (!activeEncounter.value || !currentInitiativeRequest.value) return 0

  // Check if request has digimonId in data (from digimon selection flow)
  const digimonId = currentInitiativeRequest.value.data?.digimonId
  if (digimonId) {
    // Use digimonId from request data
    const digimon = partnerDigimon.value.find((d) => d.id === digimonId)
    if (!digimon) return 0

    const stats = calcDigimonStats(digimon)
    return stats.agility
  }

  // Fallback: try to find participant (for backwards compatibility)
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const participant = participants.find((p) => p.id === currentInitiativeRequest.value!.targetParticipantId)

  if (!participant || participant.type !== 'digimon') return 0

  const digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
  if (!digimon) return 0

  const stats = calcDigimonStats(digimon)
  return stats.agility
})

const initiativeModifierB = computed(() => {
  // Tamer AGI + Fight
  if (!tamer.value) return 0

  const agility = tamer.value.attributes?.agility || 0
  const fight = tamer.value.fight || -1  // If 0 or undefined, default to -1
  return agility + fight
})

const initiativeModifier = computed(() => {
  return Math.max(initiativeModifierA.value, initiativeModifierB.value)
})

// Turn tracking
const turnsUntilMyTurn = computed(() => {
  if (!activeEncounter.value || myParticipants.value.length === 0) return 0

  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const myParticipantIds = new Set(myParticipants.value.map((p) => p.id))

  let count = 0
  for (let i = 1; i <= turnOrder.length; i++) {
    const checkIndex = (currentIndex + i) % turnOrder.length
    const participant = turnOrder[checkIndex]
    if (myParticipantIds.has(participant)) {
      return count
    }
    count++
  }

  return 0
})

const turnsAfterMyTurn = computed(() => {
  if (!activeEncounter.value || myParticipants.value.length === 0) return 0

  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const myParticipantIds = new Set(myParticipants.value.map((p) => p.id))

  let foundMe = false
  let count = 0

  for (let i = 1; i <= turnOrder.length; i++) {
    const checkIndex = (currentIndex + i) % turnOrder.length
    const isMine = myParticipantIds.has(turnOrder[checkIndex])

    if (!foundMe) {
      if (isMine) foundMe = true
    } else {
      if (!isMine) {
        return count
      }
      count++
    }
  }

  return 0
})

const nextTurnParticipant = computed(() => {
  if (!activeEncounter.value) return null

  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const myParticipantIds = new Set(myParticipants.value.map((p) => p.id))

  let foundMe = false

  for (let i = 1; i <= turnOrder.length; i++) {
    const checkIndex = (currentIndex + i) % turnOrder.length
    const participantId = turnOrder[checkIndex]
    const isMine = myParticipantIds.has(participantId)

    if (!foundMe) {
      if (isMine) foundMe = true
    } else {
      if (!isMine) {
        return participants.find((p) => p.id === participantId) || null
      }
    }
  }

  return null
})

// New turn tracker computed properties for redesigned layout
const firstPlayerTurnIndex = computed(() => {
  if (!activeEncounter.value || myParticipants.value.length === 0) return -1

  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const myParticipantIds = new Set(myParticipants.value.map((p) => p.id))

  // Find first occurrence of player's turn starting from current index
  for (let i = 0; i < turnOrder.length; i++) {
    const checkIndex = (currentIndex + i) % turnOrder.length
    if (myParticipantIds.has(turnOrder[checkIndex])) {
      return checkIndex
    }
  }
  return -1
})

const turnsUntilFirstPlayerTurn = computed(() => {
  if (!activeEncounter.value || firstPlayerTurnIndex.value === -1) return 0

  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []

  let distance
  if (firstPlayerTurnIndex.value >= currentIndex) {
    distance = firstPlayerTurnIndex.value - currentIndex
  } else {
    distance = (turnOrder.length - currentIndex) + firstPlayerTurnIndex.value
  }

  // Return turns BETWEEN (exclude the player's turn itself)
  return Math.max(0, distance - 1)
})

// Full turn cycle length: number of OTHER participants (turnOrder.length - 1)
// This is how many turns occur before the player's turn comes around again
// Used by both Scenario A (Element 4) and Scenario B (Elements 2 & 4)
const turnCycleLength = computed(() => {
  if (!activeEncounter.value) return 0
  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  // turnOrder includes this player, so subtract 1 to get OTHER participants
  return Math.max(1, turnOrder.length - 1)
})

function getParticipantName(participant: CombatParticipant): string {
  if (participant.type === 'tamer') {
    // Look up the tamer by entityId from all available tamers
    const participantTamer = allTamers.value.find((t) => t.id === participant.entityId)
    return participantTamer?.name || 'Unknown'
  }
  // For digimon, try to find in partner digimon first
  let digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
  if (digimon) return digimon.name

  // Fallback: check allDigimon (includes enemy digimon)
  digimon = allDigimon.value.find((d) => d.id === participant.entityId)
  if (digimon) return digimon.name

  // If still not found, return generic label
  return 'Unknown'
}

function getParticipantAttacks(participant: CombatParticipant): any[] {
  if (participant.type !== 'digimon') return []
  const digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
  const attacks = digimon?.attacks || []
  // Filter out attacks already used this turn
  const usedIds = new Set(participant.usedAttackIds || [])
  return attacks.filter((a: any) => !usedIds.has(a.id))
}

function getAttackStats(participant: CombatParticipant, attack: any) {
  if (participant.type !== 'digimon') {
    return { accuracy: 0, damage: 0, accuracyBonus: 0, damageBonus: 0, notes: [], range: 0, effectiveLimit: 0, attackRange: null, attackEffectiveLimit: null }
  }

  const digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
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
  if (hasQuality('true-guardian')) {
    accuracyBonus -= 2
  }
  if (hasQuality('huge-power')) {
    notes.push(attack.range === 'melee' ? 'Reroll 1s' : 'Reroll 1s (1/round)')
  }
  if (hasQuality('overkill')) {
    notes.push('Reroll 2s (1/round)')
  }
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
  if (hasQuality('mobile-artillery') && hasTag('area')) {
    notes.push('+CPU DMG (Area)')
  }
  if (hasQuality('hit-and-run') && hasTag('charge')) {
    notes.push('+RAM DMG (Charge)')
  }

  // === WEAPON-TAGGED ATTACK BONUSES (Digizoid Weapons) ===
  if (hasWeaponTag) {
    if (hasQuality('digizoid-weapon-chrome')) {
      accuracyBonus += 2
      damageBonus += 1
    }
    if (hasQuality('digizoid-weapon-black')) {
      accuracyBonus += 2
      notes.push('+random (d6)')
    }
    if (hasQuality('digizoid-weapon-brown')) {
      damageBonus += 2
    }
    if (hasQuality('digizoid-weapon-blue')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 auto success')
    }
    if (hasQuality('digizoid-weapon-gold')) {
      accuracyBonus += 4
      damageBonus += 1
    }
    if (hasQuality('digizoid-weapon-obsidian')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 Armor Piercing')
    }
    if (hasQuality('digizoid-weapon-red')) {
      damageBonus += 6
    }
  }

  // === SIGNATURE MOVE BONUSES ===
  if (hasSignatureTag) {
    notes.push('+Attacks ACC/DMG (R3+)')
  }

  // === TAG-BASED BONUSES ===
  if (attack.tags) {
    for (const tag of attack.tags) {
      const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
      if (weaponMatch) {
        const rankStr = weaponMatch[1]
        const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
        const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
        damageBonus += rank
        accuracyBonus += rank
      }

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

  const stats = calcDigimonStats(digimon)

  // Per-attack range: melee = 1 (or Reach x 2), ranged = calculated
  const reachQuality = digimon.qualities?.find((q: any) => q.id === 'reach')
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

function canUseAttack(participant: CombatParticipant, attack: any): boolean {
  // Attacks cost 1 simple action
  const requiredActions = 1
  return (participant.actionsRemaining?.simple || 0) >= requiredActions
}

function canUseSpecialOrderInCombat(participant: CombatParticipant, order: any): boolean {
  // Can't use if already used
  if ((participant.usedSpecialOrders || []).includes(order.name)) {
    return false
  }
  // Passive abilities don't consume actions
  if (getOrderUsageLimit(order.type) === 'passive') {
    return false
  }
  // Check if tamer has enough actions
  const requiredActions = getOrderActionCost(order.type)
  return (participant.actionsRemaining?.simple || 0) >= requiredActions
}

function getEntityName(participant: CombatParticipant): string {
  if (participant.type === 'tamer') {
    const t = allTamers.value.find((tam) => tam.id === participant.entityId)
    return t?.name || 'Unknown Tamer'
  } else if (participant.type === 'digimon') {
    const d = allDigimon.value.find((dig) => dig.id === participant.entityId)
    return d?.name || 'Unknown Digimon'
  }
  return 'Unknown'
}

function getTamerSpecialOrders(participant: CombatParticipant): any[] {
  if (participant.type !== 'tamer') return []
  const tamedData = allTamers.value.find((t) => t.id === participant.entityId)
  if (!tamedData) return []

  const attrs = typeof tamedData.attributes === 'string' ? JSON.parse(tamedData.attributes) : tamedData.attributes
  const xpB = typeof tamedData.xpBonuses === 'string' ? JSON.parse(tamedData.xpBonuses) : tamedData.xpBonuses
  return getUnlockedSpecialOrders(attrs, xpB, tamedData.campaignLevel)
}

function getParticipantImage(participant: CombatParticipant): string | null {
  if (participant.type === 'digimon') {
    // Try to find in partner digimon first
    let digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
    if (digimon?.spriteUrl) return digimon.spriteUrl

    // Fallback: check allDigimon (includes enemy digimon)
    digimon = allDigimon.value.find((d) => d.id === participant.entityId)
    if (digimon?.spriteUrl) return digimon.spriteUrl

    // If not found, return null (fallback to emoji)
    return null
  } else if (participant.type === 'tamer') {
    // Look up the tamer by entityId from all available tamers
    const participantTamer = allTamers.value.find((t) => t.id === participant.entityId)
    return participantTamer?.spriteUrl || null
  }
  return null
}

// Check if a participant can act (either their turn or their partner's turn)
// Player combat actions (stance, movement, tamer direct)
async function changePlayerStance(participant: CombatParticipant, stance: CombatParticipant['currentStance']) {
  if (!activeEncounter.value || !tamer.value) return
  if ((participant.actionsRemaining?.simple || 0) < 1) return
  if (participant.currentStance === stance) return

  const participants = (activeEncounter.value.participants as CombatParticipant[])
  const target = participants.find((p) => p.id === participant.id)
  if (!target) return

  target.actionsRemaining.simple = Math.max(0, (target.actionsRemaining?.simple || 0) - 1)
  target.currentStance = stance

  // Force Vue reactivity by reassigning activeEncounter with new object references
  activeEncounter.value = { ...activeEncounter.value, participants: [...participants] }

  await updateEncounter(activeEncounter.value.id, { participants })
  await addBattleLogEntry(activeEncounter.value.id, {
    round: activeEncounter.value.round,
    actorId: target.id,
    actorName: getParticipantName(target) || 'Unknown',
    action: 'Changed stance',
    target: null,
    result: `Switched to ${stance} stance`,
    damage: null,
    effects: [],
  })
}

async function usePlayerAction(participant: CombatParticipant, actionType: 'movement') {
  if (!activeEncounter.value || !tamer.value) return

  if ((participant.actionsRemaining?.simple || 0) < 1) return

  const participants = (activeEncounter.value.participants as CombatParticipant[])
  const target = participants.find((p) => p.id === participant.id)
  if (!target) return

  target.actionsRemaining.simple = Math.max(0, (target.actionsRemaining?.simple || 0) - 1)
  await updateEncounter(activeEncounter.value.id, { participants })

  await addBattleLogEntry(activeEncounter.value.id, {
    round: activeEncounter.value.round,
    actorId: target.id,
    actorName: getParticipantName(target) || 'Unknown',
    action: 'Movement',
    target: null,
    result: 'Used movement action',
    damage: null,
    effects: [],
  })
  await loadData()
}

// Direct action - opens target selector
function openPlayerDirectTargetSelector(bolstered: boolean) {
  pendingDirectBolstered.value = bolstered
  showDirectTargetSelector.value = true
}

// Get eligible digimon targets for Direct (from player's perspective)
function getPlayerDirectTargets(): CombatParticipant[] {
  if (!activeEncounter.value) return []
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  return participants.filter(p => p.type === 'digimon')
}

// Confirm direct action on selected digimon
async function confirmPlayerDirect(targetDigimon: CombatParticipant) {
  if (!activeEncounter.value || !tamer.value) return

  // Find the tamer participant
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const tamerParticipant = participants.find(p => p.type === 'tamer' && p.entityId === tamer.value!.id)
  if (!tamerParticipant) return

  try {
    await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/direct`, {
      method: 'POST',
      body: {
        participantId: tamerParticipant.id,
        targetDigimonId: targetDigimon.id,
        bolstered: pendingDirectBolstered.value,
      },
    })
    showDirectTargetSelector.value = false
    await loadData()
  } catch (e: any) {
    console.error('Direct failed:', e)
    alert(e?.data?.message || 'Failed to execute Direct')
  }
}

// Check if an attack can be bolstered (player version)
function canBolsterAttack(participant: CombatParticipant, attack: any): boolean {
  if (participant.type !== 'digimon') return false
  if ((participant.actionsRemaining?.simple || 0) < 2) return false
  if ((participant.digimonBolsterCount ?? 0) >= 2) return false
  if (attack.tags?.some((t: string) => t.toLowerCase().includes('signature'))) return false
  return true
}

function canParticipantAct(participant: CombatParticipant): boolean {
  if (!activeEncounter.value) return false

  const turnOrder = (activeEncounter.value.turnOrder as string[]) || []
  const currentIndex = activeEncounter.value.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  // Can act if it's directly their turn
  if (participant.id === currentTurnParticipantId) return true

  // Digimon can act if it's their partner tamer's turn
  if (participant.type === 'digimon') {
    const digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
    if (digimon?.partnerId) {
      // Check if any participant is the partner tamer and has active turn
      const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
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

// Digivolve / Devolve helpers
function getParticipantEvolutionOptions(participant: CombatParticipant) {
  if (!participant.evolutionLineId) return { canEvolve: false, canDevolve: false, evolveTargets: [] as any[], devolveTarget: null as any }
  const evoLine = evolutionLines.value.find(l => l.id === participant.evolutionLineId)
  if (!evoLine) return { canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null }

  const chain = typeof evoLine.chain === 'string' ? JSON.parse(evoLine.chain) : evoLine.chain
  const currentIndex = evoLine.currentStageIndex

  const evolveTargets = chain
    .map((entry: any, index: number) => ({ ...entry, chainIndex: index }))
    .filter((entry: any) => entry.evolvesFromIndex === currentIndex && entry.isUnlocked)

  const currentEntry = chain[currentIndex]
  const canDevolve = (participant.woundsHistory?.length || 0) > 0 && currentEntry?.evolvesFromIndex !== null
  const devolveTarget = canDevolve ? { ...chain[currentEntry.evolvesFromIndex], chainIndex: currentEntry.evolvesFromIndex } : null

  return { canEvolve: evolveTargets.length > 0, canDevolve, evolveTargets, devolveTarget }
}

async function handleDigivolve(participant: CombatParticipant, targetChainIndex: number) {
  if (!activeEncounter.value || !tamer.value) return

  // Check if this is an evolve (not devolve) — evolves require a willpower roll
  const evoOptions = getParticipantEvolutionOptions(participant)
  const isEvolve = evoOptions.evolveTargets.some((t: any) => t.chainIndex === targetChainIndex)

  if (isEvolve) {
    const target = evoOptions.evolveTargets.find((t: any) => t.chainIndex === targetChainIndex)
    pendingDigivolve.value = { participant, targetChainIndex, targetSpecies: target?.species || 'Unknown' }
    willpowerRollResult.value = null
    hasRolledWillpower.value = false
    showWillpowerRollModal.value = true
    return
  }

  // Devolve — proceed directly (no willpower roll)
  try {
    await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/digivolve`, {
      method: 'POST',
      body: { participantId: participant.id, targetChainIndex },
    })
    await loadData()
  } catch (e: any) {
    console.error('Devolve failed:', e)
    alert(e?.data?.message || 'Failed to devolve')
  }
}

function rollWillpower() {
  if (!tamer.value) return
  const attrs = typeof tamer.value.attributes === 'string' ? JSON.parse(tamer.value.attributes as any) : tamer.value.attributes
  const willpower = attrs?.willpower || 0
  const rolls: number[] = []
  for (let i = 0; i < 3; i++) rolls.push(Math.floor(Math.random() * 6) + 1)
  const total = rolls.reduce((a, b) => a + b, 0) + willpower
  willpowerRollResult.value = { rolls, total }
  hasRolledWillpower.value = true
}

async function submitWillpowerRoll() {
  if (!activeEncounter.value || !tamer.value || !willpowerRollResult.value || !pendingDigivolve.value) return

  const attrs = typeof tamer.value.attributes === 'string' ? JSON.parse(tamer.value.attributes as any) : tamer.value.attributes
  const dc = DIGIVOLVE_WILLPOWER_DC[tamer.value.campaignLevel]
  const passed = willpowerRollResult.value.total >= dc

  if (passed) {
    try {
      await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/digivolve`, {
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
      await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/digivolve-fail`, {
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
  await loadData()
}

// Calculate health percentage for target display (percentage-based for enemies)
function getHealthPercentage(participant: CombatParticipant): number {
  const currentHealth = participant.maxWounds - participant.currentWounds
  const maxHealth = participant.maxWounds
  return maxHealth > 0 ? (currentHealth / maxHealth) * 100 : 0
}

function getEnemyTargets(): CombatParticipant[] {
  if (!activeEncounter.value) return []
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const myParticipantIds = new Set(myParticipants.value.map((p) => p.id))

  return participants.filter((p) => !myParticipantIds.has(p.id))
}

async function selectAttackAndShowTargets(participant: CombatParticipant, attack: any) {
  selectedAttack.value = { participant, attack }
  bolsterAttackEnabled.value = false
  bolsterAttackType.value = 'damage-accuracy'
  showTargetSelector.value = true
}

async function confirmAttack(target: CombatParticipant) {
  if (!selectedAttack.value || !activeEncounter.value || !tamer.value) return

  try {
    const { participant, attack } = selectedAttack.value

    // Calculate accuracy with bolster bonus
    let accuracyPool = getAttackStats(participant, attack).accuracy
    if (bolsterAttackEnabled.value && bolsterAttackType.value === 'damage-accuracy') {
      accuracyPool += 2
    }

    // Roll accuracy (count successes: 5+ = 1 success)
    const accuracyDiceResults = []
    for (let i = 0; i < accuracyPool; i++) {
      accuracyDiceResults.push(Math.floor(Math.random() * 6) + 1)
    }
    const accuracySuccesses = accuracyDiceResults.filter(d => d >= 5).length

    // Submit attack to server
    const result = await performAttack(
      activeEncounter.value.id,
      participant.id,
      attack.id,
      target.id,
      {
        dicePool: accuracyPool,
        successes: accuracySuccesses,
        diceResults: accuracyDiceResults,
      },
      tamer.value.id,
      bolsterAttackEnabled.value ? {
        bolstered: true,
        bolsterType: bolsterAttackType.value,
      } : undefined
    )

    if (result) {
      if (accuracySuccesses === 0) {
        // Auto-miss: show miss result directly, no dodge request will come
        attackResultQueue.value.push({
          responseId: `miss-${Date.now()}`,
          attackerName: tamer.value?.name || 'You',
          attackName: attack.name,
          targetName: getParticipantName(target),
          accuracyDicePool: accuracyPool,
          accuracyDiceResults: accuracyDiceResults,
          accuracySuccesses: 0,
          dodgeDicePool: 0,
          dodgeDiceResults: [],
          dodgeSuccesses: 0,
          netSuccesses: 0,
          hit: false,
          baseDamage: 0,
          armorPiercing: 0,
          targetArmor: 0,
          finalDamage: 0,
        })
        showAttackResultModal.value = true
      } else {
        // Store pending attack for result tracking (await dodge response)
        const trackingId = `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        pendingAttacks.value.push({
          trackingId: trackingId,
          timestamp: Date.now(),
          attackName: attack.name,
          targetName: getParticipantName(target),
          accuracyDicePool: accuracyPool,
          accuracyDiceResults: accuracyDiceResults,
          accuracySuccesses: accuracySuccesses,
          participantId: participant.id,
          attackData: attack
        })
      }

      // Show feedback and close modal
      showTargetSelector.value = false
      selectedAttack.value = null

      // Refresh to see updated state
      await loadData()
    } else {
      console.error('Failed to perform attack')
    }
  } catch (error) {
    console.error('Error performing attack:', error)
  }
}

function showAttackResult(
  pendingAttack: any,
  dodgeRequest: any,
  dodgeResponse: any
) {
  console.log('[ATTACK RESULT] showAttackResult called:', {
    attackName: pendingAttack.attackName,
    targetName: pendingAttack.targetName,
    accuracySuccesses: pendingAttack.accuracySuccesses,
    dodgeSuccesses: dodgeResponse.response.dodgeSuccesses
  })

  const accuracySuccesses = pendingAttack.accuracySuccesses
  const dodgeSuccesses = dodgeResponse.response.dodgeSuccesses
  const netSuccesses = accuracySuccesses - dodgeSuccesses
  const hit = netSuccesses >= 0

  console.log('[ATTACK RESULT] Damage calculation: accuracySuccesses:', accuracySuccesses, 'dodgeSuccesses:', dodgeSuccesses, 'netSuccesses:', netSuccesses, 'hit:', hit)

  // Get attacker's digimon to calculate base damage
  const attackDef = pendingAttack.attackData
  let baseDamage = 0
  let armorPiercing = 0

  // Find attacker participant to get their digimon data
  const participants = activeEncounter.value?.participants || []
  const attackerParticipant = participants.find((p: any) => p.id === pendingAttack.participantId)

  if (attackerParticipant && attackerParticipant.type === 'digimon') {
    const attackerDigimon = allDigimon.value.find((d) => d.id === attackerParticipant.entityId)

    if (attackerDigimon) {
      // Parse baseStats and bonusStats if they're JSON strings
      const baseStats = typeof attackerDigimon.baseStats === 'string'
        ? JSON.parse(attackerDigimon.baseStats)
        : attackerDigimon.baseStats
      const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
        ? JSON.parse((attackerDigimon as any).bonusStats)
        : (attackerDigimon as any).bonusStats

      // Base damage from digimon stats
      baseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

      // Add weapon tag bonuses
      if (attackDef?.tags && Array.isArray(attackDef.tags)) {
        for (const tag of attackDef.tags) {
          // Weapon tags add to damage
          const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
          if (weaponMatch) {
            const rankStr = weaponMatch[1]
            const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
            const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
            baseDamage += rank
          }

          // Armor Piercing tags
          const apMatch = tag.match(/^Armor Piercing\s+(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)$/i)
          if (apMatch) {
            const rankStr = apMatch[1]
            const romanMap: Record<string, number> = {
              'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
              'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
            }
            const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 0
            armorPiercing = rank * 2
          }
        }
      }
    }
  }

  // Get target armor with JSON parsing fix
  let targetArmor = 0
  const targetParticipant = participants.find((p: any) =>
    p.id === dodgeRequest.targetParticipantId
  )

  if (targetParticipant) {
    if (targetParticipant.type === 'digimon') {
      const targetDigimon = allDigimon.value.find((d) => d.id === targetParticipant.entityId)
      if (targetDigimon) {
        // Parse baseStats and bonusStats if they're JSON strings
        const targetBaseStats = typeof targetDigimon.baseStats === 'string'
          ? JSON.parse(targetDigimon.baseStats)
          : targetDigimon.baseStats
        const targetBonusStats = typeof (targetDigimon as any).bonusStats === 'string'
          ? JSON.parse((targetDigimon as any).bonusStats)
          : (targetDigimon as any).bonusStats

        targetArmor = (targetBaseStats?.armor ?? 0) + (targetBonusStats?.armor ?? 0)

        // Add Guardian data optimization bonus (+2 armor)
        const targetQualities = typeof targetDigimon.qualities === 'string'
          ? JSON.parse(targetDigimon.qualities)
          : targetDigimon.qualities
        const targetDataOpt = targetQualities?.find((q: any) => q.id === 'data-optimization')
        if (targetDataOpt?.choiceId === 'guardian') {
          targetArmor += 2
        }
      }
    } else if (targetParticipant.type === 'tamer') {
      const targetTamer = allTamers.value.find((t) => t.id === targetParticipant.entityId)
      if (targetTamer) {
        const derived = calcTamerStats(targetTamer)
        targetArmor = derived.armor || 0
      }
    }
  }

  // Calculate final damage
  let finalDamage = 0
  if (hit) {
    const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
    finalDamage = Math.max(1, baseDamage + netSuccesses - effectiveArmor)  // Minimum 1 damage on hit
  }

  console.log('[ATTACK RESULT] About to add to queue, current length:', attackResultQueue.value.length)

  // Add to queue to handle multiple attacks in one turn
  attackResultQueue.value.push({
    responseId: dodgeResponse.id,
    attackerName: tamer.value?.name || 'You',
    attackName: pendingAttack.attackName,
    targetName: pendingAttack.targetName,
    accuracyDicePool: pendingAttack.accuracyDicePool,
    accuracyDiceResults: pendingAttack.accuracyDiceResults,
    accuracySuccesses: accuracySuccesses,
    dodgeDicePool: dodgeResponse.response.dodgeDicePool,
    dodgeDiceResults: dodgeResponse.response.dodgeDiceResults,
    dodgeSuccesses: dodgeSuccesses,
    netSuccesses: netSuccesses,
    hit: hit,
    baseDamage: baseDamage,
    armorPiercing: armorPiercing,
    targetArmor: targetArmor,
    finalDamage: finalDamage
  })

  console.log('[ATTACK RESULT] Added to queue, new length:', attackResultQueue.value.length)
  console.log('[ATTACK RESULT] attackResultData computed value:', attackResultData.value ? 'HAS DATA' : 'NULL')

  // Show modal (will display the first item in the queue)
  showAttackResultModal.value = true
  console.log('[ATTACK RESULT] Modal flag set to true')
}

async function closeAttackResultModal() {
  // Get the current (first) result before removing it
  const currentResult = attackResultQueue.value[0]

  // Delete the response from the encounter
  if (currentResult?.responseId && activeEncounter.value) {
    try {
      await deleteResponse(activeEncounter.value.id, currentResult.responseId)
    } catch (error) {
      console.error('Failed to delete response:', error)
      // Continue closing modal even if delete fails
    }
  }

  // Remove the current (first) result from the queue
  attackResultQueue.value.shift()

  // Keep modal open if there are more results to show, close otherwise
  if (attackResultQueue.value.length === 0) {
    showAttackResultModal.value = false
  }
}

// Clear selection
const selectedTamerId = useCookie<string | null>('player-tamer-id')
function switchCharacter() {
  selectedTamerId.value = null
  navigateTo('/player')
}

// Request response handlers
async function submitDigimonSelection(digimonId: string | null) {
  if (!activeEncounter.value || !currentDigimonRequest.value || !tamer.value) return

  // Set immediately for visual feedback (use 'none' sentinel for null selection)
  selectedDigimonId.value = digimonId === null ? 'none' : digimonId

  console.log('Submitting digimon selection:', digimonId)

  try {
    const result = await respondToRequest(
      activeEncounter.value.id,
      currentDigimonRequest.value.id,
      tamer.value.id,
      {
        type: 'digimon-selected',
        digimonId: digimonId, // Send null explicitly for tamer-only, or string for digimon
        timestamp: new Date().toISOString(),
      }
    )

    console.log('Digimon selection response result:', result)

    if (result) {
      // Refresh to clear the request (modal will close automatically)
      await loadData()
    } else {
      console.error('Failed to submit digimon selection - response was falsy')
      // Keep the selection visible even on failure so user knows their click registered
    }
  } catch (error) {
    console.error('Error submitting digimon selection:', error)
    // Keep the selection visible even on error - don't reset to null
    // This provides feedback that the click was registered even if API failed
  }
}

async function submitInitiativeRoll() {
  if (!activeEncounter.value || !currentInitiativeRequest.value || !tamer.value || !initiativeRollResult.value) return

  try {
    let digimon = null

    // Check if request has digimonId in data (from digimon selection flow)
    if (currentInitiativeRequest.value.data?.digimonId) {
      digimon = partnerDigimon.value.find((d) => d.id === currentInitiativeRequest.value!.data.digimonId)
    } else {
      // Fallback: try to find participant
      const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
      const participant = participants.find((p) => p.id === currentInitiativeRequest.value!.targetParticipantId)

      if (participant && participant.type === 'digimon') {
        digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
      }
    }

    // Calculate both modifiers
    // For digimon + tamer: use higher of (digimon AGI) or (tamer AGI + Fight)
    // For tamer-only: use only (tamer AGI + Fight)
    const modifierA = digimon ? calcDigimonStats(digimon).agility : 0

    const tamerAgility = tamer.value.attributes?.agility || 0
    const fight = tamer.value.fight || -1  // If 0 or undefined, default to -1
    const modifierB = tamerAgility + fight // Tamer AGI + Fight

    // Use the higher modifier (or just tamer modifier if no digimon)
    const modifier = Math.max(modifierA, modifierB)
    const totalInitiative = initiativeRollResult.value.total + modifier

    console.log('Initiative calculation:', { digimon: digimon?.name || 'None (Tamer Only)', modifierA, modifierB, modifier, totalInitiative })

    const result = await respondToRequest(
      activeEncounter.value.id,
      currentInitiativeRequest.value.id,
      tamer.value.id,
      {
        type: 'initiative-rolled',
        initiative: totalInitiative,
        initiativeRoll: initiativeRollResult.value.total,
        timestamp: new Date().toISOString(),
      }
    )

    if (result) {
      // Reset and refresh
      initiativeRollResult.value = null
      await loadData()
    } else {
      console.error('Failed to submit initiative roll')
    }
  } catch (error) {
    console.error('Error submitting initiative roll:', error)
  }
}

async function submitDodgeRoll() {
  if (!activeEncounter.value || !currentDodgeRequest.value || !tamer.value || !dodgeRollResult.value) return

  // Capture context before submitting (loadData() will change currentDodgeRequest)
  const capturedRequest = currentDodgeRequest.value
  const capturedDodgeRoll = dodgeRollResult.value

  try {
    const result = await respondToRequest(
      activeEncounter.value.id,
      currentDodgeRequest.value.id,
      tamer.value.id,
      {
        type: 'dodge-rolled',
        participantId: currentDodgeRequest.value.targetParticipantId,
        dodgeDicePool: dodgeRollResult.value.dicePool,
        dodgeSuccesses: dodgeRollResult.value.successes,
        dodgeDiceResults: dodgeRollResult.value.rolls,
        timestamp: new Date().toISOString(),
      }
    )

    if (result) {
      // Reset and refresh
      dodgeRollResult.value = null

      // Store IDs so we can auto-dismiss when the modal is closed (mirrors GM dismiss flow)
      const responses = (result.requestResponses as any[]) || []
      const myResponse = responses.find(r => r.requestId === capturedRequest.id && r.tamerId === tamer.value!.id)
      if (myResponse) {
        dodgeResponseId.value = myResponse.id
      }
      dodgeRequestId.value = capturedRequest.id

      // Extract the dodge result from the API response before calling loadData()
      const battleLog = (result.battleLog as any[]) || []
      const dodgeEntry = battleLog.findLast(
        (entry: any) => entry.action === 'Dodge' && entry.actorId === capturedRequest.targetParticipantId
      )

      if (dodgeEntry && capturedRequest) {
        dodgeResultData.value = {
          attackName: capturedRequest.data.attackName,
          attackerName: capturedRequest.data.attackerName,
          targetName: capturedRequest.data.targetName,
          dodgeDicePool: capturedDodgeRoll.dicePool,
          dodgeDiceResults: capturedDodgeRoll.rolls,
          dodgeSuccesses: capturedDodgeRoll.successes,
          accuracySuccesses: capturedRequest.data.accuracySuccesses,
          netSuccesses: dodgeEntry.netSuccesses,
          hit: dodgeEntry.hit,
          finalDamage: dodgeEntry.finalDamage,
          baseDamage: dodgeEntry.baseDamage,
          targetArmor: dodgeEntry.targetArmor,
          armorPiercing: dodgeEntry.armorPiercing,
          effectiveArmor: dodgeEntry.effectiveArmor,
        }
        showDodgeResultModal.value = true
      }

      await loadData()
    } else {
      console.error('Failed to submit dodge roll')
    }
  } catch (error) {
    console.error('Error submitting dodge roll:', error)
  }
}

async function closeDodgeResultModal() {
  // Auto-dismiss: mirrors GM dismiss flow (cancelRequest + deleteResponse + fetchEncounter)
  if (activeEncounter.value) {
    try {
      if (dodgeRequestId.value) {
        await cancelRequest(activeEncounter.value.id, dodgeRequestId.value)
      }
      if (dodgeResponseId.value) {
        await deleteResponse(activeEncounter.value.id, dodgeResponseId.value)
      }
      await fetchEncounter(activeEncounter.value.id)
    } catch (error) {
      console.error('Failed to dismiss dodge response:', error)
    }
  }
  showDodgeResultModal.value = false
  dodgeResultData.value = null
  hasRolledDodge.value = false
  dodgeResponseId.value = null
  dodgeRequestId.value = null
}

function closeIntercedeResultModal() {
  showIntercedeResultModal.value = false
  intercedeResultData.value = null
}

// Intercede: Available interceptor options
const intercedeOptions = computed(() => {
  if (!currentIntercedeRequest.value || !activeEncounter.value) return []
  const participants = (activeEncounter.value.participants as CombatParticipant[]) || []
  const targetId = currentIntercedeRequest.value.data?.targetId
  const attackerId = currentIntercedeRequest.value.data?.attackerId
  const options: { id: string; name: string; type: string }[] = []

  // Find my tamer participant
  const myTamerParticipant = participants.find(
    (p) => p.type === 'tamer' && p.entityId === tamer.value?.id
  )
  // Find my partner digimon participant
  const myDigimonParticipant = participants.find((p) => {
    if (p.type !== 'digimon') return false
    const digi = allDigimon.value.find((d) => d.id === p.entityId)
    return digi?.partnerId === tamer.value?.id
  })

  // Offer tamer as interceptor (if tamer is not the target)
  if (myTamerParticipant && myTamerParticipant.id !== targetId && myTamerParticipant.id !== attackerId) {
    options.push({ id: myTamerParticipant.id, name: tamer.value?.name || 'Tamer', type: 'tamer' })
  }
  // Offer partner digimon as interceptor (if digimon is not the target)
  if (myDigimonParticipant && myDigimonParticipant.id !== targetId && myDigimonParticipant.id !== attackerId) {
    const digi = allDigimon.value.find((d) => d.id === myDigimonParticipant.entityId)
    options.push({ id: myDigimonParticipant.id, name: digi?.name || 'Digimon', type: 'digimon' })
  }

  return options
})

// Intercede: Claim (take the hit for another player)
const intercedeLoading = ref(false)
async function handleIntercedeClaim(interceptorParticipantId: string) {
  if (!activeEncounter.value || !currentIntercedeRequest.value) return

  // Capture context before API call (intercede offers are removed from pendingRequests)
  const capturedRequest = currentIntercedeRequest.value

  intercedeLoading.value = true
  try {
    const result = await $fetch<any>(`/api/encounters/${activeEncounter.value.id}/actions/intercede-claim`, {
      method: 'POST',
      body: {
        requestId: capturedRequest.id,
        interceptorParticipantId,
      },
    })

    // Extract the intercede result from the API response before calling loadData()
    if (result) {
      const battleLog = (result.battleLog as any[]) || []
      const intercedeEntry = battleLog.findLast(
        (entry: any) =>
          entry.actorId === interceptorParticipantId &&
          typeof entry.action === 'string' &&
          entry.action.startsWith('Interceded for')
      )

      if (intercedeEntry && capturedRequest) {
        intercedeResultData.value = {
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
        showIntercedeResultModal.value = true
      }
    }

    await loadData()
  } catch (e: any) {
    if (e?.statusCode === 409) {
      alert('Another player already interceded for this attack!')
    } else {
      console.error('Intercede claim failed:', e)
      alert(e?.data?.message || 'Failed to intercede')
    }
  } finally {
    intercedeLoading.value = false
  }
}

// Intercede: Skip (let original target handle it)
async function handleIntercedeSkip() {
  if (!activeEncounter.value || !currentIntercedeRequest.value) return

  intercedeLoading.value = true
  try {
    await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/intercede-skip`, {
      method: 'POST',
      body: {
        requestId: currentIntercedeRequest.value.id,
      },
    })
    await loadData()
  } catch (e: any) {
    console.error('Intercede skip failed:', e)
    alert(e?.data?.message || 'Failed to skip intercede')
  } finally {
    intercedeLoading.value = false
  }
}

// Intercede: Opt-out (never intercede for this target again)
async function handleIntercedeOptOut() {
  if (!activeEncounter.value || !currentIntercedeRequest.value) return

  intercedeLoading.value = true
  try {
    await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/intercede-skip`, {
      method: 'POST',
      body: {
        requestId: currentIntercedeRequest.value.id,
        optOut: true,
      },
    })
    await loadData()
  } catch (e: any) {
    console.error('Intercede opt-out failed:', e)
    alert(e?.data?.message || 'Failed to opt out')
  } finally {
    intercedeLoading.value = false
  }
}

async function handleUseSpecialOrder(participant: CombatParticipant, orderName: string, targetId?: string) {
  if (!activeEncounter.value) return
  try {
    await $fetch(`/api/encounters/${activeEncounter.value.id}/actions/special-order`, {
      method: 'POST',
      body: { participantId: participant.id, orderName, targetId },
    })
    await loadData()
    showPlayerSpecialOrdersModal.value = false
  } catch (e: any) {
    console.error('Special order failed:', e)
    alert(e?.data?.message || 'Failed to use special order')
  }
}

// Parse rank from tag with roman or arabic numerals (e.g., "Weapon II" = 2, "Weapon 3" = 3)
function parseTagRank(tag: string, prefix: string): number {
  const romanToNumber: Record<string, number> = {
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
  }
  const regex = new RegExp(`^${prefix}\\s+(\\d+|[IVX]+)$`, 'i')
  const match = tag.match(regex)
  if (match) {
    const rankStr = match[1].toUpperCase()
    return romanToNumber[rankStr] || parseInt(match[1]) || 0
  }
  return 0
}

// Check if attack has a specific tag pattern
function hasTag(tags: string[], pattern: string): boolean {
  return tags.some(t => t.toLowerCase().includes(pattern.toLowerCase()))
}

// Calculate attack bonuses from tags and qualities
function getAttackBonuses(
  digimon: Digimon,
  attack: { range: 'melee' | 'ranged'; tags: string[] }
): { accuracy: number; damage: number } {
  let accuracy = 0
  let damage = 0
  const qualities = digimon.qualities || []
  const tags = attack.tags || []

  // Helper to check if digimon has a quality
  const hasQuality = (id: string) => qualities.some(q => q.id === id)

  // Data Optimization bonuses
  const dataOptQuality = qualities.find(q => q.id === 'data-optimization')
  const dataOpt = dataOptQuality?.choiceId || (digimon as any).dataOptimization
  if (dataOpt === 'close-combat') {
    if (attack.range === 'melee') accuracy += 2
    else if (attack.range === 'ranged') accuracy -= 1
  } else if (dataOpt === 'ranged-striker') {
    if (attack.range === 'ranged') accuracy += 2
  }

  // Tag-based bonuses
  for (const tag of tags) {
    // Weapon adds +Rank to both Accuracy AND Damage
    const weaponRank = parseTagRank(tag, 'Weapon')
    if (weaponRank > 0) {
      accuracy += weaponRank
      damage += weaponRank
    }

    // Certain Strike adds +2 accuracy per rank
    const certainStrikeRank = parseTagRank(tag, 'Certain Strike')
    if (certainStrikeRank > 0) {
      accuracy += certainStrikeRank * 2
    }
  }

  // Digizoid Weapon bonuses (only for [Weapon] tagged attacks)
  const hasWeaponTag = hasTag(tags, 'weapon')
  if (hasWeaponTag) {
    if (hasQuality('digizoid-weapon-chrome')) { accuracy += 2; damage += 1 }
    if (hasQuality('digizoid-weapon-black')) { accuracy += 2 }
    if (hasQuality('digizoid-weapon-brown')) { damage += 2 }
    if (hasQuality('digizoid-weapon-blue')) { accuracy += 2; damage += 2 }
    if (hasQuality('digizoid-weapon-gold')) { accuracy += 4; damage += 1 }
    if (hasQuality('digizoid-weapon-obsidian')) { accuracy += 2; damage += 2 }
    if (hasQuality('digizoid-weapon-red')) { damage += 6 }
  }

  return { accuracy, damage }
}

// Calculate attack accuracy pool (base + bonus + tag/quality bonuses)
function getAttackAccuracy(digimon: Digimon, attack: { range: 'melee' | 'ranged'; tags: string[] }): number {
  const bonusStats = (digimon as any).bonusStats || { accuracy: 0 }
  const bonuses = getAttackBonuses(digimon, attack)
  return digimon.baseStats.accuracy + (bonusStats.accuracy || 0) + bonuses.accuracy
}

// Get per-attack range: melee = 1 (or Reach x 2), ranged = calculated
function getPerAttackRange(digimon: Digimon, attackRange: 'melee' | 'ranged'): { range: number; effectiveLimit: number | null } {
  if (attackRange === 'melee') {
    const reachQuality = (digimon as any).qualities?.find((q: any) => q.id === 'reach')
    const reachRanks = reachQuality?.ranks || 0
    return { range: reachRanks > 0 ? reachRanks * 2 : 1, effectiveLimit: null }
  }
  const stats = calcDigimonStats(digimon)
  return { range: stats.range, effectiveLimit: stats.effectiveLimit }
}

// Calculate attack damage pool (base + bonus + tag/quality bonuses)
// Note: Stage bonus is NOT added to the pool - it's added to final damage after the roll
function getAttackDamage(digimon: Digimon, attack: { range: 'melee' | 'ranged'; tags: string[] }): number {
  const bonusStats = (digimon as any).bonusStats || { damage: 0 }
  const bonuses = getAttackBonuses(digimon, attack)
  return digimon.baseStats.damage + (bonusStats.damage || 0) + bonuses.damage
}

// Stage order for sorting evolution chains
const stageOrder: DigimonStage[] = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega', 'ultra']

// Track current Digimon ID being viewed for each chain (instead of index)
const currentDigimonId = ref<Record<string, string>>({})

// Track which evolution branch is selected when there are multiple options
const showEvolutionPicker = ref<string | null>(null)

// Group partner Digimon by evolution chains
// Returns an array of { chainId: string, rootId: string, allMembers: Digimon[] }
const digimonChains = computed(() => {
  const chains: { chainId: string; rootId: string; allMembers: Digimon[] }[] = []
  const processed = new Set<string>()

  for (const d of partnerDigimon.value) {
    if (processed.has(d.id)) continue

    // Collect all linked Digimon (ancestors and descendants)
    const chainMembers: Digimon[] = []
    const toVisit = [d.id]
    const visited = new Set<string>()

    while (toVisit.length > 0) {
      const currentId = toVisit.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const current = partnerDigimon.value.find(x => x.id === currentId)
      if (!current) continue

      chainMembers.push(current)
      processed.add(currentId)

      // Add ancestor
      if (current.evolvesFromId) {
        toVisit.push(current.evolvesFromId)
      }

      // Add descendants
      for (const descendantId of current.evolutionPathIds || []) {
        toVisit.push(descendantId)
      }
    }

    // Find root (earliest stage with no evolvesFromId in our set)
    const root = chainMembers.reduce((earliest, current) => {
      const earliestStageIdx = stageOrder.indexOf(earliest.stage as DigimonStage)
      const currentStageIdx = stageOrder.indexOf(current.stage as DigimonStage)
      if (currentStageIdx < earliestStageIdx) return current
      if (currentStageIdx === earliestStageIdx && !current.evolvesFromId) return current
      return earliest
    }, chainMembers[0])

    const chainId = root?.id || d.id
    chains.push({ chainId, rootId: root?.id || d.id, allMembers: chainMembers })

    // Initialize currentDigimonId to Rookie stage by default, or lowest stage if no Rookie
    if (!currentDigimonId.value[chainId]) {
      const rookieMember = chainMembers.find(m => m.stage === 'rookie')
      const defaultMember = rookieMember || chainMembers.reduce((lowest, current) => {
        const lowestIdx = stageOrder.indexOf(lowest.stage as DigimonStage)
        const currentIdx = stageOrder.indexOf(current.stage as DigimonStage)
        return currentIdx < lowestIdx ? current : lowest
      }, chainMembers[0])
      currentDigimonId.value[chainId] = defaultMember?.id || root?.id || d.id
    }
  }

  return chains
})

// Get the currently displayed Digimon for a chain
function getCurrentForm(chainId: string): Digimon | null {
  const chain = digimonChains.value.find(c => c.chainId === chainId)
  if (!chain) return null
  const digimonId = currentDigimonId.value[chainId]
  return chain.allMembers.find(d => d.id === digimonId) || chain.allMembers[0] || null
}

// Get parent Digimon (for de-evolution)
function getParentForm(chainId: string): Digimon | null {
  const current = getCurrentForm(chainId)
  if (!current?.evolvesFromId) return null
  const chain = digimonChains.value.find(c => c.chainId === chainId)
  return chain?.allMembers.find(d => d.id === current.evolvesFromId) || null
}

// Get child Digimon options (for evolution) - can be multiple!
function getEvolutionOptions(chainId: string): Digimon[] {
  const current = getCurrentForm(chainId)
  if (!current?.evolutionPathIds?.length) return []
  const chain = digimonChains.value.find(c => c.chainId === chainId)
  if (!chain) return []
  return (current.evolutionPathIds || [])
    .map(id => chain.allMembers.find(d => d.id === id))
    .filter((d): d is Digimon => d !== undefined)
}

// Check if can navigate to previous form (de-evolve)
function canDeEvolve(chainId: string): boolean {
  return getParentForm(chainId) !== null
}

// Check if can navigate to next form (evolve)
function canEvolveForm(chainId: string): boolean {
  return getEvolutionOptions(chainId).length > 0
}

// Check if evolution has multiple options (branching)
function hasMultipleEvolutions(chainId: string): boolean {
  return getEvolutionOptions(chainId).length > 1
}

// Navigate to previous form (de-evolve)
function deEvolve(chainId: string) {
  const parent = getParentForm(chainId)
  if (parent) {
    currentDigimonId.value[chainId] = parent.id
    showEvolutionPicker.value = null
  }
}

// Navigate to next form (evolve) - if only one option, go directly; if multiple, show picker
function evolveForm(chainId: string, targetId?: string) {
  const options = getEvolutionOptions(chainId)
  if (options.length === 0) return

  if (targetId) {
    // Direct selection from picker
    currentDigimonId.value[chainId] = targetId
    showEvolutionPicker.value = null
  } else if (options.length === 1) {
    // Only one option, go directly
    currentDigimonId.value[chainId] = options[0].id
  } else {
    // Multiple options, toggle picker
    showEvolutionPicker.value = showEvolutionPicker.value === chainId ? null : chainId
  }
}

// Check if a chain has multiple forms
function hasMultipleForms(chainId: string): boolean {
  const chain = digimonChains.value.find(c => c.chainId === chainId)
  return (chain?.allMembers.length || 0) > 1
}

// Get the evolution path from root to current (for breadcrumb display)
function getEvolutionPath(chainId: string): Digimon[] {
  const chain = digimonChains.value.find(c => c.chainId === chainId)
  if (!chain) return []

  const current = getCurrentForm(chainId)
  if (!current) return []

  // Walk back from current to root
  const path: Digimon[] = [current]
  let walker: Digimon | undefined = current
  while (walker?.evolvesFromId) {
    const parent = chain.allMembers.find(d => d.id === walker!.evolvesFromId)
    if (parent) {
      path.unshift(parent)
      walker = parent
    } else {
      break
    }
  }
  return path
}

// Get all movement types available to a Digimon based on qualities
function getMovementTypes(digimon: Digimon): { type: string; speed: number }[] {
  // calcDigimonStats() already includes all movement modifiers (Speedy, Bulky, Instinct, etc.)
  const baseMove = calcDigimonStats(digimon).movement

  const halfMove = Math.floor(baseMove / 2)

  // Check which Extra Movement qualities the Digimon has
  const qualityChoices = new Set(digimon.qualities.map(q => q.choiceId).filter(Boolean))
  const hasJumper = qualityChoices.has('jumper')
  const hasSwimmer = qualityChoices.has('swimmer')
  const hasDigger = qualityChoices.has('digger')
  const hasFlight = qualityChoices.has('flight')
  const hasWallclimber = qualityChoices.has('wallclimber')

  // Check for Advanced Mobility (adds RAM to speed)
  const hasAdvSwimmer = qualityChoices.has('adv-swimmer')
  const hasAdvDigger = qualityChoices.has('adv-digger')
  const hasAdvFlight = qualityChoices.has('adv-flight')
  const hasAdvWallclimber = qualityChoices.has('adv-wallclimber')
  const hasAdvJumper = qualityChoices.has('adv-jumper')

  // RAM bonus for advanced mobility
  const ramBonus = digimon.baseStats.armor || 0

  const movements: { type: string; speed: number }[] = [
    { type: 'Walk', speed: baseMove },
    // Jump: half movement by default, full with Jumper quality
    { type: 'Jump', speed: hasJumper ? (hasAdvJumper ? baseMove + ramBonus : baseMove) : halfMove },
    // Swim: half movement by default, full with Swimmer quality
    { type: 'Swim', speed: hasSwimmer ? (hasAdvSwimmer ? baseMove + ramBonus : baseMove) : halfMove },
  ]

  // Add special movement types from qualities
  if (hasDigger) {
    movements.push({ type: 'Burrow', speed: hasAdvDigger ? baseMove + ramBonus : baseMove })
  }
  if (hasFlight) {
    movements.push({ type: 'Fly', speed: hasAdvFlight ? baseMove + ramBonus : baseMove })
  }
  if (hasWallclimber) {
    movements.push({ type: 'Climb', speed: hasAdvWallclimber ? baseMove + ramBonus : baseMove })
  }

  return movements
}
</script>

<template>
  <div class="min-h-screen bg-digimon-dark-900">
    <!-- Render child route (create/edit Digimon) -->
    <NuxtPage v-if="isChildRoute" />

    <!-- Dashboard content (only when not on child route) -->
    <template v-else>
    <!-- Header -->
    <header class="bg-digimon-dark-800 border-b border-digimon-dark-700 sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-gradient-to-br from-digimon-orange-500 to-digimon-orange-700 rounded-lg flex items-center justify-center">
              <span class="text-white font-display font-bold text-sm">D</span>
            </div>
            <span class="font-display text-white font-semibold">Player View</span>
          </div>
          <div class="flex items-center gap-4">
            <ClientOnly>
              <span class="text-xs text-digimon-dark-400">
                Last updated: {{ lastRefresh.toLocaleTimeString() }}
              </span>
            </ClientOnly>
            <button
              class="text-sm text-digimon-dark-400 hover:text-white"
              @click="loadData"
            >
              Refresh
            </button>
            <button
              class="text-sm text-digimon-dark-400 hover:text-white"
              @click="switchCharacter"
            >
              Switch
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-6">
      <div v-if="loading && !tamer" class="text-center py-12">
        <div class="text-digimon-dark-400">Loading your character...</div>
      </div>

      <div v-else-if="!tamer" class="text-center py-12">
        <div class="text-6xl mb-4">❌</div>
        <h2 class="text-xl font-semibold text-white mb-2">Character Not Found</h2>
        <button
          class="text-digimon-orange-400 hover:text-digimon-orange-300"
          @click="switchCharacter"
        >
          Select a different character
        </button>
      </div>

      <template v-else>
        <!-- Active Combat Alert -->
        <div v-if="activeEncounter" :class="[
          'mb-6 rounded-xl p-4 border-2',
          isMyTurn
            ? 'bg-digimon-orange-500/20 border-digimon-orange-500 animate-pulse'
            : 'bg-red-900/20 border-red-500/50'
        ]">
          <div class="flex items-center justify-between">
            <div>
              <h2 :class="['font-display text-lg font-semibold', isMyTurn ? 'text-digimon-orange-400' : 'text-red-400']">
                {{ isMyTurn ? "⚔️ IT'S YOUR TURN!" : '⚔️ Combat Active' }}
              </h2>
              <p class="text-digimon-dark-300 text-sm">
                {{ activeEncounter.name }} • Round {{ activeEncounter.round }}
              </p>
            </div>
            <div v-if="!isMyTurn && currentTurnParticipant" class="text-right">
              <div class="text-sm text-digimon-dark-400">Current Turn:</div>
              <div class="text-white font-semibold">
                {{ getParticipantName(currentTurnParticipant) }}
              </div>
            </div>
          </div>

          <!-- My participants in combat -->
          <div v-if="myParticipants.length > 0" class="mt-4 grid gap-3">
            <div
              v-for="participant in myParticipants"
              :key="participant.id"
              :class="[
                'bg-digimon-dark-800 rounded-lg p-3',
                participant.isActive && 'ring-2 ring-digimon-orange-500'
              ]"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-white">{{ getParticipantName(participant) }}</span>
                <span :class="[
                  'text-xs px-2 py-0.5 rounded capitalize',
                  participant.currentStance === 'offensive' && 'bg-red-900/50 text-red-400',
                  participant.currentStance === 'defensive' && 'bg-blue-900/50 text-blue-400',
                  participant.currentStance === 'neutral' && 'bg-gray-700 text-gray-300',
                  participant.currentStance === 'sniper' && 'bg-purple-900/50 text-purple-400',
                  participant.currentStance === 'brave' && 'bg-yellow-900/50 text-yellow-400',
                ]">
                  {{ participant.currentStance }}
                </span>
              </div>

              <!-- Health bar -->
              <div class="mb-2">
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-digimon-dark-400">HP:</span>
                  <div class="flex-1 h-2 bg-digimon-dark-600 rounded-full overflow-hidden">
                    <div
                      class="h-full transition-all duration-300"
                      :class="[
                        participant.currentWounds === 0 ? 'bg-green-500' :
                        participant.currentWounds < participant.maxWounds / 2 ? 'bg-yellow-500' :
                        participant.currentWounds < participant.maxWounds ? 'bg-orange-500' : 'bg-red-500'
                      ]"
                      :style="{ width: `${((participant.maxWounds - participant.currentWounds) / participant.maxWounds) * 100}%` }"
                    />
                  </div>
                  <span class="text-digimon-dark-300">{{ participant.maxWounds - participant.currentWounds }}/{{ participant.maxWounds }}</span>
                </div>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-2 text-xs">
                <span class="text-digimon-dark-400">Actions:</span>
                <div class="flex gap-0.5">
                  <div v-for="i in 2" :key="i" :class="['w-3 h-3 rounded', i <= participant.actionsRemaining.simple ? 'bg-blue-500' : 'bg-digimon-dark-600']" />
                </div>
                <span class="text-digimon-dark-400 ml-1">
                  ({{ participant.actionsRemaining.simple }}/2)
                </span>
              </div>

              <!-- Effects -->
              <div v-if="participant.activeEffects.length > 0" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="effect in participant.activeEffects"
                  :key="effect.id"
                  :class="[
                    'text-xs px-1.5 py-0.5 rounded',
                    effect.type === 'buff' && 'bg-green-900/30 text-green-400',
                    effect.type === 'debuff' && 'bg-red-900/30 text-red-400',
                    effect.type === 'status' && 'bg-yellow-900/30 text-yellow-400',
                  ]"
                >
                  {{ effect.name }}
                </span>
              </div>

              <!-- Combat Actions (when it's this participant's turn) -->
              <div v-if="canParticipantAct(participant) && isMyTurn" class="mt-3 pt-3 border-t border-digimon-dark-600">
                <div class="flex flex-wrap gap-2 mb-3">
                  <!-- Movement -->
                  <button
                    :disabled="participant.actionsRemaining.simple < 1"
                    class="text-xs px-2 py-1 rounded bg-teal-900/50 text-teal-400 hover:bg-teal-900/80 disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="usePlayerAction(participant, 'movement')"
                  >
                    Move (1)
                  </button>
                  <!-- Tamer Direct Actions -->
                  <template v-if="participant.type === 'tamer'">
                    <button
                      :disabled="participant.actionsRemaining.simple < 1 || participant.hasDirectedThisTurn"
                      class="text-xs px-2 py-1 rounded bg-amber-900/50 text-amber-400 hover:bg-amber-900/80 disabled:opacity-50 disabled:cursor-not-allowed"
                      @click="openPlayerDirectTargetSelector(false)"
                    >
                      Direct (1){{ participant.hasDirectedThisTurn ? ' - Used' : '' }}
                    </button>
                    <button
                      :disabled="participant.actionsRemaining.simple < 2 || participant.hasDirectedThisTurn"
                      class="text-xs px-2 py-1 rounded bg-amber-900/50 text-amber-400 hover:bg-amber-900/80 disabled:opacity-50 disabled:cursor-not-allowed"
                      @click="openPlayerDirectTargetSelector(true)"
                    >
                      Bolster Direct (2){{ participant.hasDirectedThisTurn ? ' - Used' : '' }}
                    </button>
                  </template>
                </div>
                <!-- Stance Selector -->
                <div class="mb-3">
                  <label class="block text-xs text-digimon-dark-400 mb-1">Stance (1 Simple)</label>
                  <div class="flex flex-wrap gap-1">
                    <button
                      v-for="stance in (['neutral', 'defensive', 'offensive', 'sniper', 'brave'] as const)"
                      :key="stance"
                      :disabled="participant.actionsRemaining.simple < 1 && participant.currentStance !== stance"
                      :class="[
                        'text-xs px-2 py-1 rounded capitalize transition-colors',
                        participant.currentStance === stance
                          ? 'ring-1 ring-white text-white ' + (stance === 'offensive' ? 'bg-red-700' : stance === 'defensive' ? 'bg-blue-700' : stance === 'sniper' ? 'bg-purple-700' : stance === 'brave' ? 'bg-yellow-700' : 'bg-gray-600')
                          : participant.actionsRemaining.simple < 1
                            ? 'bg-digimon-dark-700 text-digimon-dark-500 opacity-50 cursor-not-allowed'
                            : 'bg-digimon-dark-700 text-digimon-dark-300 hover:bg-digimon-dark-600'
                      ]"
                      @click="changePlayerStance(participant, stance)"
                    >
                      {{ stance }}
                    </button>
                  </div>
                </div>

                <!-- Special Orders (Tamer Only) -->
                <div v-if="participant.type === 'tamer' && getTamerSpecialOrders(participant).length > 0" class="mb-3">
                  <label class="block text-xs text-digimon-dark-400 mb-2 font-semibold">✨ Special Orders</label>
                  <div class="space-y-2">
                    <button
                      v-for="order in getTamerSpecialOrders(participant)"
                      :key="order.name"
                      :disabled="!canUseSpecialOrderInCombat(participant, order)"
                      @click="
                        order.name === 'Enemy Scan'
                          ? (showPlayerSpecialOrdersModal = true)
                          : handleUseSpecialOrder(participant, order.name)
                      "
                      :class="[
                        'w-full text-left text-xs px-3 py-2 rounded transition-colors',
                        !canUseSpecialOrderInCombat(participant, order)
                          ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed opacity-50'
                          : 'bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-300 cursor-pointer'
                      ]"
                    >
                      <div class="flex items-center justify-between">
                        <span class="font-medium">{{ order.name }}</span>
                        <span class="text-digimon-dark-400 text-xs">
                          {{ getOrderActionCost(order.type) === 0 ? 'Free' : getOrderActionCost(order.type) === 1 ? '1' : '2' }}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Enemy Scan Target Modal (Player) -->
              <Teleport to="body">
                <div v-if="showPlayerSpecialOrdersModal && participant.type === 'tamer'" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showPlayerSpecialOrdersModal = false">
                  <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-600 max-w-md w-full mx-4">
                    <h3 class="text-lg font-semibold text-white mb-4">Enemy Scan - Select Target</h3>
                    <div class="space-y-2 max-h-60 overflow-y-auto">
                      <button
                        v-for="p in (activeEncounter?.participants as CombatParticipant[] || []).filter(p => p.id !== participant.id && p.type !== 'gm')"
                        :key="p.id"
                        class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-3 py-2 rounded text-sm text-left"
                        @click="handleUseSpecialOrder(participant, 'Enemy Scan', p.id); showPlayerSpecialOrdersModal = false"
                      >
                        {{ getEntityName(p) }}
                        <span class="text-digimon-dark-400 text-xs ml-2">({{ p.currentWounds }}/{{ p.maxWounds }} wounds)</span>
                      </button>
                    </div>
                    <button class="mt-4 text-sm text-digimon-dark-400 hover:text-white" @click="showPlayerSpecialOrdersModal = false">Cancel</button>
                  </div>
                </div>
              </Teleport>

              <!-- Digivolve / Devolve (digimon with evolution line) -->
              <div
                v-if="participant.type === 'digimon' && participant.evolutionLineId && canParticipantAct(participant) && isMyTurn"
                class="mb-2 flex flex-wrap gap-1"
              >
                <button
                  v-for="target in getParticipantEvolutionOptions(participant).evolveTargets"
                  :key="`evo-${target.chainIndex}`"
                  :disabled="(myTamerParticipant?.actionsRemaining?.simple || 0) < 1 || myTamerParticipant?.hasAttemptedDigivolve"
                  :class="[
                    'text-xs px-2 py-1 rounded font-medium',
                    (myTamerParticipant?.actionsRemaining?.simple || 0) >= 1 && !myTamerParticipant?.hasAttemptedDigivolve
                      ? 'bg-green-700 hover:bg-green-600 text-white'
                      : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                  ]"
                  @click="handleDigivolve(participant, target.chainIndex)"
                >
                  {{ myTamerParticipant?.hasAttemptedDigivolve ? 'Digivolve attempted' : `Digivolve → ${target.species}` }}
                </button>
                <button
                  v-if="getParticipantEvolutionOptions(participant).canDevolve"
                  :disabled="(myTamerParticipant?.actionsRemaining?.simple || 0) < 1"
                  :class="[
                    'text-xs px-2 py-1 rounded font-medium',
                    (myTamerParticipant?.actionsRemaining?.simple || 0) >= 1
                      ? 'bg-amber-700 hover:bg-amber-600 text-white'
                      : 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed'
                  ]"
                  @click="handleDigivolve(participant, getParticipantEvolutionOptions(participant).devolveTarget.chainIndex)"
                >
                  Devolve → {{ getParticipantEvolutionOptions(participant).devolveTarget?.species }}
                </button>
              </div>

              <!-- Attacks (when it's this participant's turn) -->
              <div v-if="canParticipantAct(participant) && isMyTurn && participant.type === 'digimon'" class="mt-4 pt-4 border-t border-digimon-dark-600">
                <h4 class="font-semibold text-digimon-orange-400 text-sm mb-3">⚔️ Select Attack</h4>

                <div v-if="getParticipantAttacks(participant).length === 0" class="text-sm text-digimon-dark-400">
                  No attacks available
                </div>

                <div v-else class="space-y-2">
                  <button
                    v-for="attack in getParticipantAttacks(participant)"
                    :key="attack.id"
                    :disabled="!canUseAttack(participant, attack)"
                    @click="selectAttackAndShowTargets(participant, attack)"
                    :class="[
                      'w-full text-left bg-digimon-dark-700 rounded-lg p-2 transition-colors',
                      canUseAttack(participant, attack)
                        ? 'hover:bg-digimon-dark-600 cursor-pointer'
                        : 'opacity-50 cursor-not-allowed'
                    ]"
                  >
                    <div class="flex justify-between items-start gap-2">
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold text-white text-sm">{{ attack.name }}</div>
                        <div class="flex flex-wrap gap-1 mt-1">
                          <span
                            :class="[
                              'text-xs px-1.5 py-0.5 rounded',
                              attack.range === 'melee' ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'
                            ]"
                          >
                            {{ attack.range }}
                          </span>
                          <span
                            :class="[
                              'text-xs px-1.5 py-0.5 rounded',
                              attack.effect ? 'bg-green-900/50 text-green-400' : 'bg-orange-900/50 text-orange-400'
                            ]"
                          >
                            {{ attack.effect || 'Damage' }}
                          </span>
                          <span v-for="note in getAttackStats(participant, attack).notes" :key="note" class="text-xs px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400">
                            {{ note }}
                          </span>
                        </div>
                      </div>
                      <div class="text-right flex-shrink-0">
                        <div class="text-cyan-400 text-sm font-semibold">
                          {{ getAttackStats(participant, attack).accuracy }}d6
                          <span v-if="getAttackStats(participant, attack).accuracyBonus > 0" class="text-green-400 text-xs">
                            (+{{ getAttackStats(participant, attack).accuracyBonus }})
                          </span>
                          <span v-else-if="getAttackStats(participant, attack).accuracyBonus < 0" class="text-red-400 text-xs">
                            ({{ getAttackStats(participant, attack).accuracyBonus }})
                          </span>
                        </div>
                        <div v-if="attack.type === 'damage'" class="text-orange-400 text-sm font-semibold mt-0.5">
                          DMG: {{ getAttackStats(participant, attack).damage }}
                          <span v-if="getAttackStats(participant, attack).damageBonus > 0" class="text-green-400 text-xs">
                            (+{{ getAttackStats(participant, attack).damageBonus }})
                          </span>
                          <span v-else-if="getAttackStats(participant, attack).damageBonus < 0" class="text-red-400 text-xs">
                            ({{ getAttackStats(participant, attack).damageBonus }})
                          </span>
                        </div>
                        <div v-if="getAttackStats(participant, attack).attackRange != null" class="text-digimon-dark-400 text-xs mt-0.5">
                          Range: {{ getAttackStats(participant, attack).attackRange }}m<template v-if="getAttackStats(participant, attack).attackEffectiveLimit != null"> | Limit: {{ getAttackStats(participant, attack).attackEffectiveLimit }}m</template>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Turn Tracker (Redesigned) -->
        <div v-if="activeEncounter && myParticipants.length > 0" class="mb-8">
          <h3 class="text-lg font-display font-semibold text-white mb-3">Turn Order</h3>

          <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
            <!-- Layout when it's NOT player's turn (original) -->
            <div v-if="!isMyTurn" class="flex items-center justify-between px-2 sm:px-4 md:px-6 lg:px-8 py-4">

              <!-- Current Turn Participant -->
              <div class="flex flex-col items-center">
                <div class="w-12 h-12 rounded-lg bg-digimon-dark-700 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="currentTurnParticipant && getParticipantImage(currentTurnParticipant)"
                    :src="getParticipantImage(currentTurnParticipant)"
                    alt="Current"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-2xl">{{ currentTurnParticipant?.type === 'digimon' ? '🦖' : '👤' }}</span>
                </div>
                <span class="text-xs mt-1 font-semibold text-center text-digimon-dark-400">
                  Current
                </span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Turns Until First Player Turn -->
              <div class="flex flex-col items-center">
                <div class="w-10 h-10 rounded-full bg-digimon-dark-700 flex items-center justify-center">
                  <span class="text-white font-bold text-sm">{{ turnsUntilFirstPlayerTurn }}</span>
                </div>
                <span class="text-xs text-digimon-dark-400 mt-1">Turns</span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- First Player Turn (YOUR NEXT TURN) -->
              <div class="flex flex-col items-center">
                <div class="w-14 h-14 rounded-lg bg-digimon-orange-600 border-2 border-digimon-orange-500 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="tamer?.spriteUrl"
                    :src="tamer.spriteUrl"
                    alt="Your next turn"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-3xl">⚔️</span>
                </div>
                <span class="text-xs text-digimon-orange-400 mt-1 font-semibold text-center">
                  YOUR NEXT TURN
                </span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Turns Until Player Turn Again (full cycle) -->
              <div class="flex flex-col items-center">
                <div class="w-10 h-10 rounded-full bg-digimon-dark-700 flex items-center justify-center">
                  <span class="text-white font-bold text-sm">{{ turnCycleLength }}</span>
                </div>
                <span class="text-xs text-digimon-dark-400 mt-1">Turns</span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Player's Next Turn -->
              <div class="flex flex-col items-center">
                <div class="w-12 h-12 rounded-lg bg-digimon-orange-600 border-2 border-digimon-orange-500 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="tamer?.spriteUrl"
                    :src="tamer.spriteUrl"
                    alt="Your next turn"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-2xl">⚔️</span>
                </div>
                <span class="text-xs text-digimon-orange-400 mt-1 font-semibold text-center">
                  YOUR NEXT TURN
                </span>
              </div>

            </div>

            <!-- Layout when it's player's turn (simplified) -->
            <div v-else class="flex items-center justify-between px-2 sm:px-4 md:px-6 lg:px-8 py-4">

              <!-- Current Turn (YOUR TURN) -->
              <div class="flex flex-col items-center">
                <div class="w-14 h-14 rounded-lg bg-digimon-orange-500 border-2 border-digimon-orange-400 animate-pulse flex items-center justify-center overflow-hidden">
                  <img
                    v-if="tamer?.spriteUrl"
                    :src="tamer.spriteUrl"
                    alt="Your turn"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-3xl">⚔️</span>
                </div>
                <span class="text-xs text-digimon-orange-400 mt-1 font-semibold text-center">
                  YOUR TURN
                </span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Turns Until Next Player Turn (full cycle) -->
              <div class="flex flex-col items-center">
                <div class="w-10 h-10 rounded-full bg-digimon-dark-700 flex items-center justify-center">
                  <span class="text-white font-bold text-sm">{{ turnCycleLength }}</span>
                </div>
                <span class="text-xs text-digimon-dark-400 mt-1">Turns</span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Next Player Turn -->
              <div class="flex flex-col items-center">
                <div class="w-12 h-12 rounded-lg bg-digimon-orange-600 border-2 border-digimon-orange-500 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="tamer?.spriteUrl"
                    :src="tamer.spriteUrl"
                    alt="Your next turn"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-2xl">⚔️</span>
                </div>
                <span class="text-xs text-digimon-orange-400 mt-1 font-semibold text-center">
                  YOUR NEXT TURN
                </span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Turns Until Second Next Player Turn (full cycle) -->
              <div class="flex flex-col items-center">
                <div class="w-10 h-10 rounded-full bg-digimon-dark-700 flex items-center justify-center">
                  <span class="text-white font-bold text-sm">{{ turnCycleLength }}</span>
                </div>
                <span class="text-xs text-digimon-dark-400 mt-1">Turns</span>
              </div>

              <!-- Arrow -->
              <span class="text-digimon-dark-500 text-xl">→</span>

              <!-- Second Next Player Turn -->
              <div class="flex flex-col items-center">
                <div class="w-12 h-12 rounded-lg bg-digimon-orange-600 border-2 border-digimon-orange-500 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="tamer?.spriteUrl"
                    :src="tamer.spriteUrl"
                    alt="Your next turn"
                    class="w-full h-full object-cover"
                  />
                  <span v-else class="text-2xl">⚔️</span>
                </div>
                <span class="text-xs text-digimon-orange-400 mt-1 font-semibold text-center">
                  YOUR NEXT TURN
                </span>
              </div>

            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Main Column -->
          <div class="lg:col-span-2 space-y-6">
            <!-- Tamer Card -->
            <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
              <div class="flex items-start gap-4 mb-4">
                <div class="w-20 h-20 bg-digimon-dark-700 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    v-if="tamer.spriteUrl"
                    :src="tamer.spriteUrl"
                    :alt="tamer.name"
                    class="w-full h-full object-cover"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                  <span v-else class="text-4xl">👤</span>
                </div>
                <div>
                  <div class="flex items-center gap-3">
                    <h1 class="font-display text-2xl font-bold text-white">{{ tamer.name }}</h1>
                    <NuxtLink
                      :to="`/player/${tamerId}/edit`"
                      class="text-digimon-orange-400 hover:text-digimon-orange-300 transition-colors text-sm"
                    >
                      Edit
                    </NuxtLink>
                  </div>
                  <p class="text-digimon-dark-400">Age {{ tamer.age }} • {{ tamer.campaignLevel }} campaign</p>
                  <div class="flex gap-4 mt-2 text-sm">
                    <span class="text-digimon-dark-300">
                      <span class="text-digimon-dark-400">Wounds:</span>
                      {{ tamer.currentWounds }}/{{ tamerStats?.woundBoxes }}
                    </span>
                    <span class="text-digimon-dark-300">
                      <span class="text-digimon-dark-400">Inspiration:</span>
                      {{ tamer.inspiration }}/{{ tamerStats?.maxInspiration }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Attributes -->
              <div class="grid grid-cols-5 gap-2 mb-4">
                <div
                  v-for="(value, attr) in tamer.attributes"
                  :key="attr"
                  :class="[
                    'relative group text-center bg-digimon-dark-700 rounded-lg p-2 cursor-help',
                    tamer.xpBonuses?.attributes[attr as keyof typeof tamer.xpBonuses.attributes] > 0 && 'ring-2 ring-green-500/50'
                  ]"
                >
                  <div class="text-xs text-digimon-dark-400 uppercase">{{ attr }}</div>
                  <div class="text-lg font-semibold text-white">{{ totalAttributes[attr as keyof typeof totalAttributes] }}</div>

                  <!-- Skill hover box -->
                  <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div class="bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg p-2 shadow-lg whitespace-nowrap">
                      <div
                        v-for="skill in skillsByAttribute[attr as keyof typeof skillsByAttribute]"
                        :key="skill"
                        class="text-sm flex justify-between gap-3"
                      >
                        <span class="text-digimon-dark-400">{{ skillLabels[skill] }}:</span>
                        <span class="text-white font-medium">
                          {{ totalSkills[skill as keyof typeof totalSkills] }}
                          <span
                            v-if="tamer.xpBonuses?.skills[skill as keyof typeof tamer.xpBonuses.skills] > 0"
                            class="inline-block w-1.5 h-1.5 bg-green-500 rounded-full ml-1"
                            title="XP Enhanced"
                          ></span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Derived Stats -->
              <div class="flex flex-wrap gap-4 text-sm">
                <span><span class="text-digimon-dark-400">Speed:</span> <span class="text-white">{{ tamerStats?.speed }}</span></span>
                <span><span class="text-digimon-dark-400">Accuracy:</span> <span class="text-white">{{ tamerStats?.accuracyPool }}</span></span>
                <span><span class="text-digimon-dark-400">Dodge:</span> <span class="text-white">{{ tamerStats?.dodgePool }}</span></span>
                <span><span class="text-digimon-dark-400">Damage:</span> <span class="text-white">{{ tamerStats?.damage }}</span></span>
                <span><span class="text-digimon-dark-400">Armor:</span> <span class="text-white">{{ tamerStats?.armor }}</span></span>
              </div>

              <!-- Torments -->
              <div v-if="tamer.torments && tamer.torments.length > 0" class="mt-4 pt-4 border-t border-digimon-dark-700">
                <h3 class="text-sm font-semibold text-digimon-dark-400 mb-3">Torments</h3>
                <div class="space-y-3">
                  <div
                    v-for="torment in tamer.torments"
                    :key="torment.id"
                    class="bg-digimon-dark-700 rounded-lg p-3"
                  >
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-medium text-white">{{ torment.name }}</span>
                      <span :class="[
                        'text-xs px-2 py-0.5 rounded capitalize',
                        torment.severity === 'minor' && 'bg-yellow-900/30 text-yellow-400',
                        torment.severity === 'major' && 'bg-orange-900/30 text-orange-400',
                        torment.severity === 'terrible' && 'bg-red-900/30 text-red-400',
                      ]">
                        {{ torment.severity }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <div class="flex gap-1">
                        <div
                          v-for="i in torment.totalBoxes"
                          :key="i"
                          :class="[
                            'w-4 h-4 rounded border-2',
                            i <= torment.markedBoxes
                              ? 'bg-green-500 border-green-400'
                              : 'bg-digimon-dark-600 border-digimon-dark-500'
                          ]"
                        />
                      </div>
                      <span class="text-xs text-digimon-dark-400 ml-2">
                        {{ torment.markedBoxes }}/{{ torment.totalBoxes }}
                        <span v-if="torment.markedBoxes < torment.totalBoxes" class="text-yellow-400">
                          (Roll: -{{ torment.totalBoxes - torment.markedBoxes }})
                        </span>
                        <span v-else class="text-green-400">(Overcome!)</span>
                      </span>
                    </div>
                    <p v-if="torment.description" class="text-xs text-digimon-dark-400 mt-2 italic">
                      {{ torment.description }}
                    </p>
                  </div>
                </div>
                <p class="text-xs text-digimon-dark-500 mt-2">
                  Roll: 3d6 + Willpower ({{ tamer.attributes.willpower }}) - unmarked boxes vs TN 12
                </p>
              </div>
            </div>

            <!-- Special Orders -->
            <div v-if="specialOrders.length > 0" class="mt-4 pt-4 border-t border-digimon-dark-700">
              <h3 class="text-sm font-semibold text-digimon-dark-400 mb-3">Special Orders</h3>
              <div class="space-y-2">
                <div
                  v-for="order in specialOrders"
                  :key="order.name"
                  class="bg-digimon-dark-700 rounded-lg p-3"
                >
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-white">{{ order.name }}</span>
                    <span class="text-xs px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-300">
                      {{ getOrderUsageLimit(order.type) === 'passive' ? 'Passive' : getOrderUsageLimit(order.type) === 'per-day' ? 'Once/Day' : 'Once/Battle' }}
                    </span>
                  </div>
                  <p class="text-xs text-digimon-dark-400 mb-1">{{ order.effect }}</p>
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-digimon-dark-400">{{ order.attribute.charAt(0).toUpperCase() + order.attribute.slice(1) }}</span>
                    <span v-if="getOrderUsageLimit(order.type) !== 'passive'" class="text-digimon-dark-400">
                      {{ getOrderActionCost(order.type) === 0 ? 'Free' : getOrderActionCost(order.type) === 1 ? '1 Action' : '2 Actions' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Partner Digimon Header -->
            <div class="flex items-center justify-between">
              <h2 class="font-display text-xl font-semibold text-white">Partner Digimon</h2>
              <NuxtLink
                :to="`/player/${tamerId}/digimon/new`"
                class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
                       font-semibold transition-colors text-sm"
              >
                + Create Digimon
              </NuxtLink>
            </div>

            <!-- Partner Digimon (grouped by evolution chain) -->
            <div v-for="chain in digimonChains" :key="chain.chainId" class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
              <template v-if="getCurrentForm(chain.chainId)">
                <div class="flex items-start gap-4 mb-4">
                  <!-- Evolution navigation buttons (left) -->
                  <div v-if="hasMultipleForms(chain.chainId)" class="flex flex-col justify-center h-20">
                    <button
                      :disabled="!canDeEvolve(chain.chainId)"
                      class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                      :class="canDeEvolve(chain.chainId)
                        ? 'bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white'
                        : 'bg-digimon-dark-800 text-digimon-dark-600 cursor-not-allowed'"
                      title="De-evolve to previous form"
                      @click="deEvolve(chain.chainId)"
                    >
                      ◀
                    </button>
                  </div>

                  <div class="w-20 h-20 bg-digimon-dark-700 rounded-lg flex items-center justify-center text-4xl shrink-0 overflow-hidden">
                    <img
                      v-if="getCurrentForm(chain.chainId)!.spriteUrl"
                      :src="getCurrentForm(chain.chainId)!.spriteUrl!"
                      :alt="getCurrentForm(chain.chainId)!.name"
                      class="max-w-full max-h-full object-contain"
                    />
                    <span v-else>🦖</span>
                  </div>
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <h2 class="font-display text-xl font-semibold text-white">{{ getCurrentForm(chain.chainId)!.name }}</h2>
                      <span :class="['text-sm capitalize', getStageColor(getCurrentForm(chain.chainId)!.stage as DigimonStage)]">
                        {{ getCurrentForm(chain.chainId)!.stage }}
                      </span>
                    </div>
                    <div class="flex items-center gap-3 text-sm">
                      <p class="text-digimon-dark-400">{{ getCurrentForm(chain.chainId)!.species }} • {{ getCurrentForm(chain.chainId)!.attribute }}</p>
                      <NuxtLink
                        :to="`/player/${tamerId}/digimon/${getCurrentForm(chain.chainId)!.id}`"
                        class="text-digimon-orange-400 hover:text-digimon-orange-300 transition-colors"
                      >
                        Edit
                      </NuxtLink>
                    </div>

                    <!-- Health -->
                    <div class="mt-2">
                      <div class="flex items-center gap-2 text-sm">
                        <span class="text-digimon-dark-400">Wounds:</span>
                        <div class="flex-1 max-w-32 h-2 bg-digimon-dark-600 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-green-500 transition-all"
                            :style="{ width: `${((calcDigimonStats(getCurrentForm(chain.chainId)!).woundBoxes - getCurrentForm(chain.chainId)!.currentWounds) / calcDigimonStats(getCurrentForm(chain.chainId)!).woundBoxes) * 100}%` }"
                          />
                        </div>
                        <span class="text-digimon-dark-300">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).woundBoxes - getCurrentForm(chain.chainId)!.currentWounds }}/{{ calcDigimonStats(getCurrentForm(chain.chainId)!).woundBoxes }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Evolution navigation buttons (right) -->
                  <div v-if="hasMultipleForms(chain.chainId)" class="flex flex-col justify-center h-20 relative">
                    <button
                      :disabled="!canEvolveForm(chain.chainId)"
                      class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                      :class="canEvolveForm(chain.chainId)
                        ? 'bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white'
                        : 'bg-digimon-dark-800 text-digimon-dark-600 cursor-not-allowed'"
                      :title="hasMultipleEvolutions(chain.chainId) ? 'Choose evolution' : 'Evolve to next form'"
                      @click="evolveForm(chain.chainId)"
                    >
                      <span v-if="hasMultipleEvolutions(chain.chainId)">▼</span>
                      <span v-else>▶</span>
                    </button>

                    <!-- Evolution picker dropdown for branching paths -->
                    <div
                      v-if="showEvolutionPicker === chain.chainId"
                      class="absolute right-0 top-full mt-1 z-20 bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg shadow-lg min-w-48"
                    >
                      <div class="p-2 text-xs text-digimon-dark-400 border-b border-digimon-dark-600">
                        Choose evolution:
                      </div>
                      <div class="p-1">
                        <button
                          v-for="option in getEvolutionOptions(chain.chainId)"
                          :key="option.id"
                          class="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-digimon-dark-700 transition-colors text-left"
                          @click="evolveForm(chain.chainId, option.id)"
                        >
                          <div class="w-8 h-8 bg-digimon-dark-700 rounded flex items-center justify-center text-sm shrink-0 overflow-hidden">
                            <img
                              v-if="option.spriteUrl"
                              :src="option.spriteUrl"
                              :alt="option.name"
                              class="max-w-full max-h-full object-contain"
                            />
                            <span v-else>🦖</span>
                          </div>
                          <div>
                            <div class="text-white text-sm font-medium">{{ option.name }}</div>
                            <div :class="['text-xs capitalize', getStageColor(option.stage as DigimonStage)]">
                              {{ option.stage }}
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              <!-- Stats -->
              <div class="grid grid-cols-5 gap-2 mb-4">
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">ACC</div>
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.accuracy + (getCurrentForm(chain.chainId)!.bonusStats?.accuracy || 0) }}</div>
                </div>
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">DMG</div>
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.damage + (getCurrentForm(chain.chainId)!.bonusStats?.damage || 0) }}</div>
                </div>
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">DOD</div>
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.dodge + (getCurrentForm(chain.chainId)!.bonusStats?.dodge || 0) }}</div>
                </div>
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">ARM</div>
                  <div class="text-lg font-semibold text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).armor }}</div>
                </div>
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">HP</div>
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.health + (getCurrentForm(chain.chainId)!.bonusStats?.health || 0) }}</div>
                </div>
              </div>

              <!-- Derived Stats -->
              <div class="flex flex-wrap gap-4 text-sm mb-4">
                <span><span class="text-digimon-dark-400">Brains:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).brains }}</span></span>
                <span><span class="text-digimon-dark-400">Body:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).body }}</span></span>
                <span><span class="text-digimon-dark-400">Agility:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).agility }}</span></span>
                <span><span class="text-digimon-dark-400">BIT:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).bit }}</span></span>
                <span><span class="text-digimon-dark-400">CPU:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).cpu }}</span></span>
                <span><span class="text-digimon-dark-400">RAM:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).ram }}</span></span>
                <span class="relative group">
                  <span class="text-digimon-dark-400">Move: </span>
                  <span class="text-white cursor-help border-b border-dotted border-digimon-dark-500">
                    {{ getMovementTypes(getCurrentForm(chain.chainId)!)[0].speed }}m
                  </span>
                  <!-- Hover tooltip with all movement types -->
                  <div class="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10">
                    <div class="bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg p-2 shadow-lg whitespace-nowrap">
                      <div v-for="move in getMovementTypes(getCurrentForm(chain.chainId)!)" :key="move.type" class="text-sm">
                        <span class="text-digimon-dark-400">{{ move.type }}:</span>
                        <span class="text-white ml-1">{{ move.speed }}m</span>
                      </div>
                    </div>
                  </div>
                </span>
              </div>

              <!-- Attacks -->
              <div v-if="getCurrentForm(chain.chainId)!.attacks && getCurrentForm(chain.chainId)!.attacks.length > 0">
                <h3 class="text-sm font-semibold text-digimon-dark-400 mb-2">Attacks</h3>
                <div class="space-y-2">
                  <div
                    v-for="attack in getCurrentForm(chain.chainId)!.attacks"
                    :key="attack.id"
                    class="bg-digimon-dark-700 rounded-lg p-3"
                  >
                    <div class="flex items-center justify-between flex-wrap gap-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-semibold text-white">{{ attack.name }}</span>
                        <span :class="[
                          'text-xs px-1.5 py-0.5 rounded',
                          attack.range === 'melee' ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'
                        ]">
                          [{{ attack.range === 'melee' ? 'Melee' : 'Ranged' }}]
                        </span>
                        <span :class="[
                          'text-xs px-1.5 py-0.5 rounded',
                          attack.type === 'damage' ? 'bg-orange-900/50 text-orange-400' : 'bg-green-900/50 text-green-400'
                        ]">
                          [{{ attack.type === 'damage' ? 'Damage' : 'Support' }}]
                        </span>
                      </div>
                      <!-- Attack Stats -->
                      <div class="flex items-center gap-3 text-sm">
                        <span class="text-cyan-400">
                          ACC: {{ getAttackAccuracy(getCurrentForm(chain.chainId)!, { range: attack.range, tags: attack.tags || [] }) }}d6
                        </span>
                        <span v-if="attack.type === 'damage'" class="text-orange-400">
                          DMG: {{ getAttackDamage(getCurrentForm(chain.chainId)!, { range: attack.range, tags: attack.tags || [] }) }}
                        </span>
                        <span class="text-digimon-dark-400">
                          Range: {{ getPerAttackRange(getCurrentForm(chain.chainId)!, attack.range).range }}m<template v-if="getPerAttackRange(getCurrentForm(chain.chainId)!, attack.range).effectiveLimit != null"> | Limit: {{ getPerAttackRange(getCurrentForm(chain.chainId)!, attack.range).effectiveLimit }}m</template>
                        </span>
                      </div>
                    </div>
                    <div v-if="attack.tags && attack.tags.length > 0" class="flex gap-1 mt-2 flex-wrap">
                      <span
                        v-for="tag in attack.tags"
                        :key="tag"
                        class="text-xs bg-digimon-dark-600 text-digimon-dark-300 px-2 py-0.5 rounded"
                      >
                        {{ tag }}
                      </span>
                    </div>
                    <div v-if="attack.effect" class="mt-1">
                      <span class="text-xs bg-purple-900/30 text-purple-400 px-2 py-0.5 rounded">
                        Effect: {{ attack.effect }}
                      </span>
                    </div>
                    <div v-if="attack.description" class="text-sm text-digimon-dark-400 mt-1 italic">
                      {{ attack.description }}
                    </div>
                  </div>
                </div>
              </div>
              </template>
            </div>

          </div>

          <!-- Sidebar -->
          <div class="space-y-4">
            <!-- Dice Roller -->
            <DiceRoller />

            <!-- Quick Reference -->
            <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
              <h3 class="font-display text-lg font-semibold text-white mb-3">Quick Reference</h3>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-digimon-dark-400">Simple Actions</span>
                  <span class="text-white">2 per turn</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-digimon-dark-400">Complex Actions</span>
                  <span class="text-white">1 per turn</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-digimon-dark-400">Movement</span>
                  <span class="text-white">= Simple Action</span>
                </div>
                <div class="border-t border-digimon-dark-600 my-2" />
                <div class="text-digimon-dark-400">
                  <strong class="text-white">Attack:</strong> 3d6 + Accuracy vs 3d6 + Dodge
                </div>
                <div class="text-digimon-dark-400">
                  <strong class="text-white">Damage:</strong> Net Successes + Damage + Stage Bonus - Armor
                </div>
              </div>
            </div>

            <!-- Notes -->
            <div v-if="tamer.notes" class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
              <h3 class="font-display text-lg font-semibold text-white mb-3">Notes</h3>
              <p class="text-digimon-dark-300 text-sm whitespace-pre-wrap">{{ tamer.notes }}</p>
            </div>
          </div>
        </div>
      </template>
    </main>
    </template>
  </div>

  <!-- Digimon Selection Modal -->
  <Teleport to="body">
    <div
      v-if="hasUnrespondedDigimonRequest"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-digimon-orange-500">
        <h2 class="font-display text-xl font-semibold text-digimon-orange-400 mb-4">
          GM Requests: Select Your Digimon
        </h2>

        <p class="text-white text-sm mb-4">Choose which Digimon you want to bring to combat:</p>

        <div class="space-y-2 mb-6 max-h-64 overflow-y-auto">
          <button
            v-for="digimon in currentPartnerDigimon"
            :key="digimon.id"
            @click="submitDigimonSelection(digimon.id)"
            :disabled="selectedDigimonId !== null"
            :class="[
              'w-full p-3 rounded-lg transition-all flex items-center gap-3 text-white',
              selectedDigimonId === digimon.id
                ? 'bg-green-600 cursor-default'
                : selectedDigimonId !== null
                  ? 'bg-digimon-dark-700 opacity-50 cursor-not-allowed'
                  : 'bg-digimon-dark-700 hover:bg-digimon-dark-600 cursor-pointer'
            ]"
          >
            <div class="w-12 h-12 bg-digimon-dark-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <img
                v-if="digimon.spriteUrl"
                :src="digimon.spriteUrl"
                :alt="digimon.name"
                class="max-w-full max-h-full object-contain"
              />
              <span v-else class="text-2xl">🦖</span>
            </div>
            <div class="text-left flex-1">
              <div class="font-semibold">{{ digimon.name }}</div>
              <div class="text-sm text-digimon-dark-400">{{ digimon.stage }}</div>
            </div>

            <!-- Success indicator checkmark -->
            <div v-if="selectedDigimonId === digimon.id" class="flex-shrink-0">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </button>

          <!-- None - Fight Solo (Tamer Only) Option -->
          <button
            @click="submitDigimonSelection(null)"
            :disabled="selectedDigimonId !== null && selectedDigimonId !== undefined"
            :class="[
              'w-full p-3 rounded-lg transition-all flex items-center justify-center gap-2 text-white border-2',
              selectedDigimonId === 'none'
                ? 'bg-green-600 border-green-500 cursor-default'
                : selectedDigimonId !== null && selectedDigimonId !== undefined
                  ? 'bg-digimon-dark-700 opacity-50 cursor-not-allowed border-digimon-dark-600'
                  : 'bg-digimon-dark-700 border-digimon-dark-600 hover:bg-digimon-dark-600 cursor-pointer'
            ]"
          >
            <span class="text-lg">👤</span>
            <span class="font-semibold">None - Fight Solo (Tamer Only)</span>

            <!-- Success indicator checkmark -->
            <div v-if="selectedDigimonId === 'none'" class="flex-shrink-0">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Initiative Request Modal -->
  <Teleport to="body">
    <div
      v-if="hasUnrespondedInitiativeRequest"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-digimon-orange-500">
        <h2 class="font-display text-xl font-semibold text-digimon-orange-400 mb-4">
          Roll for Initiative!
        </h2>

        <!-- Initiative Modifier Display -->
        <div class="bg-digimon-dark-700 rounded-lg p-3 mb-4 text-sm">
          <div class="text-digimon-dark-400 mb-2">Initiative Modifier:</div>
          <div class="space-y-1 text-xs">
            <div class="flex justify-between">
              <span class="text-digimon-dark-400">Digimon AGI:</span>
              <span class="text-white">+{{ initiativeModifierA }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-digimon-dark-400">Tamer AGI + Fight:</span>
              <span class="text-white">+{{ initiativeModifierB }}</span>
            </div>
            <div class="border-t border-digimon-dark-600 pt-1 mt-1 flex justify-between font-semibold">
              <span class="text-digimon-orange-400">Using:</span>
              <span class="text-digimon-orange-300">+{{ initiativeModifier }}</span>
            </div>
          </div>
        </div>

        <p class="text-white text-sm mb-4">
          Roll 3d6 + {{ initiativeModifier }}
        </p>

        <!-- Embedded Dice Roller -->
        <div class="mb-4">
          <div class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
            <div class="flex gap-2 items-center justify-center mb-4">
              <input
                type="number"
                :value="3"
                disabled
                class="w-12 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1 text-center text-white"
              />
              <span class="text-white">d</span>
              <input
                type="number"
                :value="6"
                disabled
                class="w-12 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1 text-center text-white"
              />
              <span class="text-white">+</span>
              <input
                type="number"
                :value="initiativeModifier"
                disabled
                class="w-12 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1 text-center text-white"
              />
            </div>

            <button
              :disabled="hasRolledInitiative"
              @click="initiativeRollResult = { rolls: [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1], total: 0 }; initiativeRollResult.total = initiativeRollResult.rolls.reduce((a, b) => a + b, 0); hasRolledInitiative = true"
              :class="[
                'w-full text-white px-4 py-2 rounded-lg font-semibold transition-colors',
                hasRolledInitiative ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' : 'bg-digimon-orange-500 hover:bg-digimon-orange-600'
              ]"
            >
              🎲 {{ hasRolledInitiative ? 'Already Rolled' : 'Roll' }}
            </button>
          </div>

          <div
            v-if="initiativeRollResult"
            class="bg-digimon-dark-700 rounded-lg p-4 mb-4 text-center"
          >
            <div class="text-sm text-digimon-dark-400 mb-2">Dice Roll</div>
            <div class="text-xl font-bold text-digimon-orange-400 mb-3">
              [{{ initiativeRollResult.rolls.join(', ') }}] = {{ initiativeRollResult.total }}
            </div>

            <div class="border-t border-digimon-dark-600 pt-3">
              <div class="text-sm text-digimon-dark-400">Your Total Initiative</div>
              <div class="text-3xl font-bold text-white">
                {{ initiativeRollResult.total + initiativeModifier }}
              </div>
              <div class="text-xs text-digimon-dark-400 mt-1">
                {{ initiativeRollResult.total }} (roll) + {{ initiativeModifier }} (modifier)
              </div>
            </div>
          </div>
        </div>

        <button
          :disabled="!initiativeRollResult"
          @click="submitInitiativeRoll"
          class="w-full bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
        >
          Submit Initiative
        </button>
      </div>
    </div>
  </Teleport>

  <!-- Dodge Request Modal -->
  <Teleport to="body">
    <div
      v-if="hasUnrespondedDodgeRequest"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-pulse"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-red-500">
        <h2 class="font-display text-xl font-semibold text-red-400 mb-4">
          ⚔️ Dodge Incoming Attack!
        </h2>

        <div v-if="currentDodgeRequest" class="mb-4 p-3 bg-red-900/20 rounded-lg">
          <p class="text-white text-sm">
            <span class="font-semibold">{{ currentDodgeRequest.data?.attackerName }}</span> attacks with
            <span class="font-semibold">{{ currentDodgeRequest.data?.attackName }}</span>!
          </p>
        </div>

        <p class="text-white text-sm mb-4">
          Roll {{ dodgeDicePool }}d6 — count 5+ as successes
          <span v-if="(currentDodgeRequest?.data?.dodgePenalty ?? 0) > 0" class="text-red-400 text-xs ml-1">
            (-{{ currentDodgeRequest.data.dodgePenalty }} successive attack penalty)
          </span>
        </p>

        <!-- Embedded Dice Roller -->
        <div class="mb-4">
          <div class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
            <div class="flex gap-2 items-center justify-center mb-4">
              <span class="text-white font-semibold">{{ dodgeDicePool }}d6</span>
              <span class="text-digimon-dark-400 text-sm">(5+ = success)</span>
            </div>

            <button
              :disabled="hasRolledDodge"
              @click="(() => { const rolls: number[] = []; for (let i = 0; i < dodgeDicePool; i++) rolls.push(Math.floor(Math.random() * 6) + 1); dodgeRollResult = { rolls, successes: rolls.filter(d => d >= 5).length, dicePool: dodgeDicePool }; hasRolledDodge = true; })()"
              :class="[
                'w-full text-white px-4 py-2 rounded-lg font-semibold transition-colors',
                hasRolledDodge ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
              ]"
            >
              🎲 {{ hasRolledDodge ? 'Already Rolled' : 'Roll Dodge' }}
            </button>
          </div>

          <div
            v-if="dodgeRollResult"
            class="bg-digimon-dark-700 rounded-lg p-4 mb-4 text-center"
          >
            <div class="text-sm text-digimon-dark-400 mb-2">Your Dodge Roll</div>
            <div class="flex justify-center gap-1 mb-2">
              <span
                v-for="(die, idx) in dodgeRollResult.rolls"
                :key="idx"
                :class="[
                  'w-8 h-8 flex items-center justify-center rounded font-bold text-sm',
                  die >= 5 ? 'bg-green-600 text-white' : 'bg-digimon-dark-600 text-digimon-dark-400'
                ]"
              >
                {{ die }}
              </span>
            </div>
            <div class="text-3xl font-bold text-blue-400">
              {{ dodgeRollResult.successes }} <span class="text-sm text-digimon-dark-400">successes</span>
            </div>
          </div>
        </div>

        <button
          :disabled="!dodgeRollResult"
          @click="submitDodgeRoll"
          class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
        >
          Submit Dodge
        </button>
      </div>
    </div>
  </Teleport>

  <!-- Intercede Offer Modal -->
  <Teleport to="body">
    <div
      v-if="hasIntercedeRequest && currentIntercedeRequest"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-yellow-500">
        <h2 class="font-display text-xl font-semibold text-yellow-400 mb-4">
          Intercede?
        </h2>

        <div class="mb-4 p-3 bg-yellow-900/20 rounded-lg">
          <p class="text-white text-sm">
            <span class="font-semibold">{{ currentIntercedeRequest.data?.attackerName }}</span>
            is attacking
            <span class="font-semibold">{{ currentIntercedeRequest.data?.targetName }}</span>!
          </p>
          <p class="text-yellow-300 text-xs mt-1">
            {{ currentIntercedeRequest.data?.accuracySuccesses }} accuracy successes
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
            v-for="option in intercedeOptions"
            :key="option.id"
            :disabled="intercedeLoading"
            @click="handleIntercedeClaim(option.id)"
            class="w-full bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {{ intercedeLoading ? 'Processing...' : `Intercede with ${option.name}` }}
          </button>
          <button
            :disabled="intercedeLoading"
            @click="handleIntercedeSkip"
            class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {{ intercedeLoading ? 'Processing...' : 'Skip' }}
          </button>
          <button
            :disabled="intercedeLoading"
            @click="handleIntercedeOptOut"
            class="w-full bg-red-800/50 hover:bg-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed text-red-300 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {{ intercedeLoading ? 'Processing...' : `Never intercede for ${currentIntercedeRequest.data?.targetName}` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Target Selection Modal -->
  <Teleport to="body">
    <div
      v-if="showTargetSelector && selectedAttack"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-digimon-orange-500">
        <h2 class="font-display text-xl font-semibold text-white mb-4">
          Select Target for {{ selectedAttack.attack.name }}
        </h2>

        <div v-if="getEnemyTargets().length === 0" class="text-white text-sm p-4 bg-digimon-dark-700 rounded-lg">
          No enemies to target
        </div>

        <div v-else class="space-y-2 mb-6 max-h-96 overflow-y-auto">
          <button
            v-for="target in getEnemyTargets()"
            :key="target.id"
            @click="selectedTargetId = target.id"
            class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white p-3 rounded-lg transition-colors text-left"
            :class="{
              'bg-digimon-orange-500/20 border-digimon-orange-500': selectedTargetId === target.id
            }"
          >
            <div class="flex justify-between items-center mb-2">
              <!-- Checkbox with tick -->
              <div class="w-5 h-5 rounded border border-digimon-dark-500 flex items-center justify-center shrink-0">
                <span v-if="selectedTargetId === target.id" class="text-digimon-orange-400">✓</span>
              </div>
              <span class="font-semibold ml-2">{{ getParticipantName(target) }}</span>
              <span v-if="target.currentStance" :class="[
                'text-xs px-2 py-1 rounded capitalize',
                target.currentStance === 'offensive' && 'bg-red-900/50 text-red-400',
                target.currentStance === 'defensive' && 'bg-blue-900/50 text-blue-400',
                target.currentStance === 'neutral' && 'bg-gray-700 text-gray-300',
                target.currentStance === 'sniper' && 'bg-purple-900/50 text-purple-400',
                target.currentStance === 'brave' && 'bg-yellow-900/50 text-yellow-400',
              ]">
                {{ target.currentStance }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <!-- Health bar -->
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
              <!-- Health percentage -->
              <span class="text-xs text-digimon-dark-400 whitespace-nowrap">
                {{ Math.round(getHealthPercentage(target)) }}%
              </span>
            </div>
          </button>
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
                (activeEncounter?.round || 0) - selectedAttack.participant.lastBitCpuBolsterRound < 2"
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
            @click="confirmAttack(getEnemyTargets().find(t => t.id === selectedTargetId))"
            :disabled="!selectedTargetId"
            class="flex-1 bg-digimon-orange-600 hover:bg-digimon-orange-700 disabled:bg-digimon-dark-600 disabled:text-digimon-dark-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {{ bolsterAttackEnabled ? 'Bolster ' : '' }}Attack{{ selectedAttack?.attack?.name ? ` with ${selectedAttack.attack.name}` : '' }}
          </button>
          <button
            @click="showTargetSelector = false; selectedAttack = null; selectedTargetId = null"
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Direct Target Selection Modal -->
  <Teleport to="body">
    <div
      v-if="showDirectTargetSelector"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      @click.self="showDirectTargetSelector = false"
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
            v-for="target in getPlayerDirectTargets()"
            :key="target.id"
            @click="confirmPlayerDirect(target)"
            class="w-full bg-digimon-dark-700 hover:bg-amber-900/30 rounded-lg p-3 border border-digimon-dark-600 hover:border-amber-500 transition-all text-left"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded bg-digimon-dark-600 flex items-center justify-center overflow-hidden">
                <img
                  v-if="getParticipantImage(target)"
                  :src="getParticipantImage(target)!"
                  :alt="getParticipantName(target) || 'target'"
                  class="max-w-full max-h-full object-contain"
                />
                <span v-else class="text-lg">?</span>
              </div>
              <div class="flex-1">
                <div class="font-semibold text-white text-sm">
                  {{ getParticipantName(target) || 'Unknown' }}
                </div>
              </div>
            </div>
          </button>

          <div v-if="getPlayerDirectTargets().length === 0" class="text-center text-digimon-dark-400 py-4">
            No digimon targets available.
          </div>
        </div>

        <button
          @click="showDirectTargetSelector = false"
          class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  </Teleport>

  <!-- Attack Result Modal -->
  <Teleport to="body">
    <div
      v-if="showAttackResultModal && attackResultData"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-2xl border-2 border-orange-500">
        <h2 class="text-2xl font-bold text-orange-500 mb-4">
          Attack Result: {{ attackResultData.attackName }}
        </h2>

        <!-- Target -->
        <div class="mb-4 text-digimon-dark-300">
          <span class="text-white">{{ attackResultData.attackerName }}</span>
          attacks
          <span class="text-red-400">{{ attackResultData.targetName }}</span>
        </div>

        <!-- Accuracy Roll -->
        <div class="mb-4 p-4 bg-digimon-dark-700 rounded-lg">
          <h3 class="text-lg font-semibold text-blue-400 mb-2">Your Accuracy Roll</h3>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-digimon-dark-400">Dice Pool:</span>
            <span class="text-white font-mono">{{ attackResultData.accuracyDicePool }}d6</span>
          </div>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-digimon-dark-400">Results:</span>
            <div class="flex gap-1">
              <span
                v-for="(die, i) in attackResultData.accuracyDiceResults"
                :key="i"
                :class="[
                  'px-2 py-1 rounded font-mono text-sm',
                  die >= 5 ? 'bg-green-600 text-white' : 'bg-digimon-dark-600 text-digimon-dark-300'
                ]"
              >
                {{ die }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-digimon-dark-400">Successes:</span>
            <span class="text-green-400 font-bold text-xl">{{ attackResultData.accuracySuccesses }}</span>
          </div>
        </div>

        <!-- Result -->
        <div class="mb-6 p-4 bg-digimon-dark-700 rounded-lg border-2" :class="[
          attackResultData.hit ? 'border-green-500' : 'border-red-500'
        ]">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-lg font-semibold" :class="[
              attackResultData.hit ? 'text-green-400' : 'text-red-400'
            ]">
              {{ attackResultData.hit ? 'HIT!' : 'MISS!' }}
            </h3>
            <div class="text-digimon-dark-400">
              Net Successes:
              <span :class="[
                attackResultData.netSuccesses >= 0 ? 'text-green-400' : 'text-red-400',
                'font-bold text-xl ml-2'
              ]">
                {{ attackResultData.netSuccesses >= 0 ? '+' : '' }}{{ attackResultData.netSuccesses }}
              </span>
            </div>
          </div>

          <!-- Damage Result (if hit) -->
          <div v-if="attackResultData.hit" class="mt-4 pt-4 border-t border-digimon-dark-600">
            <div class="flex items-center justify-between">
              <span class="text-orange-400 font-semibold text-lg">Damage Dealt:</span>
              <span class="text-red-400 font-bold text-3xl">{{ attackResultData.finalDamage }}</span>
            </div>
          </div>
        </div>

        <!-- Close Button -->
        <div class="flex justify-end">
          <button
            @click="closeAttackResultModal"
            class="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Dodge Result Modal (shown to the defender after submitting their dodge) -->
  <Teleport to="body">
    <div
      v-if="showDodgeResultModal && dodgeResultData"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-2xl border-2 border-blue-500">
        <h2 class="text-2xl font-bold text-blue-500 mb-4">
          Dodge Result: {{ dodgeResultData.attackName }}
        </h2>

        <!-- Target -->
        <div class="mb-4 text-digimon-dark-300">
          <span class="text-white">{{ dodgeResultData.attackerName }}</span>
          attacks
          <span class="text-red-400">{{ dodgeResultData.targetName }}</span>
        </div>

        <!-- Your Dodge Roll -->
        <div class="mb-4 p-4 bg-digimon-dark-700 rounded-lg">
          <h3 class="text-lg font-semibold text-blue-400 mb-2">Your Dodge Roll</h3>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-digimon-dark-400">Dice Pool:</span>
            <span class="text-white font-mono">{{ dodgeResultData.dodgeDicePool }}d6</span>
          </div>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-digimon-dark-400">Results:</span>
            <div class="flex gap-1">
              <span
                v-for="(die, i) in dodgeResultData.dodgeDiceResults"
                :key="i"
                :class="[
                  'px-2 py-1 rounded font-mono text-sm',
                  die >= 5 ? 'bg-green-600 text-white' : 'bg-digimon-dark-600 text-digimon-dark-300'
                ]"
              >
                {{ die }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-digimon-dark-400">Successes:</span>
            <span class="text-blue-400 font-bold text-xl">{{ dodgeResultData.dodgeSuccesses }}</span>
          </div>
        </div>

        <!-- Attacker's Accuracy -->
        <div class="mb-4 p-4 bg-digimon-dark-700 rounded-lg">
          <h3 class="text-lg font-semibold text-orange-400 mb-2">Attacker's Accuracy</h3>
          <div class="flex items-center gap-2">
            <span class="text-digimon-dark-400">Successes:</span>
            <span class="text-orange-400 font-bold text-xl">{{ dodgeResultData.accuracySuccesses }}</span>
          </div>
        </div>

        <!-- Result -->
        <div class="mb-6 p-4 bg-digimon-dark-700 rounded-lg border-2" :class="[
          dodgeResultData.hit ? 'border-red-500' : 'border-green-500'
        ]">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-lg font-semibold" :class="[
              dodgeResultData.hit ? 'text-red-400' : 'text-green-400'
            ]">
              {{ dodgeResultData.hit ? 'HIT!' : 'MISS!' }}
            </h3>
            <div class="text-digimon-dark-400">
              Net Successes:
              <span :class="[
                dodgeResultData.netSuccesses >= 0 ? 'text-red-400' : 'text-green-400',
                'font-bold text-xl ml-2'
              ]">
                {{ dodgeResultData.netSuccesses >= 0 ? '+' : '' }}{{ dodgeResultData.netSuccesses }}
              </span>
            </div>
          </div>

          <!-- Damage Result (if hit) -->
          <div v-if="dodgeResultData.hit" class="mt-4 pt-4 border-t border-digimon-dark-600">
            <div class="flex items-center justify-between">
              <span class="text-red-400 font-semibold text-lg">Damage Taken:</span>
              <span class="text-red-500 font-bold text-3xl">{{ dodgeResultData.finalDamage }}</span>
            </div>
          </div>
        </div>

        <!-- Close Button -->
        <div class="flex justify-end">
          <button
            @click="closeDodgeResultModal"
            class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Intercede Result Modal (shown to the interceptor after they claim intercede) -->
  <Teleport to="body">
    <div
      v-if="showIntercedeResultModal && intercedeResultData"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-2xl border-2 border-yellow-500">
        <h2 class="text-2xl font-bold text-yellow-500 mb-2">
          Intercede Result
        </h2>
        <p class="text-digimon-dark-300 mb-4">
          <span class="text-white font-semibold">{{ intercedeResultData.interceptorName }}</span>
          took the hit for
          <span class="text-white font-semibold">{{ intercedeResultData.targetName }}</span>!
        </p>

        <!-- Attacker's Accuracy -->
        <div class="mb-4 p-4 bg-digimon-dark-700 rounded-lg">
          <h3 class="text-lg font-semibold text-orange-400 mb-2">Attack Details</h3>
          <div class="flex items-center gap-2">
            <span class="text-digimon-dark-400">Attacker:</span>
            <span class="text-white">{{ intercedeResultData.attackerName }}</span>
          </div>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-digimon-dark-400">Accuracy Successes:</span>
            <span class="text-orange-400 font-bold text-xl">{{ intercedeResultData.accuracySuccesses }}</span>
          </div>
        </div>

        <!-- Result -->
        <div class="mb-6 p-4 bg-digimon-dark-700 rounded-lg border-2 border-red-500">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-lg font-semibold text-red-400">
              HIT! (Intercede = 0 Dodge)
            </h3>
            <div class="text-digimon-dark-400">
              Net Successes:
              <span class="text-orange-400 font-bold text-xl ml-2">
                {{ intercedeResultData.netSuccesses >= 0 ? '+' : '' }}{{ intercedeResultData.netSuccesses }}
              </span>
            </div>
          </div>

          <!-- Damage Result -->
          <div class="mt-4 pt-4 border-t border-digimon-dark-600">
            <div class="flex items-center justify-between">
              <span class="text-red-400 font-semibold text-lg">Damage Taken:</span>
              <span class="text-red-500 font-bold text-3xl">{{ intercedeResultData.finalDamage }}</span>
            </div>
          </div>
        </div>

        <!-- Close Button -->
        <div class="flex justify-end">
          <button
            @click="closeIntercedeResultModal"
            class="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Willpower Roll Modal (for digivolution) -->
  <Teleport to="body">
    <div
      v-if="showWillpowerRollModal && pendingDigivolve && tamer"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-purple-500">
        <h2 class="font-display text-xl font-semibold text-purple-400 mb-4">
          Willpower Check — Digivolve to {{ pendingDigivolve.targetSpecies }}
        </h2>

        <div class="mb-4 p-3 bg-purple-900/20 rounded-lg">
          <p class="text-white text-sm">
            DC <span class="font-semibold">{{ DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] }}</span>
            <span class="text-digimon-dark-400 ml-1">({{ tamer.campaignLevel }})</span>
          </p>
          <p class="text-digimon-dark-300 text-sm mt-1">
            3d6 + {{ (typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes as any) : tamer.attributes)?.willpower || 0 }} (Willpower)
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
              @click="rollWillpower"
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
            <div class="text-sm text-digimon-dark-400 mb-2">Your Willpower Roll</div>
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
                {{ (typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes as any) : tamer.attributes)?.willpower || 0 }}
              </span>
            </div>
            <div class="text-3xl font-bold mb-1" :class="willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] ? 'text-green-400' : 'text-red-400'">
              {{ willpowerRollResult.total }}
            </div>
            <div class="text-sm" :class="willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] ? 'text-green-400' : 'text-red-400'">
              {{ willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] ? 'SUCCESS' : 'FAILURE' }}
              <span class="text-digimon-dark-400 ml-1">(vs DC {{ DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] }})</span>
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
            @click="submitWillpowerRoll"
            :class="[
              'flex-1 text-white px-4 py-2 rounded-lg font-semibold transition-colors',
              !willpowerRollResult ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' :
              willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            ]"
          >
            {{ willpowerRollResult && willpowerRollResult.total >= DIGIVOLVE_WILLPOWER_DC[tamer.campaignLevel] ? 'Digivolve!' : 'Accept Failure' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
