<script setup lang="ts">
// One panel for every target an area attack hit among a player's characters: each gets its own
// Dodge pool, Inspiration choices, roll and status, with "Roll all unrolled" and "Submit ready
// defenses" for speed. Presentational: the state and the rules live in useAreaDefenseBatch.
import { computed } from 'vue'
import type { DefenseEntry } from '../composables/useAreaDefenseBatch'
import type { DodgeDefense } from '../utils/areaDefense'

type DefenseView = DefenseEntry & { defense: DodgeDefense }

const props = defineProps<{
  views: DefenseView[]
  /** Display name of the character a request defends. */
  nameFor: (request: any) => string
  inspiration: number
  maxInspiration: number
  actCost: number
  /** Every defense is submitted (or no longer needed): the panel can be closed. */
  settled: boolean
  /** A "roll all" or "submit all" pass is running. */
  running: boolean
}>()

defineEmits<{
  'toggle-act': [requestId: string]
  roll: [requestId: string]
  reroll: [requestId: string]
  'add-die': [requestId: string]
  submit: [requestId: string]
  'roll-all': []
  'submit-ready': []
  close: []
}>()

const first = computed(() => props.views[0]?.request?.data ?? {})
const canRollAll = computed(() => props.views.some((v) => v.status === 'idle' && !v.busy))
const canSubmitReady = computed(() => props.views.some((v) => !!v.roll && (v.status === 'rolled' || v.status === 'failed') && !v.busy))

const STATUS: Record<string, { label: string; tone: string }> = {
  idle: { label: 'Not rolled', tone: 'bg-digimon-dark-600 text-digimon-dark-300' },
  rolled: { label: 'Rolled — ready to submit', tone: 'bg-blue-900/60 text-blue-300' },
  submitting: { label: 'Submitting…', tone: 'bg-blue-900/60 text-blue-300' },
  submitted: { label: 'Submitted', tone: 'bg-green-900/60 text-green-300' },
  failed: { label: 'Failed — roll kept', tone: 'bg-red-900/60 text-red-300' },
  unavailable: { label: 'No longer needed', tone: 'bg-digimon-dark-600 text-digimon-dark-400' },
}

function outcomeText(view: DefenseView): string {
  if (view.answeredElsewhere && !view.summary) return 'Already answered.'
  const s = view.summary
  if (!s) return 'Submitted.'
  if (!s.hit) return 'Dodged — no damage.'
  return s.finalDamage != null ? `Hit — ${s.finalDamage} damage.` : 'Hit.'
}
</script>

