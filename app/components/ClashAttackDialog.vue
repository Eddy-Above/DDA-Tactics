<script setup lang="ts">
import { computed } from 'vue'
import type { Attack } from '../types'
import { getAttackBadges } from '../utils/attackBadges'

const props = defineProps<{
  open: boolean
  attacks: Attack[]
  chargeAttack: Attack | null
}>()

const emit = defineEmits<{
  pick: [attack: Attack]
  'choose-charge': [moveAfter: boolean]
  back: []
  close: []
}>()

const attackOptions = computed(() => props.attacks.map(attack => ({ attack, badges: getAttackBadges(attack) })))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      @click.self="emit('close')"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clash-attack-title"
        class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto border-2 border-red-600"
      >
        <h2 id="clash-attack-title" class="font-display text-xl font-semibold text-white mb-1">Clash Attack</h2>
        <template v-if="chargeAttack">
          <p class="text-xs text-digimon-dark-400 mb-4"><span class="font-semibold text-cyan-300">{{ chargeAttack.name }}</span> has Charge. While clashing you may attack in place or attack then move.</p>
          <div class="flex flex-col gap-2">
            <button class="px-3 py-2 rounded text-sm text-left bg-digimon-dark-700 text-digimon-dark-200 hover:bg-digimon-dark-600" @click="emit('choose-charge', false)">
              <span class="font-semibold">Attack &amp; stay</span><span class="ml-2 text-xs text-digimon-dark-400">keep the clash</span>
            </button>
            <button class="px-3 py-2 rounded text-sm text-left bg-digimon-dark-700 text-digimon-dark-200 hover:bg-digimon-dark-600" @click="emit('choose-charge', true)">
              <span class="font-semibold">Attack &amp; move</span><span class="ml-2 text-xs text-digimon-dark-400">charge away, ends the clash</span>
            </button>
          </div>
          <button class="mt-4 w-full text-xs text-digimon-dark-500 hover:text-white" @click="emit('back')">Back</button>
        </template>
        <template v-else>
          <p class="text-xs text-digimon-dark-400 mb-4">Choose a melee attack to use on the clash opponent. The target rolls half their Dodge pool.</p>
          <div v-if="attackOptions.length === 0" class="text-sm text-digimon-dark-400 italic">No melee attacks available.</div>
          <div class="flex flex-col gap-2">
            <button
              v-for="{ attack, badges } in attackOptions"
              :key="attack.id"
              class="px-3 py-2 rounded text-sm text-left bg-digimon-dark-700 text-digimon-dark-200 hover:bg-digimon-dark-600"
              @click="emit('pick', attack)"
            >
              <span class="font-semibold">{{ attack.name }}</span>
              <span class="ml-2 text-xs text-digimon-dark-400 capitalize">{{ attack.range }}</span>
              <span v-if="badges.aoe || badges.charge || badges.ap || badges.effect" class="mt-1 flex flex-wrap gap-1">
                <span v-if="badges.aoe" class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300">{{ badges.aoe }}</span>
                <span v-if="badges.charge" class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-300">Charge</span>
                <span v-if="badges.ap" class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300">{{ badges.ap }}</span>
                <span v-if="badges.effect" class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-300">{{ badges.effect }}</span>
              </span>
            </button>
          </div>
          <button class="mt-4 w-full text-xs text-digimon-dark-500 hover:text-white" @click="emit('close')">Cancel</button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
