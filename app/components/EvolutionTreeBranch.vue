<script setup lang="ts">
import { computed } from 'vue'
import type { Digimon } from '../server/db/schema'
import { STAGE_ORDER } from '~/data/qualities'

interface EvolutionTreeNode {
  digimon: Digimon
  children: EvolutionTreeNode[]
}

const props = defineProps<{
  node: EvolutionTreeNode
  linkBase?: string // '/library/digimon' or empty for non-link display
}>()

const ROW_HEIGHT = 88 // px per stage row: ~52px card + 8px gap + 20px arrow + 8px gap

const minChildStageIndex = computed(() => {
  if (props.node.children.length === 0) return 0
  return Math.min(...props.node.children.map(c => STAGE_ORDER.indexOf(c.digimon.stage as typeof STAGE_ORDER[number])))
})

function childStageOffset(child: EvolutionTreeNode): number {
  const idx = STAGE_ORDER.indexOf(child.digimon.stage as typeof STAGE_ORDER[number])
  return (idx - minChildStageIndex.value) * ROW_HEIGHT
}
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <!-- Current node -->
    <NuxtLink
      v-if="linkBase"
      :to="`${linkBase}/${node.digimon.id}`"
      :class="[
        'flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 shrink-0 hover:bg-digimon-dark-600 transition-colors'
      ]"
    >
      <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
        <img
          v-if="node.digimon.spriteUrl"
          :src="node.digimon.spriteUrl"
          :alt="node.digimon.name"
          class="max-w-full max-h-full object-contain"
        />
        <span v-else class="text-sm">🦖</span>
      </div>
      <div>
        <div class="text-white text-sm font-medium">{{ node.digimon.name }}</div>
        <div class="text-xs text-digimon-dark-400 capitalize">{{ node.digimon.stage }}</div>
      </div>
    </NuxtLink>
    <div
      v-else
      :class="[
        'flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 shrink-0'
      ]"
    >
      <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
        <img
          v-if="node.digimon.spriteUrl"
          :src="node.digimon.spriteUrl"
          :alt="node.digimon.name"
          class="max-w-full max-h-full object-contain"
        />
        <span v-else class="text-sm">🦖</span>
      </div>
      <div>
        <div class="text-white text-sm font-medium">{{ node.digimon.name }}</div>
        <div class="text-xs text-digimon-dark-400 capitalize">{{ node.digimon.stage }}</div>
      </div>
    </div>

    <!-- Children (recursive) -->
    <template v-if="node.children.length > 0">
      <template v-if="node.children.length === 1">
        <div class="flex flex-col items-center -mt-2">
          <div class="w-px h-4 bg-digimon-dark-500"></div>
          <EvolutionTreeBranch :node="node.children[0]" :link-base="linkBase" />
        </div>
      </template>
      <template v-else>
        <div class="flex flex-col items-center -mt-2">
        <div class="w-px h-3 bg-digimon-dark-500"></div>
        <div class="flex">
          <div
            v-for="(child, i) in node.children"
            :key="child.digimon.id"
            class="flex flex-col items-center px-2"
          >
            <div class="relative w-full" :style="{ height: (16 + childStageOffset(child)) + 'px' }">
              <div
                class="absolute top-0 h-px bg-digimon-dark-500"
                :class="i === 0 ? 'left-1/2 -right-2' : i === node.children.length - 1 ? '-left-2 right-1/2' : '-inset-x-2'"
              ></div>
              <div class="absolute left-1/2 top-px bottom-0 w-px bg-digimon-dark-500"></div>
            </div>
            <EvolutionTreeBranch :node="child" :link-base="linkBase" />
          </div>
        </div>
        </div>
      </template>
    </template>
  </div>
</template>
