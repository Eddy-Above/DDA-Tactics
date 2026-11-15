// The gentle lighting effect does not need to redraw a stationary scene at display refresh rate.
export const MAP_LIGHT_ANIMATION_INTERVAL_MS = 50

type TimerClock = {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void
}

export function createMapLightAnimationClock(requestFrame: () => void, clock: TimerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: id => clearTimeout(id),
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let visible = true
  let disposed = false

  function cancel() {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }

  return {
    get visible() { return visible && !disposed },
    cancel,
    schedule(frameStartedAt: number) {
      cancel()
      if (!visible || disposed) return
      const delay = Math.max(0, MAP_LIGHT_ANIMATION_INTERVAL_MS - (clock.now() - frameStartedAt))
      timer = clock.setTimeout(() => {
        timer = null
        if (visible && !disposed) requestFrame()
      }, delay)
    },
    setVisible(value: boolean) {
      visible = value
      if (!visible) cancel()
    },
    dispose() {
      disposed = true
      cancel()
    },
  }
}
