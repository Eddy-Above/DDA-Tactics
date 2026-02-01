<script setup lang="ts">
import type { Tamer, Digimon, Encounter } from '../../server/db/schema'
import type { CombatParticipant } from '../../composables/useEncounters'
import type { EvolutionLine } from '../../server/db/schema'
import type { EvolutionChainEntry, EvolutionProgress } from '../../composables/useEvolution'
import { skillsByAttribute, skillLabels } from '../../constants/tamer-skills'
import type { DigimonStage } from '../../types'
import { STAGE_CONFIG } from '../../types'
import { getStageColor } from '../../utils/displayHelpers'

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
const evolutionLines = ref<EvolutionLine[]>([])
const activeEncounter = ref<Encounter | null>(null)
const loading = ref(true)
const lastRefresh = ref(new Date())

// Note: Evolution chain navigation now uses currentDigimonId (see digimonChains computed)

// Composables
const { fetchTamer, calculateDerivedStats: calcTamerStats } = useTamers()
const { fetchDigimon, calculateDerivedStats: calcDigimonStats } = useDigimon()
const { encounters, fetchEncounters, getCurrentParticipant } = useEncounters()
const { fetchEvolutionLines, getCurrentStage, getNextStage, canEvolve } = useEvolution()

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

      // Fetch evolution lines
      const lines = await $fetch<EvolutionLine[]>(`/api/evolution-lines?partnerId=${fetchedTamer.id}`)
      evolutionLines.value = lines

      // Fetch encounters to find active one
      await fetchEncounters()
      const active = encounters.value.find((e) => e.phase === 'combat')
      if (active) {
        // Check if this tamer or their Digimon are participating
        const participants = active.participants as CombatParticipant[]
        const isParticipating = participants.some(
          (p) =>
            (p.type === 'tamer' && p.entityId === fetchedTamer.id) ||
            (p.type === 'digimon' && partnerDigimon.value.some((d) => d.id === p.entityId))
        )
        if (isParticipating) {
          activeEncounter.value = active
        } else {
          activeEncounter.value = null
        }
      } else {
        activeEncounter.value = null
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

// Computed
const tamerStats = computed(() => (tamer.value ? calcTamerStats(tamer.value) : null))

const myParticipants = computed(() => {
  if (!activeEncounter.value || !tamer.value) return []
  const participants = activeEncounter.value.participants as CombatParticipant[]
  return participants.filter(
    (p) =>
      (p.type === 'tamer' && p.entityId === tamer.value!.id) ||
      (p.type === 'digimon' && partnerDigimon.value.some((d) => d.id === p.entityId))
  )
})

const currentTurnParticipant = computed(() => {
  if (!activeEncounter.value) return null
  return getCurrentParticipant(activeEncounter.value)
})

const isMyTurn = computed(() => {
  if (!currentTurnParticipant.value || !tamer.value) return false
  return myParticipants.value.some((p) => p.id === currentTurnParticipant.value!.id)
})

function getParticipantName(participant: CombatParticipant): string {
  if (participant.type === 'tamer') {
    return tamer.value?.name || 'Unknown'
  }
  const digimon = partnerDigimon.value.find((d) => d.id === participant.entityId)
  return digimon?.name || 'Unknown'
}

// Clear selection
const selectedTamerId = useCookie<string | null>('player-tamer-id')
function switchCharacter() {
  selectedTamerId.value = null
  navigateTo('/player')
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
            <span class="text-xs text-digimon-dark-400">
              Last updated: {{ lastRefresh.toLocaleTimeString() }}
            </span>
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
              <div class="flex gap-4 text-xs">
                <div class="flex items-center gap-1">
                  <span class="text-digimon-dark-400">Simple:</span>
                  <div class="flex gap-0.5">
                    <div v-for="i in 2" :key="i" :class="['w-3 h-3 rounded', i <= participant.actionsRemaining.simple ? 'bg-blue-500' : 'bg-digimon-dark-600']" />
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <span class="text-digimon-dark-400">Complex:</span>
                  <div :class="['w-3 h-3 rounded', participant.actionsRemaining.complex > 0 ? 'bg-purple-500' : 'bg-digimon-dark-600']" />
                </div>
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
                  class="relative group text-center bg-digimon-dark-700 rounded-lg p-2 cursor-help"
                >
                  <div class="text-xs text-digimon-dark-400 uppercase">{{ attr }}</div>
                  <div class="text-lg font-semibold text-white">{{ value }}</div>

                  <!-- Skill hover box -->
                  <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div class="bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg p-2 shadow-lg whitespace-nowrap">
                      <div
                        v-for="skill in skillsByAttribute[attr as keyof typeof skillsByAttribute]"
                        :key="skill"
                        class="text-sm flex justify-between gap-3"
                      >
                        <span class="text-digimon-dark-400">{{ skillLabels[skill] }}:</span>
                        <span class="text-white font-medium">{{ tamer.skills[skill as keyof typeof tamer.skills] }}</span>
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
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.armor + (getCurrentForm(chain.chainId)!.bonusStats?.armor || 0) }}</div>
                </div>
                <div class="text-center bg-digimon-dark-700 rounded-lg p-2">
                  <div class="text-xs text-digimon-dark-400">HP</div>
                  <div class="text-lg font-semibold text-white">{{ getCurrentForm(chain.chainId)!.baseStats.health + (getCurrentForm(chain.chainId)!.bonusStats?.health || 0) }}</div>
                </div>
              </div>

              <!-- Derived Stats -->
              <div class="flex flex-wrap gap-4 text-sm mb-4">
                <span><span class="text-digimon-dark-400">Agility:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).agility }}</span></span>
                <span><span class="text-digimon-dark-400">Body:</span> <span class="text-white">{{ calcDigimonStats(getCurrentForm(chain.chainId)!).body }}</span></span>
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
                <span><span class="text-digimon-dark-400">Stage Bonus:</span> <span class="text-white">+{{ calcDigimonStats(getCurrentForm(chain.chainId)!).stageBonus }}</span></span>
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
                        <span class="text-orange-400">
                          DMG: {{ getAttackDamage(getCurrentForm(chain.chainId)!, { range: attack.range, tags: attack.tags || [] }) }}
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

            <!-- Evolution Lines -->
            <div v-for="line in evolutionLines" :key="line.id" class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
              <h3 class="font-display text-lg font-semibold text-white mb-4">{{ line.name }}</h3>

              <!-- Chain visualization -->
              <div class="flex items-center gap-2 flex-wrap mb-4">
                <template v-for="(entry, index) in (line.chain as EvolutionChainEntry[])" :key="index">
                  <div
                    :class="[
                      'px-3 py-1.5 rounded-lg text-sm font-medium border',
                      index === line.currentStageIndex
                        ? 'bg-digimon-orange-500/20 border-digimon-orange-500 text-digimon-orange-400'
                        : index < line.currentStageIndex
                          ? 'bg-green-900/20 border-green-500/30 text-green-400'
                          : 'bg-digimon-dark-700 border-digimon-dark-600 text-digimon-dark-400',
                    ]"
                  >
                    {{ entry.species }}
                  </div>
                  <span v-if="index < (line.chain as EvolutionChainEntry[]).length - 1" class="text-digimon-dark-500">→</span>
                </template>
              </div>

              <!-- Next evolution requirements -->
              <div v-if="getNextStage(line)" class="text-sm">
                <span class="text-digimon-dark-400">Next:</span>
                <span :class="['ml-1', getStageColor(getNextStage(line)!.stage)]">{{ getNextStage(line)!.species }}</span>
                <span :class="['ml-2', canEvolve(line).canEvolve ? 'text-green-400' : 'text-yellow-400']">
                  ({{ canEvolve(line).reason }})
                </span>
              </div>
              <div v-else class="text-sm text-green-400">
                Maximum evolution reached!
              </div>

              <!-- Progress -->
              <div class="flex gap-4 mt-2 text-xs text-digimon-dark-400">
                <span>Battles: {{ (line.evolutionProgress as EvolutionProgress).battlesWon }}</span>
                <span>XP: {{ (line.evolutionProgress as EvolutionProgress).xpEarned }}</span>
                <span>Bond: {{ (line.evolutionProgress as EvolutionProgress).bondLevel }}</span>
              </div>
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
</template>
