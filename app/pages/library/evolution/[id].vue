<script setup lang="ts">
import { h, defineComponent, type PropType } from 'vue'
import type { EvolutionLine, Digimon } from '../../../server/db/schema'
import type { EvolutionChainEntry } from '../../../composables/useEvolution'
import type { DigimonStage } from '../../../types'
import { getStageColor } from '../../../utils/displayHelpers'

// Tree node component
const EvolutionTreeNode = defineComponent({
  name: 'EvolutionTreeNode',
  props: {
    node: { type: Object as PropType<any>, required: true },
    evolutionLine: { type: Object as PropType<EvolutionLine>, required: true },
    getLinkedDigimon: { type: Function, required: true },
    getStageColor: { type: Function, required: true },
    getStageBgColor: { type: Function, required: true },
    handleToggleLock: { type: Function, required: true },
    handleLinkDigimon: { type: Function, required: true },
  },
  setup(props) {
    const { entry, index, children } = props.node

    return () => h('div', { class: 'flex flex-col items-center' }, [
      // Current node
      h('div', {
        class: [
          'relative rounded-xl p-4 border-2 transition-all min-w-[280px]',
          index === props.evolutionLine.currentStageIndex
            ? 'border-digimon-orange-500 shadow-lg shadow-digimon-orange-500/20'
            : 'border-digimon-dark-600',
        ],
      }, [
        h('div', { class: 'flex items-center gap-3' }, [
          // Sprite or number circle
          props.getLinkedDigimon(entry)?.spriteUrl
            ? h('div', {
                class: 'w-12 h-12 rounded-lg overflow-hidden bg-digimon-dark-600 shrink-0',
              }, [
                h('img', {
                  src: props.getLinkedDigimon(entry).spriteUrl,
                  alt: entry.species,
                  class: 'w-full h-full object-contain',
                }),
              ])
            : h('div', {
                class: [
                  'w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold shrink-0',
                  props.getStageBgColor(entry.stage),
                  props.getStageColor(entry.stage),
                ],
              }, String(index + 1)),

          // Info
          h('div', { class: 'flex-1' }, [
            h('div', { class: 'flex items-center gap-2 flex-wrap' }, [
              h('h3', { class: 'text-lg font-semibold text-white' }, entry.species),
              h('span', { class: ['text-xs capitalize', props.getStageColor(entry.stage)] }, entry.stage),
              index === props.evolutionLine.currentStageIndex &&
                h('span', { class: 'text-xs bg-digimon-orange-500 text-white px-2 py-0.5 rounded' }, 'Current'),
            ]),

            // Lock/unlock button
            index > 0 && h('div', { class: 'mt-2' }, [
              h('button', {
                type: 'button',
                class: [
                  'px-2 py-1 text-xs rounded font-medium transition-colors',
                  entry.isUnlocked
                    ? 'bg-green-900/30 hover:bg-green-900/50 text-green-400'
                    : 'bg-digimon-dark-600 hover:bg-digimon-dark-500 text-digimon-dark-400',
                ],
                onClick: () => props.handleToggleLock(index),
              }, entry.isUnlocked ? '🔓 Unlocked' : '🔒 Locked'),
            ]),
          ]),
        ]),
      ]),

      // Children (horizontally arranged)
      children.length > 0 && h('div', { class: 'flex items-start gap-4 mt-6 relative' }, [
        // Connector lines
        h('div', { class: 'absolute top-0 left-1/2 w-0.5 h-6 bg-digimon-dark-600 -translate-x-1/2' }),

        // Child nodes
        ...children.map((child: any, i: number) => [
          h(EvolutionTreeNode, {
            key: child.index,
            node: child,
            evolutionLine: props.evolutionLine,
            getLinkedDigimon: props.getLinkedDigimon,
            getStageColor: props.getStageColor,
            getStageBgColor: props.getStageBgColor,
            handleToggleLock: props.handleToggleLock,
            handleLinkDigimon: props.handleLinkDigimon,
          }),
          i < children.length - 1 && h('div', { class: 'w-8' }), // Spacer
        ]),
      ]),
    ])
  },
})

definePageMeta({
  title: 'Evolution Line',
})

const route = useRoute()
const router = useRouter()

const {
  fetchEvolutionLine,
  updateEvolutionLine,
  evolve,
  devolve,
  toggleStageLock,
  getCurrentStage,
  getNextStageOptions,
  getEvolutionOptions,
  canEvolve,
  linkDigimonToChainEntry,
  refreshChainFromLibrary,
  loading,
  error,
} = useEvolution()

