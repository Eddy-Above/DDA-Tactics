import { computed, ref } from 'vue'
import { getActiveTemporaryPass, type TemporaryIntercedePass } from '../utils/intercedeOptOuts'

type PassEncounter = Parameters<typeof getActiveTemporaryPass>[0] & { id: string }

export interface IntercedePassAdapters {
  /** The encounter this player is in (read reactively), or null. */
  encounter: () => PassEncounter | null
  /** The player's tamer entity id — the owner id their intercede offers are addressed to. */
  ownerId: () => string | null | undefined
  /** POSTs to `intercede-pass` and resolves to the encounter the server returned. */
  send: (encounterId: string, body: { ownerId: string; action: 'start' | 'resume' }) => Promise<unknown>
  /** Applies that encounter to page state (the page's gated `applyActionResult`). */
  apply: (result: unknown) => Promise<void>
  /** Reports a failed request to the player. */
  onError?: (message: string) => void
}

/**
 * "Pass until my next turn" for the player page. The preference itself lives on the encounter
 * (`intercedeOptOuts.temporaryPasses`) and is derived from it, so every open tab, the reconnect
 * resync and the expiry at the character's next turn all show the right state without any local
 * bookkeeping. This composable only starts and ends the pass and keeps the buttons from firing
 * twice.
 */
export function useIntercedePass(adapters: IntercedePassAdapters) {
  const busy = ref(false)
  const myPass = computed<TemporaryIntercedePass | null>(() => getActiveTemporaryPass(adapters.encounter(), adapters.ownerId()))
  const isPassing = computed(() => myPass.value !== null)

  async function change(action: 'start' | 'resume'): Promise<boolean> {
    const encounter = adapters.encounter()
    const ownerId = adapters.ownerId()
    if (!encounter || !ownerId || busy.value) return false
    busy.value = true
    try {
      const result = await adapters.send(encounter.id, { ownerId, action })
      await adapters.apply(result)
      return true
    } catch (e: any) {
      adapters.onError?.(e?.data?.message || (action === 'start' ? 'Failed to pass on interceding' : 'Failed to resume prompting'))
      return false
    } finally {
      busy.value = false
    }
  }

  return {
    busy,
    myPass,
    isPassing,
    /** "Pass until my next turn": answers waiting prompts and every new one until the next turn starts. */
    start: () => change('start'),
    /** "Resume prompting": ends the pass early. */
    resume: () => change('resume'),
  }
}
