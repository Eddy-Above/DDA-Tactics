<script setup lang="ts">
import type { EddySoulRules } from '../types'

interface Props {
  selectedAttack: { participant: any; attack: any }
  round: number
  eddySoulRules?: EddySoulRules
  canBolster: boolean
  hugePower: { rank1: boolean; rank2: boolean }
  actOfInspirationCost: number
  currentInspiration: number
}

const props = defineProps<Props>()

const bolsterAttackEnabled = defineModel<boolean>('bolsterAttackEnabled', { required: true })
const bolsterAttackType = defineModel<'damage-accuracy' | 'bit-cpu'>('bolsterAttackType', { required: true })
const lifestealComplexEnabled = defineModel<boolean>('lifestealComplexEnabled', { required: true })
const hugePowerEnabled = defineModel<boolean>('hugePowerEnabled', { required: true })
const hugePowerRank2Enabled = defineModel<boolean>('hugePowerRank2Enabled', { required: true })
const actOfInspirationEnabled = defineModel<boolean>('actOfInspirationEnabled', { required: true })
const actOfInspirationDirection = defineModel<'add' | 'subtract'>('actOfInspirationDirection', { required: true })
</script>

<template>
  <!-- Bolster Attack Toggle -->
  <div
    v-if="canBolster && !lifestealComplexEnabled"
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
          (round || 0) - selectedAttack.participant.lastBitCpuBolsterRound < 2"
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

  <!-- Lifesteal Complex Action Toggle -->
  <div
    v-if="selectedAttack.attack.effect === 'Lifesteal' && (selectedAttack.participant.actionsRemaining?.simple || 0) >= 2 && !bolsterAttackEnabled"
    class="mb-4 p-3 bg-digimon-dark-700 rounded-lg border border-digimon-dark-600"
  >
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        v-model="lifestealComplexEnabled"
        class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-green-500"
      />
      <span class="text-sm text-green-400 font-medium">Lifesteal Complex Action (2 Simple Actions)</span>
      <span class="text-xs text-digimon-dark-400 ml-auto">Double potency</span>
    </label>
  </div>

  <!-- Huge Power Toggle -->
  <div
    v-if="hugePower.rank1 || hugePower.rank2"
    class="mb-4 p-3 bg-digimon-dark-700 rounded-lg border border-digimon-dark-600 space-y-2"
  >
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        v-model="hugePowerEnabled"
        :disabled="!hugePower.rank1"
        class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-cyan-500"
      />
      <span class="text-sm text-cyan-400 font-medium">Huge Power (Reroll 1s)</span>
      <span v-if="eddySoulRules?.hugePowerOncePerTurn" class="text-xs text-digimon-dark-400 ml-auto">1/turn</span>
      <span v-else-if="selectedAttack.attack.range === 'ranged'" class="text-xs text-digimon-dark-400 ml-auto">1/round</span>
      <span v-else class="text-xs text-digimon-dark-400 ml-auto">Unlimited (Melee)</span>
    </label>
    <label
      v-if="hugePower.rank2"
      class="flex items-center gap-2 cursor-pointer pl-6"
    >
      <input
        type="checkbox"
        v-model="hugePowerRank2Enabled"
        :disabled="!hugePowerEnabled"
        class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-amber-500"
      />
      <span class="text-sm text-amber-400 font-medium">Rank 2 (Also reroll 2s)</span>
      <span class="text-xs text-digimon-dark-400 ml-auto">1/round</span>
    </label>
  </div>

  <!-- Act of Inspiration Toggle -->
  <div class="mb-4 p-3 bg-digimon-dark-700 rounded-lg border border-digimon-dark-600">
    <label class="flex items-center gap-2 cursor-pointer mb-2">
      <input
        type="checkbox"
        v-model="actOfInspirationEnabled"
        :disabled="currentInspiration < actOfInspirationCost"
        class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-yellow-500"
      />
      <span class="text-sm text-yellow-400 font-medium">⚡ Act of Inspiration (Spend {{ actOfInspirationCost }})</span>
      <span class="text-xs text-digimon-dark-400 ml-auto">±5 Dice</span>
    </label>
    <div v-if="actOfInspirationEnabled" class="flex gap-2 mt-2">
      <button
        @click="actOfInspirationDirection = 'add'"
        :class="[
          'flex-1 text-xs px-2 py-1.5 rounded transition-colors',
          actOfInspirationDirection === 'add'
            ? 'bg-yellow-600 text-white'
            : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
        ]"
      >
        +5 Dice
      </button>
      <button
        @click="actOfInspirationDirection = 'subtract'"
        :class="[
          'flex-1 text-xs px-2 py-1.5 rounded transition-colors',
          actOfInspirationDirection === 'subtract'
            ? 'bg-yellow-600 text-white'
            : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
        ]"
      >
        -5 Dice
      </button>
    </div>
  </div>
</template>
