<script setup lang="ts">
import { computed } from 'vue'
import type { CampaignLevel } from '~/types'
import type { DigivolveWillpowerTarget, WillpowerRollResult } from '~/composables/useDigivolveWillpower'

const props = defineProps<{
  targetSpecies: string
  tamerName?: string
  campaignLevel: CampaignLevel
  dc: number
  modifier: number
  rollResult: WillpowerRollResult | null
  inspiration: number
  loading: boolean
  warpAvailable: boolean
  warpTargets: readonly DigivolveWillpowerTarget[]
  warpChoice: DigivolveWillpowerTarget | null
}>()

const emit = defineEmits<{
  roll: []
  reroll: []
  cancel: []
  confirm: []
  'toggle-warp': [target: DigivolveWillpowerTarget]
}>()

const passed = computed(() => !!props.rollResult && props.rollResult.total >= props.dc)
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="digivolve-willpower-title"
        class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border-2 border-purple-500"
      >
        <h2 id="digivolve-willpower-title" class="font-display text-xl font-semibold text-purple-400 mb-4">
          Willpower Check — Digivolve to {{ targetSpecies }}
        </h2>

        <div class="mb-4 p-3 bg-purple-900/20 rounded-lg">
          <p v-if="tamerName" class="text-white text-sm">
            <span class="font-semibold">{{ tamerName }}</span> must pass a Willpower check
          </p>
          <p class="text-white text-sm" :class="{ 'mt-1': tamerName }">
            DC <span class="font-semibold">{{ dc }}</span>
            <span class="text-digimon-dark-400 ml-1">({{ campaignLevel }})</span>
          </p>
          <p class="text-digimon-dark-300 text-sm mt-1">3d6 + {{ modifier }} (Willpower)</p>
        </div>

        <div class="mb-4">
          <div class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
            <div class="flex gap-2 items-center justify-center mb-4">
              <span class="text-white font-semibold">3d6 + Willpower</span>
            </div>
            <button
              :disabled="!!rollResult || loading"
              :class="[
                'w-full text-white px-4 py-2 rounded-lg font-semibold transition-colors',
                rollResult || loading ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700',
              ]"
              @click="emit('roll')"
            >
              {{ rollResult ? 'Already Rolled' : 'Roll Willpower' }}
            </button>
          </div>

          <div v-if="rollResult" class="bg-digimon-dark-700 rounded-lg p-4 mb-4 text-center">
            <div class="text-sm text-digimon-dark-400 mb-2">{{ tamerName ? 'Willpower Roll' : 'Your Willpower Roll' }}</div>
            <div class="flex justify-center gap-1 mb-2">
              <span
                v-for="(die, index) in rollResult.rolls"
                :key="index"
                class="w-8 h-8 flex items-center justify-center rounded font-bold text-sm bg-digimon-dark-600 text-white"
              >{{ die }}</span>
              <span class="w-8 h-8 flex items-center justify-center text-digimon-dark-400 font-bold">+</span>
              <span class="w-8 h-8 flex items-center justify-center rounded font-bold text-sm bg-purple-700 text-white">{{ modifier }}</span>
            </div>
            <div class="text-3xl font-bold mb-1" :class="passed ? 'text-green-400' : 'text-red-400'">{{ rollResult.total }}</div>
            <div class="text-sm" :class="passed ? 'text-green-400' : 'text-red-400'">
              {{ passed ? 'SUCCESS' : 'FAILURE' }}
              <span class="text-digimon-dark-400 ml-1">(vs DC {{ dc }})</span>
            </div>
          </div>
        </div>

        <div v-if="warpAvailable" class="bg-violet-900/20 border border-violet-500 rounded-lg p-3 mb-3">
          <p class="text-violet-300 text-sm font-semibold mb-1">Warp Evolution Available!</p>
          <p class="text-digimon-dark-300 text-xs mb-2">Roll exceeded DC by 5+. You may warp to a further stage instead:</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="target in warpTargets"
              :key="target.chainIndex"
              :disabled="loading"
              :class="[
                'text-xs px-3 py-1.5 rounded font-medium transition-colors',
                warpChoice?.chainIndex === target.chainIndex ? 'bg-violet-600 text-white' : 'bg-violet-900/40 hover:bg-violet-700 text-violet-300',
              ]"
              @click="emit('toggle-warp', target)"
            >{{ warpChoice?.chainIndex === target.chainIndex ? '✓ ' : '' }}Warp → {{ target.species }}</button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            v-if="!rollResult"
            :disabled="loading"
            class="flex-1 bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            @click="emit('cancel')"
          >Cancel</button>
          <button
            v-else-if="!passed && inspiration >= 1"
            :disabled="loading"
            class="flex-1 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            @click="emit('reroll')"
          >
            ✦ Spend Inspiration
            <span class="block text-xs font-normal text-yellow-200/70">Re-roll · {{ inspiration }} left</span>
          </button>
          <button
            :disabled="!rollResult || loading"
            :class="[
              'flex-1 text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              !rollResult ? 'bg-digimon-dark-600 opacity-50 cursor-not-allowed' :
              passed ? (warpChoice ? 'bg-violet-600 hover:bg-violet-700' : 'bg-green-600 hover:bg-green-700') : 'bg-red-600 hover:bg-red-700',
            ]"
            @click="emit('confirm')"
          >{{ passed ? (warpChoice ? `Warp → ${warpChoice.species}!` : 'Digivolve!') : 'Accept Failure' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
