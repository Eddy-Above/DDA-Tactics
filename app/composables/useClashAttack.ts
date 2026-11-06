import { computed, ref } from 'vue'
import type { Attack } from '../types'
import type { CombatParticipant } from './useEncounters'
import { getAreaShape } from '../utils/areaShapes'
import { prepareAttackAccuracy } from '../utils/attackAccuracy'

export interface ClashAreaAttackContext {
  controllerId: string
  opponentId: string
}

export interface ClashAttackRequest {
  clashId: string
  participantId: string
  tamerId?: string
  actionType: 'attack'
  attackId: string
  attackName: string
  accuracySuccesses: number
  accuracyDiceResults: number[]
  accuracyDicePool: number
  endClash: boolean
}

export interface ClashAttackDependencies {
  getEncounter: () => { id: string; participants: readonly CombatParticipant[] } | null | undefined
  canAct?: () => boolean
  getParticipantAttacks: (participant: CombatParticipant) => Attack[]
  getAttackStats: (participant: CombatParticipant, attack: Attack) => { accuracy: number }
  submitAttack: (encounterId: string, body: ClashAttackRequest) => Promise<unknown>
  refreshEncounter: (encounterId: string) => Promise<unknown>
  beginAreaAttack: (participant: CombatParticipant, attack: Attack) => void | Promise<void>
  beginChargeMove: (participantId: string) => void | Promise<void>
  onError: (message: string) => void
}

/** Shared controller attack flow. Pages retain their map, targeting and refresh adapters. */
export function useClashAttack(deps: ClashAttackDependencies) {
  const clashAttackActorId = ref<string | null>(null)
  const clashAreaAttack = ref<ClashAreaAttackContext | null>(null)
  const clashChargeChoice = ref<{ participant: CombatParticipant; attack: Attack } | null>(null)

  const clashAttackParticipant = computed(() =>
    deps.getEncounter()?.participants.find(p => p.id === clashAttackActorId.value),
  )
  const clashAttackOptions = computed(() => {
    const participant = clashAttackParticipant.value
    // The normal canUseAttack predicate excludes clashers, so retain the existing melee-only filter.
    return participant ? deps.getParticipantAttacks(participant).filter(a => a.range === 'melee') : []
  })

  function startClashAttack(participantId: string) {
    const participant = deps.getEncounter()?.participants.find(p => p.id === participantId)
    if (!participant?.clash?.isController) return
    clashAttackActorId.value = participantId
  }

  function cancelClashAttack() {
    clashAttackActorId.value = null
    clashChargeChoice.value = null
  }

  function backToClashAttacks() {
    clashChargeChoice.value = null
  }

  async function pickClashAttack(participant: CombatParticipant, attack: Attack) {
    const isCharge = (attack.tags ?? []).includes('Charge Attack')
    const isArea = getAreaShape(attack.tags ?? []) !== null
    if (isCharge && !isArea) {
      clashChargeChoice.value = { participant, attack }
      return
    }
    await confirmClashAttack(participant, attack)
  }

  async function chooseClashCharge(moveAfter: boolean) {
    const choice = clashChargeChoice.value
    clashChargeChoice.value = null
    if (choice) await confirmClashAttack(choice.participant, choice.attack, { endClash: moveAfter, moveAfter })
  }

  async function confirmClashAttack(
    participant: CombatParticipant,
    attack: Attack,
    options?: { endClash?: boolean; moveAfter?: boolean },
  ) {
    const encounter = deps.getEncounter()
    if (!encounter || (deps.canAct && !deps.canAct())) return
    const actorId = clashAttackActorId.value
    clashAttackActorId.value = null
    const clash = participant.clash
    if (!clash?.clashId || !actorId) return

    // Pass and other area attacks retain normal area aiming/movement and their page's final submit.
    if (getAreaShape(attack.tags ?? []) !== null) {
      clashAreaAttack.value = { controllerId: actorId, opponentId: clash.opponentParticipantId }
      await deps.beginAreaAttack(participant, attack)
      return
    }

    const accuracyPool = deps.getAttackStats(participant, attack).accuracy
    const { rolls: accuracyDiceResults, successes: accuracySuccesses } = prepareAttackAccuracy(accuracyPool)

    try {
      await deps.submitAttack(encounter.id, {
        clashId: clash.clashId,
        participantId: actorId,
        tamerId: participant.type === 'tamer' ? participant.entityId : undefined,
        actionType: 'attack',
        attackId: attack.id,
        attackName: attack.name,
        accuracySuccesses,
        accuracyDiceResults,
        accuracyDicePool: accuracyPool,
        endClash: options?.endClash ?? false,
      })
      await deps.refreshEncounter(encounter.id)
      // A Charge move starts only once the attack has resolved and the refreshed clash has ended.
      if (options?.moveAfter) await deps.beginChargeMove(actorId)
    } catch (error: unknown) {
      const message = (error as { data?: { message?: unknown } } | null)?.data?.message
      deps.onError(typeof message === 'string' && message ? message : 'Failed to execute clash attack')
    }
  }

  return {
    clashAttackActorId,
    clashAttackParticipant,
    clashAttackOptions,
    clashChargeChoice,
    clashAreaAttack,
    startClashAttack,
    pickClashAttack,
    chooseClashCharge,
    confirmClashAttack,
    cancelClashAttack,
    backToClashAttacks,
  }
}
