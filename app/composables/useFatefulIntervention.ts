import { ref } from 'vue'
import { applyFatefulCheck, applyFatefulPool, type FatefulChoice } from '../utils/fatefulIntervention'

export interface FatefulRollTarget {
  id: string
  label: string
  rollType: 'accuracy' | 'dodge' | 'check'
  baseDicePool: number
  baseModifier?: number
  successThreshold?: number
  automaticSuccesses?: number
  requestId?: string
  targetParticipantId?: string
  isCurrent: () => boolean
  apply: (result: any) => void | Promise<void>
}

export function useFatefulIntervention(options: {
  rolls: () => FatefulRollTarget[]
  willpower: () => number
  cost: () => number
  pay: (target: FatefulRollTarget, choice: FatefulChoice) => Promise<boolean>
}) {
  const visible = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)

  async function confirm(id: string, choice: FatefulChoice) {
    if (busy.value) return false
    const target = options.rolls().find(r => r.id === id)
    if (!target?.isCurrent()) {
      error.value = 'That roll is no longer waiting. Choose a current roll.'
      return false
    }
    busy.value = true
    error.value = null
    try {
      const result = target.rollType === 'check'
        ? { ...applyFatefulCheck(target.baseModifier ?? 0, options.willpower(), choice), fatefulIntervention: true }
        : { ...applyFatefulPool(target.baseDicePool, options.willpower(), choice, target.successThreshold),
          successThreshold: target.successThreshold ?? 5, automaticSuccesses: target.automaticSuccesses ?? 0,
          fatefulIntervention: true }
      if ('successes' in result) result.successes += target.automaticSuccesses ?? 0
      if (!(await options.pay(target, choice))) {
        error.value = 'Inspiration could not be spent. The roll is unchanged.'
        return false
      }
      // Payment and request updates may have removed the target. Never replace a different roll.
      if (target.isCurrent()) await target.apply(result)
      visible.value = false
      return true
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Could not apply Fateful Intervention.'
      return false
    } finally { busy.value = false }
  }

  return {
    visible, busy, error, confirm,
    open: () => { error.value = null; visible.value = true },
    close: () => { if (!busy.value) visible.value = false },
  }
}
