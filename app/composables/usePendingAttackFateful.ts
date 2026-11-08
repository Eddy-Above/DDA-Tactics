import { getCurrentScope, onScopeDispose, shallowRef } from 'vue'
import type { PreparedAttackAccuracy } from '../utils/attackAccuracy'
import type { FatefulRollTarget } from './useFatefulIntervention'

/** Hold an outgoing GM roll until Fateful has been applied or cancelled. */
export function usePendingAttackFateful() {
  const target = shallowRef<FatefulRollTarget | null>(null)
  let finish: ((roll: PreparedAttackAccuracy | null) => void) | null = null
  let sequence = 0
  function settle(roll: PreparedAttackAccuracy | null) {
    const resolve = finish
    finish = null
    target.value = null
    resolve?.(roll)
  }
  function request(roll: PreparedAttackAccuracy, label: string, isCurrent: () => boolean) {
    settle(null)
    return new Promise<PreparedAttackAccuracy | null>(resolve => {
      finish = resolve
      const id = `outgoing-accuracy-${Date.now()}-${++sequence}`
      target.value = { id, label, rollType: 'accuracy', baseDicePool: roll.dicePool,
        successThreshold: roll.successThreshold, automaticSuccesses: roll.automaticSuccesses,
        isCurrent: () => target.value?.id === id && isCurrent(),
        apply: result => settle({ ...roll, ...result, originalRolls: [...result.rolls], hadHugePowerRerolls: false }) }
    })
  }
  if (getCurrentScope()) onScopeDispose(() => settle(null))
  return { target, request, cancel: () => settle(null) }
}
