<script setup lang="ts">
import type { Digimon } from '../server/db/schema'

interface EvolutionTreeNode {
  digimon: Digimon
  children: EvolutionTreeNode[]
}

defineProps<{
  node: EvolutionTreeNode
  linkBase?: string // '/library/digimon' or empty for non-link display
}>()
</script>

<template>
  <div class="flex items-start gap-2">
    <!-- Current node -->
    <component
      :is="linkBase ? 'NuxtLink' : 'div'"
      :to="linkBase ? `${linkBase}/${node.digimon.id}` : undefined"
      :class="[
        'flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 shrink-0',
        linkBase && 'hover:bg-digimon-dark-600 transition-colors'
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
    </component>

    <!-- Children (recursive) -->
    <template v-if="node.children.length > 0">
      <span class="text-digimon-dark-500 self-center">→</span>
      <div :class="node.children.length > 1 ? 'flex flex-col gap-2' : ''">
        <EvolutionTreeBranch
          v-for="child in node.children"
          :key="child.digimon.id"
          :node="child"
          :link-base="linkBase"
        />
      </div>
    </template>
  </div>
</template>
