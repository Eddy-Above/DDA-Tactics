import { computed, ref } from 'vue'
import { getUnlockedSpecialOrders } from '../utils/specialOrders'
import { isRequestAnswered } from '../utils/requestState'

export interface ReactionOrderOption {
  key: string
  requestId: string
  participantId: string
  partnerId: string
  label: string
  quickReaction: boolean
  strikeLast: boolean
  resolved?: boolean
}

export function useReactionOrders(options: {
  encounter: () => any
  requests: () => any[]
  tamers: () => any[]
  digimon: () => any[]
  campaignLevel: () => 'standard' | 'enhanced' | 'extreme'
  nameFor: (participant: any) => string
  canControl: (participant: any) => boolean
  send: (option: ReactionOrderOption, order: 'Quick Reaction' | 'Strike Last!') => Promise<boolean>
  onSkip?: (option: ReactionOrderOption) => void | Promise<void>
}) {
  const declined = ref(new Set<string>())
  const busy = ref(false)
  const choices = computed<ReactionOrderOption[]>(() => {
    const encounter = options.encounter()
    if (!encounter || encounter.phase !== 'combat') return []
    const result = new Map<string, ReactionOrderOption>()
    for (const request of options.requests()) {
      if (!['intercede-offer', 'dodge-roll', 'strike-last-offer'].includes(request.type) || isRequestAnswered(request, encounter.requestResponses ?? [])) continue
      const data = request.data ?? {}
      if (request.type === 'strike-last-offer' && data.resolvedRound !== encounter.round) continue
      const attacker = encounter.participants.find((p: any) => p.id === (data.attackerParticipantId ?? data.attackerId))
      if (attacker?.type !== 'digimon') continue
      const targetIds = new Set([request.targetParticipantId, data.targetId, ...(data.targetIds ?? []), ...(data.originalTargetIds ?? []), ...(data.tamerAreaTargetIds ?? []), ...(data.digimonAreaTargetIds ?? [])])
      for (const partner of encounter.participants.filter((p: any) => p.type === 'digimon' && !p.inReserve && targetIds.has(p.id) && !!p.isEnemy !== !!attacker.isEnemy)) {
        const digimon = options.digimon().find(d => d.id === partner.entityId)
        const tamer = options.tamers().find(t => t.id === digimon?.partnerId)
        const participant = encounter.participants.find((p: any) => p.type === 'tamer' && p.entityId === tamer?.id && !p.inReserve)
        if (!tamer || !participant || !options.canControl(participant)) continue
        const unlocked = getUnlockedSpecialOrders(tamer.attributes, tamer.xpBonuses, options.campaignLevel())
        const available = (name: string) => unlocked.some(o => o.name === name) && !(tamer.usedPerDayOrders ?? []).includes(name)
        const key = `${encounter.id}:${data.intercedeGroupId ?? request.id}:${partner.id}`
        if (declined.value.has(key)) continue
        const choice = {
          key, requestId: request.id, participantId: participant.id, partnerId: partner.id,
          label: `${options.nameFor(partner)} vs ${data.attackName ?? 'incoming attack'}`,
          quickReaction: request.type === 'intercede-offer' && !!data.canUseQuickReaction && available('Quick Reaction'),
          strikeLast: available('Strike Last!') && !partner.strikeLastCounter,
          resolved: request.type === 'strike-last-offer',
        }
        if (!choice.quickReaction && !choice.strikeLast) continue
        const previous = result.get(key)
        if (!previous || choice.quickReaction) result.set(key, choice)
      }
    }
    return [...result.values()]
  })

  async function declare(option: ReactionOrderOption, order: 'Quick Reaction' | 'Strike Last!') {
    if (busy.value) return
    busy.value = true
    try { await options.send(option, order) }
    finally { busy.value = false }
  }

  function canDeclareStrikeLast(request: any) {
    const group = request?.data?.intercedeGroupId
    return choices.value.some(c => c.strikeLast && (c.requestId === request.id || (group && c.key.includes(`:${group}:`) && c.partnerId === request.targetParticipantId)))
  }

  return { choices, busy, declare, canDeclareStrikeLast, skip: (choice: ReactionOrderOption) => { declined.value.add(choice.key); void options.onSkip?.(choice) } }
}