const { digimonList, fetchDigimon } = useDigimon()
const { tamers, fetchTamers } = useTamers()

const evolutionLine = ref<EvolutionLine | null>(null)
const initialLoading = ref(true)

const tamerMap = computed(() => {
  const map = new Map<string, string>()
  tamers.value.forEach((t) => map.set(t.id, t.name))
  return map
})

onMounted(async () => {
  await Promise.all([
    fetchTamers(),
    fetchDigimon(),
    (async () => {
      const line = await fetchEvolutionLine(route.params.id as string)
      evolutionLine.value = line
    })(),
  ])
  initialLoading.value = false
})

// Get linked Digimon for a chain entry
function getLinkedDigimon(entry: EvolutionChainEntry): Digimon | null {
  if (!entry.digimonId) return null
  return digimonList.value.find((d) => d.id === entry.digimonId) || null
}

// Handle linking a Digimon to a chain entry
async function handleLinkDigimon(index: number, digimonId: string | null) {
  if (!evolutionLine.value) return
  const updated = await linkDigimonToChainEntry(evolutionLine.value.id, index, digimonId)
  if (updated) {
    evolutionLine.value = updated
  }
}

// Computed values
const chain = computed(() => evolutionLine.value ? getChainArray(evolutionLine.value.chain) : [])
const currentStage = computed(() => evolutionLine.value ? getCurrentStage(evolutionLine.value) : null)
const evolutionOptions = computed(() => evolutionLine.value ? getEvolutionOptions(evolutionLine.value) : [])
const evolutionStatus = computed(() => evolutionLine.value ? canEvolve(evolutionLine.value) : { canEvolve: false, reason: '' })

// Handle lock/unlock toggle
async function handleToggleLock(stageIndex: number) {
  if (!evolutionLine.value) return

  const chainArray = getChainArray(evolutionLine.value.chain)
  const currentUnlocked = chainArray[stageIndex].isUnlocked

  const updated = await toggleStageLock(evolutionLine.value.id, stageIndex, !currentUnlocked)
  if (updated) {
    evolutionLine.value = updated
  }
}

async function handleEvolve(targetIndex?: number) {
  if (!evolutionLine.value || !evolutionStatus.value.canEvolve) return

  const options = evolutionOptions.value
  if (options.length === 0) return

  // If multiple options and no target specified, need to choose
  if (options.length > 1 && targetIndex === undefined) {
    return
  }

  // Get the actual target index
  let actualTargetIndex: number
  if (targetIndex !== undefined) {
    actualTargetIndex = targetIndex
  } else {
    // Find the index of the first (and only) option
    actualTargetIndex = chain.value.findIndex(e => e.digimonId === options[0].digimonId)
  }

  const targetEntry = chain.value[actualTargetIndex]

  if (confirm(`Evolve to ${targetEntry.species}?`)) {
    const updated = await evolve(evolutionLine.value.id, actualTargetIndex)
    if (updated) {
      evolutionLine.value = updated
    }
  }
}

async function handleDevolve() {
  if (!evolutionLine.value || evolutionLine.value.currentStageIndex <= 0) return

  if (confirm('Devolve to previous stage?')) {
    const updated = await devolve(evolutionLine.value.id)
    if (updated) {
      evolutionLine.value = updated
    }
  }
}

async function handleRefreshChain() {
  if (!evolutionLine.value) return

  if (confirm('Refresh chain from library? This will detect any new Digimon and add them to the chain, preserving existing lock states.')) {
    const updated = await refreshChainFromLibrary(evolutionLine.value.id)
    if (updated) {
      evolutionLine.value = updated
    }
  }
}

function getStageBgColor(stage: DigimonStage): string {
  const colors: Record<DigimonStage, string> = {
    fresh: 'bg-digimon-stage-fresh/20',
    'in-training': 'bg-digimon-stage-intraining/20',
    rookie: 'bg-digimon-stage-rookie/20',
    champion: 'bg-digimon-stage-champion/20',
    ultimate: 'bg-digimon-stage-ultimate/20',
    mega: 'bg-digimon-stage-mega/20',
    ultra: 'bg-digimon-stage-ultra/20',
  }
  return colors[stage] || 'bg-gray-500/20'
}

// Helper to safely get chain as array (handle JSON string if needed)
function getChainArray(chainData: any): EvolutionChainEntry[] {
  if (typeof chainData === 'string') {
    try {
      return JSON.parse(chainData) as EvolutionChainEntry[]
    } catch {
      return []
    }
  }
  return chainData as EvolutionChainEntry[] || []
}

