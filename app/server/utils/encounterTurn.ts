import type { CombatParticipant } from '../../types/combat'
import { applyDeferredIntercedeCost, recordTurnStart } from '../../utils/intercedeActions'
import { PERMANENT_EFFECTS, DAMAGE_OVER_TIME_EFFECTS } from '../../data/attackConstants'
import { applyLagInitiative } from '../../utils/lagInitiative'
import { updateEncounterState } from './encounterUpdate'
import type { Encounter } from '../db'
function applyRoundReset(
  participants: CombatParticipant[],
  houseRules?: { signatureMoveBattery?: boolean } | null,
  digimonMap?: Map<string, any>
) {
  participants.forEach((p) => {
    // Capture Haste state BEFORE reset: potency=1 means applied after turn passed;
    // actionsRemaining > 0 means the immediate Haste action wasn't spent on intercede.
    const hasteEffect = (p.activeEffects || []).find((e: any) => e.name === 'Haste')
    const hasteGrantsNextRound = !!(hasteEffect && (hasteEffect as any).potency === 1
      && (p.actionsRemaining?.simple ?? 0) > 0)

    p.actionsRemaining = { simple: 2 }
    p.hasActed = false
    p.usedAttackIds = []
    p.hasAttemptedDigivolve = false
    p.quickReactionDiceBonus = 0
    // Apply Stun action penalty (skip if already reduced mid-round when Stun was applied)
    if (!p.stunActionReducedThisRound) {
      const stunEffect = (p.activeEffects || []).find((e: any) => e.name === 'Stun')
      if (stunEffect) {
        p.actionsRemaining.simple = Math.max(0, p.actionsRemaining.simple - 1)
      }
    }
    p.stunActionReducedThisRound = false
    if (hasteGrantsNextRound) {
      p.actionsRemaining.simple += 1
    }
    // Clash round resets
    if (p.clash) {
      const opponent = participants.find((o) => o.id === (p.clash as any).opponentParticipantId)
      const eitherPinned = (p.clash as any).isPinned || (opponent?.clash as any)?.isPinned
      p.clash.clashCheckNeeded = !eitherPinned  // pinned side skips the check; controller retains
      p.clash.isPinned = false                  // pins expire after one turn
    }
    p.usedFreeClashThisRound = false  // Wrestlemania free clash resets each round
  })

  // Signature Move Battery: grant +1 Battery at end of round to digimon who did not use Signature Move
  if (houseRules?.signatureMoveBattery && digimonMap) {
    participants.forEach((p) => {
      if (p.type !== 'digimon') return
      const digimon = digimonMap.get(p.entityId)
      const stage = digimon?.stage as string | undefined
      const stageBatteryCapacity: Record<string, number> = {
        'champion': 2, 'ultimate': 3, 'mega': 4, 'ultra': 5,
      }
      const cap = stage ? (stageBatteryCapacity[stage] ?? 0) : 0
      if (cap > 0) {
        if (!p.usedSignatureMoveThisTurn) {
          p.battery = Math.min(cap, (p.battery ?? 0) + 1)
        }
        p.usedSignatureMoveThisTurn = false
      }
    })
  }
}

// End-of-turn duration countdown for one participant. Permanent effects never count down;
// Poison/Burn count down server-side together with their damage (server/utils/damageOverTime.ts).
function tickTurnEffects(participant: CombatParticipant) {
  participant.strikeFastReady = false
  participant.activeEffects = (participant.activeEffects || [])
    .map((e) => e.name === 'Lag' || PERMANENT_EFFECTS.has(e.name) || DAMAGE_OVER_TIME_EFFECTS.has(e.name) ? e : { ...e, duration: e.duration - 1 })
    .filter((e) => e.name === 'Lag' || e.duration > 0 || PERMANENT_EFFECTS.has(e.name) || DAMAGE_OVER_TIME_EFFECTS.has(e.name))
}

// Starts a participant's turn: resets dodge penalty, repays deferred intercede actions,
// applies any Divine Protection penalty, and resets their partner's dodge/intercede state.
// Shared by nextTurn and removeParticipant's activate-next-participant case.
function activateParticipant(
  participant: CombatParticipant,
  participants: CombatParticipant[],
  digimonMap?: Map<string, any>,
  round?: number,
) {
  participant.isActive = true
  participant.dodgePenalty = 0
  participant.hasDirectedThisTurn = false
  applyDeferredIntercedeCost(participant, round)
  recordTurnStart(participant)

  // Apply Divine Protection Simple Action penalty carried from previous turn
  if (participant.pendingSimpleActionPenalty && participant.pendingSimpleActionPenalty > 0) {
    participant.actionsRemaining = participant.actionsRemaining || { simple: 2 }
    participant.actionsRemaining.simple = Math.max(
      0,
      participant.actionsRemaining.simple - participant.pendingSimpleActionPenalty,
    )
    participant.pendingSimpleActionPenalty = 0
  }

  // Also reset partner digimon's dodge penalty and apply accumulated intercede penalty
  if (digimonMap && participant.type === 'tamer') {
    const partner = participants.find((p) => {
      if (p.type !== 'digimon') return false
      const digi = digimonMap.get(p.entityId)
      return digi?.partnerId === participant.entityId
    })
    if (partner) {
      partner.dodgePenalty = 0
      applyDeferredIntercedeCost(partner, round)
      partner.hasActed = false
    }
  }
}


