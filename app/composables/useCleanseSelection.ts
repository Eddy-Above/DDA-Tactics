import { computed, ref } from 'vue'
import type { CleanseMode, CleanseSelection } from '../utils/cleanse'

export function useCleanseSelection(deps: {
  encounter: () => { id: string; participants: any[]; pendingRequests: any[] } | null | undefined
  ownerId: () => string | null | undefined
  send: (encounterId: string, body: { requestId: string; ownerId: string; mode: CleanseMode; selections: CleanseSelection[] }) => Promise<any>
  apply: (encounter: any) => Promise<unknown>
}) {
  const request = computed(() => deps.encounter()?.pendingRequests.find(request =>
    request.type === 'cleanse-select' && request.data?.ready && request.targetTamerId === deps.ownerId()))
  const busy = ref(false)
  const error = ref('')
  async function submit(mode: CleanseMode, selections: CleanseSelection[]) {
    const encounter = deps.encounter(), current = request.value, ownerId = deps.ownerId()
    if (!encounter || !current || !ownerId || busy.value) return
    busy.value = true
    error.value = ''
    try {
      const result = await deps.send(encounter.id, { requestId: current.id, ownerId, mode, selections })
      if (!result) throw new Error('Cleanse could not be saved')
      if (deps.encounter()?.id === encounter.id) await deps.apply(result)
    } catch (cause: any) {
      error.value = cause?.data?.message ?? cause?.message ?? 'Cleanse could not be saved'
    } finally { busy.value = false }
  }
  return { request, busy, error, submit }
}
