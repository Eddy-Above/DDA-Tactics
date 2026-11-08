import { computed, reactive, ref } from 'vue'
import type { RewardRequest, RewardResult, RewardRoster } from '../types/rewards'
import { normalizeRewardRequest, sameRewardRequest } from '../utils/rewards'

export function useRewardGrant(options: {
  load: () => Promise<RewardRoster>
  send: (request: RewardRequest) => Promise<RewardResult>
  newId?: () => string
}) {
  const roster = ref<RewardRoster>({ tamers: [], digimon: [] })
  const selectedTamerIds = ref<string[]>([]), selectedDigimonIds = ref<string[]>([])
  const amounts = reactive({ tamerXp: 0, tamerInspiration: 0, digimonBonusDP: 0 })
  const loading = ref(false), busy = ref(false), needsVerification = ref(false), rosterReady = ref(false)
  const error = ref<string | null>(null), success = ref<RewardResult | null>(null)
  let pending: RewardRequest | null = null
  const draft = () => ({ requestId: 'preview', tamerIds: selectedTamerIds.value, digimonIds: selectedDigimonIds.value, ...amounts })
  const validationMessage = computed(() => {
    try { normalizeRewardRequest(draft()); return null }
    catch (e: any) { return e.message as string }
  })
  const selectedPartners = computed(() => roster.value.digimon.filter(d => selectedDigimonIds.value.includes(d.id)))
  async function load() {
    loading.value = true
    rosterReady.value = false
    error.value = null
    try {
      roster.value = await options.load()
      selectedTamerIds.value = selectedTamerIds.value.filter(id => roster.value.tamers.some(p => p.id === id))
      selectedDigimonIds.value = selectedDigimonIds.value.filter(id => roster.value.digimon.some(d => d.id === id && selectedTamerIds.value.includes(d.partnerId)))
      needsVerification.value = false
      rosterReady.value = true
      return true
    } catch (e: any) {
      needsVerification.value = (e.statusCode ?? e.status ?? e.data?.statusCode) === 403
      error.value = e.data?.message ?? e.message ?? 'Could not load reward recipients'
      return false
    } finally { loading.value = false }
  }
  function toggleTamer(id: string) {
    if (busy.value || !roster.value.tamers.some(t => t.id === id)) return
    if (selectedTamerIds.value.includes(id)) {
      selectedTamerIds.value = selectedTamerIds.value.filter(current => current !== id)
      selectedDigimonIds.value = selectedDigimonIds.value.filter(current => !roster.value.digimon.some(d => d.id === current && d.partnerId === id))
    } else {
      selectedTamerIds.value = [...selectedTamerIds.value, id]
      selectedDigimonIds.value = [...new Set([...selectedDigimonIds.value, ...roster.value.digimon.filter(d => d.partnerId === id).map(d => d.id)])]
    }
  }
  function toggleDigimon(id: string) {
    if (busy.value || !roster.value.digimon.some(d => d.id === id && selectedTamerIds.value.includes(d.partnerId))) return
    selectedDigimonIds.value = selectedDigimonIds.value.includes(id) ? selectedDigimonIds.value.filter(current => current !== id) : [...selectedDigimonIds.value, id]
  }
  function selectAll() {
    if (busy.value) return
    selectedTamerIds.value = roster.value.tamers.map(p => p.id)
    selectedDigimonIds.value = roster.value.digimon.map(d => d.id)
  }
  function clearSelection() { if (!busy.value) { selectedTamerIds.value = []; selectedDigimonIds.value = [] } }
  async function grant() {
    if (busy.value || loading.value || !rosterReady.value) return false
    error.value = null
    success.value = null
    try {
      const request = normalizeRewardRequest(draft())
      const same = pending && sameRewardRequest({ ...pending, requestId: 'preview' }, request)
      pending = { ...request, requestId: same ? pending!.requestId : (options.newId?.() ?? crypto.randomUUID()) }
      busy.value = true
      const result = await options.send(pending)
      success.value = result
      pending = null
      amounts.tamerXp = 0; amounts.tamerInspiration = 0; amounts.digimonBonusDP = 0
      await load()
      return true
    } catch (e: any) {
      error.value = e.data?.message ?? e.message ?? 'Could not grant rewards'
      return false
    } finally { busy.value = false }
  }
  return { roster, selectedTamerIds, selectedDigimonIds, selectedPartners, amounts, loading, busy, error, success, needsVerification, rosterReady,
    validationMessage, load, toggleTamer, toggleDigimon, selectAll, clearSelection, grant }
}