// Build tree structure for visualization
interface TreeNode {
  entry: EvolutionChainEntry
  index: number
  children: TreeNode[]
}

function buildTree(chainArray: EvolutionChainEntry[]): TreeNode[] {
  // Find root nodes (evolvesFromIndex === null)
  const roots: TreeNode[] = []
  const nodeMap = new Map<number, TreeNode>()

  // Create nodes
  chainArray.forEach((entry, index) => {
    nodeMap.set(index, { entry, index, children: [] })
  })

  // Build tree structure
  chainArray.forEach((entry, index) => {
    const node = nodeMap.get(index)!
    if (entry.evolvesFromIndex === null) {
      roots.push(node)
    } else {
      const parent = nodeMap.get(entry.evolvesFromIndex)
      if (parent) {
        parent.children.push(node)
      }
    }
  })

  return roots
}

const treeRoots = computed(() => buildTree(chain.value))
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading evolution line...</div>
    </div>

    <div v-else-if="!evolutionLine" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Evolution Line Not Found</h2>
      <NuxtLink to="/library/evolution" class="text-digimon-orange-400 hover:text-digimon-orange-300">
        Return to Evolution Lines
      </NuxtLink>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex justify-between items-start mb-8">
        <div>
          <NuxtLink to="/library/evolution" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Evolution Lines
          </NuxtLink>
          <h1 class="font-display text-3xl font-bold text-white">{{ evolutionLine.name }}</h1>
          <p v-if="evolutionLine.partnerId && tamerMap.get(evolutionLine.partnerId)" class="text-digimon-dark-400">
            Partner of {{ tamerMap.get(evolutionLine.partnerId) }}
          </p>
        </div>
        <button
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50
                 text-white px-4 py-2 rounded-lg font-semibold transition-colors text-sm"
          :disabled="loading"
          @click="handleRefreshChain"
        >
          🔄 Refresh Chain
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Evolution Chain Visualization -->
        <div class="lg:col-span-2">
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h2 class="font-display text-xl font-semibold text-white mb-6">Evolution Tree</h2>

            <!-- Tree visualization -->
            <div class="flex flex-col items-center gap-6">
              <template v-for="root in treeRoots" :key="`tree-${evolutionLine.updatedAt}-${root.index}`">
                <EvolutionTreeNode
                  :node="root"
                  :evolution-line="evolutionLine"
                  :get-linked-digimon="getLinkedDigimon"
                  :get-stage-color="getStageColor"
                  :get-stage-bg-color="getStageBgColor"
                  :handle-toggle-lock="handleToggleLock"
                  :handle-link-digimon="handleLinkDigimon"
                />
              </template>
            </div>
          </div>
        </div>

        <!-- Fallback: Old flat list view (hidden, for reference) -->
        <div v-if="false" class="lg:col-span-2">
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h2 class="font-display text-xl font-semibold text-white mb-6">Evolution Chain</h2>

            <div class="space-y-4">
              <div
                v-for="(entry, index) in chain"
                :key="index"
                :class="[
                  'relative rounded-xl p-4 border-2 transition-all',
                  index === evolutionLine.currentStageIndex
                    ? 'border-digimon-orange-500 shadow-lg shadow-digimon-orange-500/20'
                    : index < evolutionLine.currentStageIndex
                      ? 'border-green-500/50 bg-green-900/10'
                      : 'border-digimon-dark-600',
                ]"
              >
                <!-- Connector line -->
                <div
                  v-if="index > 0"
                  class="absolute -top-4 left-8 w-0.5 h-4"
                  :class="index <= evolutionLine.currentStageIndex ? 'bg-green-500' : 'bg-digimon-dark-600'"
                />

                <div class="flex items-center gap-4">
                  <!-- Stage indicator / Linked Digimon sprite -->
                  <div
                    v-if="getLinkedDigimon(entry)?.spriteUrl"
                    class="w-16 h-16 rounded-lg overflow-hidden bg-digimon-dark-600 shrink-0 border-2"
                    :class="[
                      index === evolutionLine.currentStageIndex
                        ? 'border-digimon-orange-500'
                        : index < evolutionLine.currentStageIndex
                          ? 'border-green-500'
                          : 'border-digimon-dark-500',
                    ]"
                  >
                    <img
                      :src="getLinkedDigimon(entry)!.spriteUrl!"
                      :alt="getLinkedDigimon(entry)!.name"
                      class="w-full h-full object-contain"
                    />
                  </div>
                  <div
                    v-else
                    :class="[
                      'w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0',
                      index === evolutionLine.currentStageIndex
                        ? 'bg-digimon-orange-500 text-white'
                        : index < evolutionLine.currentStageIndex
                          ? 'bg-green-500 text-white'
                          : getStageBgColor(entry.stage) + ' ' + getStageColor(entry.stage),
                    ]"
                  >
                    {{ index < evolutionLine.currentStageIndex ? '✓' : index + 1 }}
                  </div>

                  <!-- Stage info -->
                  <div class="flex-1">
                    <div class="flex items-center gap-3 flex-wrap">
                      <h3 class="text-xl font-semibold text-white">{{ entry.species }}</h3>
                      <span :class="['text-sm capitalize', getStageColor(entry.stage)]">
                        {{ entry.stage }}
                      </span>
                      <span v-if="index === evolutionLine.currentStageIndex" class="text-xs bg-digimon-orange-500 text-white px-2 py-0.5 rounded">
                        Current
                      </span>
                    </div>

                    <!-- Linked Digimon info -->
                    <div v-if="getLinkedDigimon(entry)" class="mt-2 flex items-center gap-2">
                      <span class="text-sm text-cyan-400">Linked:</span>
                      <NuxtLink
                        :to="`/library/digimon/${entry.digimonId}`"
                        class="text-sm text-white hover:text-digimon-orange-400 underline"
                      >
                        {{ getLinkedDigimon(entry)!.name }}
                      </NuxtLink>
                      <button
                        type="button"
                        class="text-xs text-red-400 hover:text-red-300"
                        @click="handleLinkDigimon(index, null)"
                      >
                        (unlink)
                      </button>
                    </div>
                    <div v-else class="mt-2">
                      <DigimonSelector
                        :model-value="null"
                        :stage="entry.stage"
                        placeholder="Link Digimon sheet..."
                        @update:model-value="handleLinkDigimon(index, $event)"
                      />
                    </div>

                    <!-- Lock/Unlock toggle -->
                    <div v-if="index > 0" class="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        class="px-3 py-1 text-sm rounded font-medium transition-colors"
                        :class="[
                          entry.isUnlocked
                            ? 'bg-green-900/30 hover:bg-green-900/50 text-green-400'
                            : 'bg-digimon-dark-600 hover:bg-digimon-dark-500 text-digimon-dark-400'
                        ]"
                        @click="handleToggleLock(index)"
                      >
                        {{ entry.isUnlocked ? '🔓 Unlocked' : '🔒 Locked' }}
                      </button>
                      <span class="text-xs text-digimon-dark-400">
                        {{ entry.isUnlocked ? 'Click to lock' : 'Click to unlock' }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="space-y-4">
          <!-- Current Status -->
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-4">Current Status</h3>

            <div class="space-y-4">
              <div>
                <div class="text-sm text-digimon-dark-400">Current Form</div>
                <div :class="['text-xl font-semibold', getStageColor(currentStage?.stage || 'rookie')]">
                  {{ currentStage?.species || 'Unknown' }}
                </div>
              </div>

              <div v-if="evolutionOptions.length > 0">
                <div class="text-sm text-digimon-dark-400 mb-2">Evolution Options</div>
                <div class="space-y-2">
                  <div
                    v-for="(option, idx) in evolutionOptions"
                    :key="idx"
                    class="flex items-center gap-2"
                  >
                    <div :class="['text-sm font-semibold', getStageColor(option.stage)]">
                      {{ option.species }}
                    </div>
                    <button
                      v-if="evolutionOptions.length > 1"
                      class="ml-auto text-xs bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-2 py-1 rounded"
                      @click="handleEvolve(chain.findIndex(e => e.digimonId === option.digimonId))"
                    >
                      Choose
                    </button>
                  </div>
                </div>
                <div class="text-xs text-digimon-dark-400 mt-2">
                  {{ evolutionStatus.reason }}
                </div>
              </div>
              <div v-else class="text-yellow-400 text-sm">
                {{ evolutionStatus.reason }}
              </div>

              <!-- Evolution buttons -->
              <div class="flex gap-2 pt-2">
                <button
                  v-if="evolutionOptions.length === 1"
                  :disabled="!evolutionStatus.canEvolve || loading"
                  class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                         text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                  @click="handleEvolve()"
                >
                  ⬆️ Evolve
                </button>
                <button
                  :disabled="!currentStage || currentStage.evolvesFromIndex === null || loading"
                  class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50
                         text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                  @click="handleDevolve"
                >
                  ⬇️ De-evolve
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

    </template>
  </div>
</template>
