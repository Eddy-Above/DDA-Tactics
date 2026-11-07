// The gesture for dragging a token that is already on the map to a new cell. Every DOM and
// Three.js effect goes through an injected adapter, so the lifecycle — the part that can go wrong
// in ways a player notices (camera stuck off, a stray click opening a menu, a drop that ignores
// the rules) — is testable without a canvas. MapCanvas supplies the real adapter.
import type { Vec3 } from '~/types'
import { createDragTracker } from '~/utils/placementRules'

/** The slice of a PointerEvent the gesture reads. */
export interface TokenDragPointer {
  clientX: number
  clientY: number
  button?: number
  isPrimary?: boolean
}

export interface TokenDragAdapter<E extends TokenDragPointer> {
  /** Participants the viewer may drag right now. */
  draggableIds(): string[] | undefined
  /** False while another mode owns the left button (map editing, move/attack aiming, click placement…). */
  allowed(): boolean
  /** The participant whose token the press landed on, or null. */
  tokenAt(event: E): string | null
  /** Draw where a drop at the pointer would land (valid or refused). */
  preview(event: E, participantId: string): void
  /** The cell a drop at the pointer would land on, or null when the rules refuse it. */
  resolveDrop(event: E, participantId: string): Vec3 | null
  /** Commit a drop that passed the rules. */
  commit(participantId: string, cell: Vec3): void
  clearPreview(): void
  /** Switch the camera controls off for the duration of a press, and back on afterwards. */
  lockCamera(): void
  unlockCamera(): void
  setCursor(cursor: string): void
  /** The pointer travelled far enough that this is a drag: dismiss radials/popups. */
  begin(): void
  /** Eat the `click` the browser fires after the release, so it can't open a menu under the cursor. */
  swallowNextClick(): void
}

export function createTokenDragController<E extends TokenDragPointer>(
  adapter: TokenDragAdapter<E>,
  threshold = 4,
) {
  const tracker = createDragTracker<string>(threshold)
  let started = false   // threshold crossed
  let aborted = false   // Escape pressed: the gesture is dead, but its release still has to be handled

  const live = () => tracker.isPressed() || aborted

  // Every way out of a gesture ends here, so the camera is always handed back.
  function finish() {
    tracker.cancel()
    started = false
    aborted = false
    adapter.unlockCamera()
    adapter.setCursor('')
    adapter.clearPreview()
  }

  return {
    pointerDown(event: E) {
      if (event.button !== 0 || event.isPrimary === false) return
      if (!adapter.draggableIds()?.length || !adapter.allowed()) return
      const participantId = adapter.tokenAt(event)
      if (!participantId || !adapter.draggableIds()!.includes(participantId)) return
      tracker.press(event.clientX, event.clientY, participantId)
      adapter.lockCamera()   // before the camera controls' own pointerdown gets a chance to start panning
    },

    pointerMove(event: E) {
      if (!tracker.move(event.clientX, event.clientY)) return
      const participantId = tracker.subject()
      if (participantId === null) return
      if (!started) {
        started = true
        adapter.begin()
        adapter.setCursor('grabbing')
      }
      adapter.preview(event, participantId)
    },

    pointerUp(event: E) {
      if (!live()) return
      const released = tracker.release()
      const wasAborted = aborted
      finish()
      if (wasAborted) { adapter.swallowNextClick(); return }
      if (!released?.dragged) return   // a plain click: the ordinary click handlers take it from here
      adapter.swallowNextClick()
      const cell = adapter.resolveDrop(event, released.subject)
      // The offer can lapse mid-drag (phase change, unit removed), so check it again at the drop.
      if (cell && adapter.draggableIds()?.includes(released.subject)) adapter.commit(released.subject, cell)
    },

    pointerCancel() {
      if (live()) finish()
    },

    /** Escape. Returns true when it ended a gesture, so the caller knows the key was used. */
    abort(): boolean {
      if (!tracker.isPressed()) return false
      tracker.cancel()
      aborted = true
      adapter.setCursor('')
      adapter.clearPreview()
      return true
    },

    /** True between a press and the pointer's release (not after Escape). */
    isPressed: () => tracker.isPressed(),
    /** Teardown: hand the camera back if the component goes away mid-gesture. */
    dispose() {
      if (live()) finish()
    },
  }
}
