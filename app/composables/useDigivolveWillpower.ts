import { computed, ref, shallowRef, type Ref } from 'vue'
import type { Tamer } from '~/server/db/schema'
import type { CombatParticipant } from '~/composables/useEncounters'
import { DIGIVOLVE_WILLPOWER_DC, type CampaignLevel } from '~/types'

export interface DigivolveWillpowerTarget {
  chainIndex: number
  species: string
}

export interface PendingDigivolveWillpower {
  participant: CombatParticipant
  targetChainIndex: number
  targetSpecies: string
  tamer: Tamer
}

export interface WillpowerRollResult {
  rolls: number[]
  total: number
}

interface DigivolveWillpowerOptions {
  campaignLevel: Readonly<Ref<CampaignLevel>>
  warpEnabled: () => boolean
  getEncounterId: () => string | null
  getTamerParticipant: (tamerId: string) => { id: string; currentInspiration?: number } | null
  getWarpTargets: (participant: CombatParticipant) => readonly DigivolveWillpowerTarget[]
  spendInspiration: (encounterId: string, participantId: string) => Promise<unknown>
  refresh: () => Promise<unknown>
  afterReroll?: () => Promise<unknown>
  inspirationLoading?: Ref<boolean>
  onError: (message: string) => void
  random?: () => number
}

function parseStoredJson<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data && 'message' in data && typeof data.message === 'string') {
      return data.message
    }
  }
  return fallback
}

/** Shared check and request lifecycle; each page supplies its own refresh and Inspiration state. */
export function useDigivolveWillpower(options: DigivolveWillpowerOptions) {
  const pendingDigivolve = shallowRef<PendingDigivolveWillpower | null>(null)
  const rollResult = ref<WillpowerRollResult | null>(null)
  const warpChoice = ref<DigivolveWillpowerTarget | null>(null)
  const rerollLoading = ref(false)
  const submitting = ref(false)
  const loading = computed(() => rerollLoading.value || submitting.value || !!options.inspirationLoading?.value)
  const dc = computed(() => DIGIVOLVE_WILLPOWER_DC[options.campaignLevel.value])
  const modifier = computed(() => {
    const tamer = pendingDigivolve.value?.tamer
    if (!tamer) return 0
    const attributes = parseStoredJson(tamer.attributes)
    const xpBonuses = parseStoredJson(tamer.xpBonuses)
    return (attributes?.willpower || 0) + (xpBonuses?.attributes?.willpower || 0)
  })
  const tamerParticipant = computed(() => {
    const tamer = pendingDigivolve.value?.tamer
    return tamer ? options.getTamerParticipant(tamer.id) : null
  })
  const inspiration = computed(() => tamerParticipant.value?.currentInspiration ?? 0)
  const warpTargets = computed(() => pendingDigivolve.value
    ? options.getWarpTargets(pendingDigivolve.value.participant)
    : [])
  const warpAvailable = computed(() => options.warpEnabled()
    && !!rollResult.value
    && rollResult.value.total >= dc.value + 5
    && warpTargets.value.length > 0)

  function reset() {
    pendingDigivolve.value = null
    rollResult.value = null
    warpChoice.value = null
  }

  function open(pending: PendingDigivolveWillpower) {
    if (loading.value) return
    reset()
    pendingDigivolve.value = pending
  }

  function rollDice() {
    const random = options.random ?? Math.random
    const rolls = Array.from({ length: 3 }, () => Math.floor(random() * 6) + 1)
    rollResult.value = { rolls, total: rolls.reduce((sum, die) => sum + die, 0) + modifier.value }
    warpChoice.value = null
  }

  function roll() {
    if (!pendingDigivolve.value || rollResult.value || loading.value) return
    rollDice()
  }

  function cancel() {
    // A rolled check must be resolved; closing must never discard a failed roll.
    if (rollResult.value || loading.value) return
    reset()
  }

  function toggleWarp(target: DigivolveWillpowerTarget) {
    if (loading.value || !warpAvailable.value) return
    const available = warpTargets.value.find(option => option.chainIndex === target.chainIndex)
    if (!available) return
    warpChoice.value = warpChoice.value?.chainIndex === target.chainIndex ? null : { ...available }
  }

  async function reroll() {
    const encounterId = options.getEncounterId()
    const participant = tamerParticipant.value
    if (!encounterId || !participant || !rollResult.value || rollResult.value.total >= dc.value
      || inspiration.value < 1 || loading.value) return

    rerollLoading.value = true
    if (options.inspirationLoading) options.inspirationLoading.value = true
    try {
      const result = await options.spendInspiration(encounterId, participant.id)
      if (!result) {
        options.onError('Failed to spend Inspiration')
        return
      }
      rollDice()
      await options.afterReroll?.()
    } finally {
      rerollLoading.value = false
      if (options.inspirationLoading) options.inspirationLoading.value = false
    }
  }

  async function submit() {
    const encounterId = options.getEncounterId()
    const pending = pendingDigivolve.value
    const result = rollResult.value
    if (!encounterId || !pending || !result || loading.value) return

    submitting.value = true
    const passed = result.total >= dc.value
    const warp = warpAvailable.value ? warpChoice.value : null
    try {
      if (passed) {
        await $fetch(`/api/encounters/${encounterId}/actions/digivolve`, {
          method: 'POST',
          body: {
            participantId: pending.participant.id,
            targetChainIndex: warp?.chainIndex ?? pending.targetChainIndex,
            ...(warp ? { rollTotal: result.total } : {}),
          },
        })
      } else {
        await $fetch(`/api/encounters/${encounterId}/actions/digivolve-fail`, {
          method: 'POST',
          body: {
            participantId: pending.participant.id,
            targetSpecies: pending.targetSpecies,
            rollTotal: result.total,
            dc: dc.value,
          },
        })
      }
    } catch (error: unknown) {
      console.error(passed ? 'Digivolve failed:' : 'Digivolve fail logging failed:', error)
      if (passed) options.onError(errorMessage(error, 'Failed to digivolve'))
    } finally {
      reset()
      try {
        await options.refresh()
      } finally {
        submitting.value = false
      }
    }
  }

  return {
    pendingDigivolve, rollResult, warpChoice, modifier, dc, warpAvailable, warpTargets,
    inspiration, loading, submitting, open, roll, reroll, cancel, submit, toggleWarp,
  }
}