<template>
  <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" data-testid="area-defense-panel">
    <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto border-2 border-red-500">
      <h2 class="font-display text-xl font-semibold text-red-400 mb-1">⚔️ Defend Against {{ first.attackName || 'the Area Attack' }}</h2>
      <p class="text-sm text-white mb-4">
        <span class="font-semibold">{{ first.attackerName }}</span> hit
        {{ views.length }} of your characters ({{ first.accuracySuccesses }} accuracy successes). Defend each one below.
      </p>

      <div class="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          :disabled="!canRollAll || running"
          class="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="$emit('roll-all')"
        >🎲 Roll all unrolled</button>
        <button
          type="button"
          :disabled="!canSubmitReady || running"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="$emit('submit-ready')"
        >Submit ready defenses</button>
        <span class="ml-auto self-center text-xs text-digimon-dark-400">Inspiration: {{ inspiration }}/{{ maxInspiration }}</span>
      </div>

      <ul class="space-y-3">
        <li
          v-for="view in views"
          :key="view.requestId"
          class="bg-digimon-dark-700 rounded-lg p-4 border"
          :class="view.status === 'submitted' ? 'border-green-700' : view.status === 'failed' ? 'border-red-600' : 'border-digimon-dark-600'"
          :data-status="view.status"
        >
          <div class="flex items-start justify-between gap-2 mb-2">
            <div>
              <div class="text-white font-semibold">{{ nameFor(view.request) }}</div>
              <div class="text-xs text-digimon-dark-300 mt-0.5">
                <template v-if="view.defense.blocked">Cannot dodge</template>
                <template v-else>Dodge pool {{ view.defense.pool }}d6 <span class="text-digimon-dark-400">(5+ = success)</span></template>
              </div>
              <div v-if="view.defense.modifiers.length" class="flex flex-wrap gap-1 mt-1">
                <span
                  v-for="mod in view.defense.modifiers"
                  :key="mod.label"
                  class="text-xs px-1.5 py-0.5 rounded"
                  :class="mod.value < 0 ? 'bg-red-900/40 text-red-300' : 'bg-green-900/40 text-green-300'"
                >{{ mod.label }} {{ mod.value > 0 ? '+' : '' }}{{ mod.value }}</span>
              </div>
            </div>
            <span class="text-xs px-2 py-1 rounded whitespace-nowrap" :class="STATUS[view.status]?.tone">{{ STATUS[view.status]?.label }}</span>
          </div>

          <p v-if="view.defense.blocked" class="mb-2 p-2 bg-red-900/40 rounded border border-red-600 text-red-300 text-xs">
            Locked in a clash — this attack hits automatically.
          </p>

          <!-- Before the roll: Act of Inspiration for this target -->
          <label
            v-if="view.status === 'idle' && !view.defense.blocked"
            class="flex items-center gap-2 mb-2 text-sm"
            :class="inspiration < actCost && !view.actOfInspiration ? 'opacity-50' : 'cursor-pointer'"
          >
            <input
              type="checkbox"
              :checked="view.actOfInspiration"
              :disabled="view.busy || (inspiration < actCost && !view.actOfInspiration)"
              class="rounded border-digimon-dark-500 bg-digimon-dark-600 text-yellow-500"
              @change="$emit('toggle-act', view.requestId)"
            />
            <span class="text-yellow-400 font-medium">⚡ Act of Inspiration (spend {{ actCost }})</span>
            <span class="text-xs text-digimon-dark-400 ml-auto">+5 dice</span>
          </label>

          <button
            v-if="view.status === 'idle'"
            type="button"
            :disabled="view.busy || running"
            class="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
            @click="$emit('roll', view.requestId)"
          >{{ view.busy ? 'Rolling…' : '🎲 Roll Dodge' }}</button>

          <!-- The roll -->
          <div v-if="view.roll" class="text-center">
            <div class="flex flex-wrap justify-center gap-1 mb-1">
              <span
                v-for="(die, idx) in view.roll.rolls"
                :key="idx"
                class="w-7 h-7 flex items-center justify-center rounded font-bold text-sm"
                :class="die >= 5 ? 'bg-green-600 text-white' : 'bg-digimon-dark-600 text-digimon-dark-400'"
              >{{ die }}</span>
              <span v-if="!view.roll.rolls.length" class="text-xs text-digimon-dark-400">No dice</span>
            </div>
            <div class="text-2xl font-bold text-blue-400">
              {{ view.roll.successes }} <span class="text-sm text-digimon-dark-400">successes</span>
            </div>
          </div>

          <!-- After the roll, before it is sent: spend Inspiration on this target -->
          <div
            v-if="view.roll && (view.status === 'rolled' || view.status === 'failed')"
            class="grid grid-cols-2 gap-2 mt-2"
          >
            <button
              type="button"
              :disabled="view.busy || inspiration < 1"
              class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
              @click="$emit('reroll', view.requestId)"
            >🎲 Re-roll (1 Inspiration)</button>
            <button
              type="button"
              :disabled="view.busy || inspiration < 1"
              class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
              @click="$emit('add-die', view.requestId)"
            >➕ +1 Die (1 Inspiration)</button>
          </div>

          <p v-if="view.error" class="mt-2 text-xs text-red-300" role="alert">{{ view.error }}</p>

          <button
            v-if="view.roll && (view.status === 'rolled' || view.status === 'failed')"
            type="button"
            :disabled="view.busy || running"
            class="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
            @click="$emit('submit', view.requestId)"
          >{{ view.status === 'failed' ? 'Retry submit (same roll)' : 'Submit this defense' }}</button>

          <p v-if="view.status === 'submitted'" class="mt-2 text-sm text-green-300">{{ outcomeText(view) }}</p>
        </li>
      </ul>

      <div v-if="settled" class="mt-4 flex items-center justify-between gap-3">
        <span class="text-xs text-digimon-dark-400">All defenses are in. This closes by itself in a few seconds.</span>
        <button
          type="button"
          class="bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="$emit('close')"
        >Close</button>
      </div>
    </div>
  </div>
</template>
