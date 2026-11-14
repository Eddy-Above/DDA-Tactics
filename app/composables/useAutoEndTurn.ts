import { onScopeDispose, watch } from 'vue'

export const AUTO_END_TURN_MS = 10_000

/** Count from action exhaustion, even while an attack is still resolving. */
export function useAutoEndTurn(options: {
  key: () => string | null
  blocked: () => boolean
  endTurn: () => Promise<void>
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let due = false
  let attempted = false

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    due = false
  }

  function finish() {
    if (!due || attempted || !options.key() || options.blocked()) return
    attempted = true
    options.endTurn().catch(error => console.error('Automatic end turn failed:', error))
  }

  watch(options.key, key => {
    cancel()
    attempted = false
    if (!key) return
    timer = setTimeout(() => {
      timer = null
      due = true
      finish()
    }, AUTO_END_TURN_MS)
  }, { immediate: true, flush: 'sync' })

  watch(options.blocked, finish, { flush: 'sync' })
  onScopeDispose(cancel)
}