export async function advanceEncounterTurn(storedEncounter: Encounter, digimonMap: Map<string, any>, houseRules?: any, getEntityName?: (p: CombatParticipant) => string | null | undefined) {
    const encounter = structuredClone(storedEncounter)
    const participants = encounter.participants as CombatParticipant[]
    let turnOrder = encounter.turnOrder as string[]
    if (turnOrder.length === 0) return null
    let nextIndex = (encounter.currentTurnIndex + 1) % turnOrder.length

    // Skip any turn-order slots whose participant was removed from the encounter
    let skipped = 0
    let crossedZero = nextIndex === 0
    while (!participants.find((p) => p.id === turnOrder[nextIndex]) && skipped < turnOrder.length) {
      nextIndex = (nextIndex + 1) % turnOrder.length
      skipped++
      if (nextIndex === 0) crossedZero = true
    }

    let newRound = encounter.round
    const endOfTurnLogEntries: any[] = []

    // If we've wrapped around, start a new round
    if (crossedZero) {
      newRound += 1
      applyRoundReset(participants, houseRules, digimonMap)
    }

    // Mark current participant as having acted
    const currentParticipantId = (encounter.turnOrder as string[])[encounter.currentTurnIndex]
    const currentParticipant = participants.find((p) => p.id === currentParticipantId)
    if (currentParticipant) {
      currentParticipant.hasActed = true
      currentParticipant.isActive = false

      // Poison/Burn damage is applied by the server when this turn/round ends ([id].put.ts → damageOverTime)

      // Boss quality: Data Absorb — heal at end of this participant's turn
      if (currentParticipant.dataAbsorbActive) {
        // Potency is tracked via the GM's last toggle action; use base BIT as fallback
        // The heal multiplier was logged at activation time; here we apply BIT×2 minimum
        const dataAbsorbHeal = Math.max(0, (currentParticipant as any).dataAbsorbHealAmount ?? 0)
        if (dataAbsorbHeal > 0) {
          currentParticipant.currentWounds = Math.max(0, (currentParticipant.currentWounds || 0) - dataAbsorbHeal)
        }
        endOfTurnLogEntries.push({
          id: `log-data-absorb-${currentParticipant.id}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          round: encounter.round,
          actorId: currentParticipant.id,
          actorName: currentParticipant.id,
          action: 'Data Absorb',
          target: currentParticipant.id,
          result: dataAbsorbHeal > 0 ? `Healed ${dataAbsorbHeal} wounds` : 'Data Absorb healing (server resolves BIT×2)',
          damage: null,
          effects: ['Data Absorb'],
        })
      }

      // Decrement effect durations at end of this participant's turn
      tickTurnEffects(currentParticipant)
    }

    // At tamer turn-end: mark partner digimon as having acted and open post-turn intercede window
    if (digimonMap && currentParticipant && currentParticipant.type === 'tamer') {
      const partnerDigi = participants.find((p) => {
        if (p.type !== 'digimon') return false
        const digi = digimonMap.get(p.entityId)
        return digi?.partnerId === currentParticipant.entityId
      })
      if (partnerDigi) {
        partnerDigi.hasActed = true
        const stunEffect = (partnerDigi.activeEffects || []).find((e: any) => e.name === 'Stun')
        partnerDigi.maxPostTurnIntercedes = stunEffect ? 1 : 2
      }

      // Partner digimon grouped under this tamer (no turn-order slot of their own) act on the
      // tamer's turn, so their effects count down with it. After the Stun check above, so the
      // post-turn intercede cap still sees this round's Stun.
      for (const p of participants) {
        if (p.type !== 'digimon' || p.inReserve || turnOrder.includes(p.id)) continue
        if (digimonMap.get(p.entityId)?.partnerId !== currentParticipant.entityId) continue
        tickTurnEffects(p)
      }
    }

    if (crossedZero) {
      turnOrder = applyLagInitiative(participants, turnOrder, newRound, digimonMap)
      nextIndex = 0
    }

    // Mark next participant as active
    const nextParticipantId = turnOrder[nextIndex]
    const nextParticipant = participants.find((p) => p.id === nextParticipantId)
    if (nextParticipant) {
      activateParticipant(nextParticipant, participants, digimonMap, newRound)
    }

    const updatePayload: Partial<Encounter> = { participants, turnOrder, currentTurnIndex: nextIndex, round: newRound }
    const logEntries = [...endOfTurnLogEntries]
    if (getEntityName && nextParticipant) {
      const name = getEntityName(nextParticipant)
      if (name) {
        logEntries.push({
          id: `log-turnstart-${nextParticipant.id}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          round: newRound,
          actorId: nextParticipant.id,
          actorName: name,
          action: 'Turn started',
          target: null,
          result: `${name}'s turn begins`,
          damage: null,
          effects: [],
        })
      }
    }
    if (logEntries.length > 0) {
      const existingLog = [...((encounter?.battleLog as any[]) || [])]
      updatePayload.battleLog = existingLog.concat(logEntries)
    }
    return updateEncounterState(encounter.id, updatePayload)
  }
