import { computed, ref } from 'vue'

export interface SpecialOrderChoice {
  partnerId?: string
  targetId?: string
  effectId?: string
  requestId?: string
}

export function useSpecialOrderTargets(options: {
  participants: () => any[]
  digimon: () => any[]
  nameFor: (participant: any) => string
  send: (participant: any, orderName: string, choice: SpecialOrderChoice) => Promise<boolean>
}) {
  const selection = ref<{ participant: any; orderName: string } | null>(null)
  const busy = ref(false)
  const partnersFor = (participant: any) => options.participants().filter(p => p.type === 'digimon' && !p.inReserve && !p.isEnemy
    && options.digimon().some(d => d.id === p.entityId && d.partnerId === participant.entityId))
  const partners = computed(() => selection.value ? partnersFor(selection.value.participant).map(p => ({
    id: p.id, name: options.nameFor(p),
    effects: (p.activeEffects ?? []).filter((e: any) => e.type === 'debuff' || e.type === 'status').map((e: any) => ({ id: e.id, name: e.name })),
  })) : [])
  const targets = computed(() => selection.value ? options.participants().filter(p => (p.type === 'digimon' || (selection.value!.orderName === 'Swagger' && p.type === 'tamer')) && !p.inReserve
    && !!p.isEnemy !== !!selection.value!.participant.isEnemy).map(p => ({ id: p.id, name: options.nameFor(p) })) : [])

  async function open(participant: any, orderName: string) {
    if (busy.value) return
    if (['Swagger', 'Enemy Scan', 'Tough it Out!'].includes(orderName) || partnersFor(participant).length > 1) {
      selection.value = { participant, orderName }
      return
    }
    busy.value = true
    try { await options.send(participant, orderName, { partnerId: partnersFor(participant)[0]?.id }) }
    finally { busy.value = false }
  }

  async function confirm(choice: SpecialOrderChoice) {
    const selected = selection.value
    if (!selected || busy.value) return
    busy.value = true
    selection.value = null
    try {
      if (!await options.send(selected.participant, selected.orderName, choice) && !selection.value) selection.value = selected
    } catch (error) {
      if (!selection.value) selection.value = selected
      throw error
    } finally { busy.value = false }
  }

  return { selection, partners, targets, busy, open, confirm, close: () => { if (!busy.value) selection.value = null } }
}
