import { onScopeDispose, watch } from 'vue'

/** How long a completed combat result stays up before it dismisses itself. */
export const RESULT_AUTO_DISMISS_MS = 5000

export interface AutoDismissOptions {
  /**
   * Identity of the completed result currently on screen, or null/undefined when there is none.
   * A dialog that is still waiting on a player's decision must return null, so only finished
   * results ever time out. A different key means a different result: the countdown restarts.
   */
  key: () => string | number | null | undefined
  /**
   * The one cleanup path. Both the timer and the Close button run it through `dismiss()`, so
   * automatic and manual dismissal clear exactly the same requests, responses and state.
   */
  cleanup: () => void | Promise<void>
  delayMs?: number
}

/**
 * Dismisses a completed result `delayMs` after it becomes visible.
 *
 * The countdown starts when `key` becomes non-null, restarts when it changes, and is cancelled
 * when the result goes away, when `dismiss()` runs and when the owning scope (component) is
 * disposed. `dismiss()` is the only way `cleanup` runs, and it ignores another call for the same
 * result while its cleanup is in flight. A replacement result keeps its own dismissal lifecycle.
 */
export function useAutoDismiss(options: AutoDismissOptions) {
  const delayMs = options.delayMs ?? RESULT_AUTO_DISMISS_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  const running = new Set<ReturnType<AutoDismissOptions['key']>>()

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function dismiss() {
    const key = options.key()
    if (running.has(key)) return
    cancel()
    running.add(key)
    try {
      await options.cleanup()
    } finally {
      running.delete(key)
    }
  }

  watch(options.key, (key) => {
    cancel()
    if (key === null || key === undefined) return
    timer = setTimeout(() => {
      timer = null
      dismiss().catch((error) => console.error('Automatic dismissal failed:', error))
    }, delayMs)
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(cancel)

  return { dismiss, cancel, isPending: () => timer !== null }
}
