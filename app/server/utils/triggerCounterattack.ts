import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { resolveNpcAttack } from './resolveNpcAttack'
import { resolveParticipantName } from './participantName'

interface TriggerCounterattackParams {
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  round: number
  counterattackerParticipantId: string  // the Digimon with Counterattack quality
  originalAttackerParticipantId: string  // the one who missed (now the target)
  houseRules?: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean }
  turnOrder?: string[]
  currentTurnIndex?: number
}

export async function triggerCounterattack(params: TriggerCounterattackParams): Promise<{
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
}> {
  let { participants, battleLog, pendingRequests } = params

  const counterattacker = participants.find((p: any) => p.id === params.counterattackerParticipantId)
  const originalAttacker = participants.find((p: any) => p.id === params.originalAttackerParticipantId)

  if (!counterattacker || !originalAttacker || counterattacker.type !== 'digimon') {
    return { participants, battleLog, pendingRequests }
  }

  const [counterattackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, counterattacker.entityId))
  if (!counterattackerDigimon) {
    return { participants, battleLog, pendingRequests }
  }

  const counterattackerName = resolveParticipantName(
    counterattacker,
    participants,
    counterattackerDigimon.name || `Digimon ${counterattacker.entityId}`,
    counterattackerDigimon.isEnemy || false,
  )

  // Resolve original attacker name
  let originalAttackerName = `Participant ${originalAttacker.id}`
  if (originalAttacker.type === 'tamer') {
    const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, originalAttacker.entityId))
    originalAttackerName = tamerEntity?.name || originalAttackerName
  } else if (originalAttacker.type === 'digimon') {
    const [origDigimon] = await db.select().from(digimon).where(eq(digimon.id, originalAttacker.entityId))
    if (origDigimon) {
      originalAttackerName = resolveParticipantName(
        originalAttacker,
        participants,
        origDigimon.name || `Digimon ${originalAttacker.entityId}`,
        origDigimon.isEnemy || false,
      )
    }
  }

  const isPlayerControlled = !!counterattackerDigimon.partnerId && !counterattackerDigimon.isEnemy

  if (isPlayerControlled) {
    // Player-controlled counterattacker → prompt player to choose attack and roll
    const partnerId = counterattackerDigimon.partnerId!

    const counterattackPrompt = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'counterattack-prompt',
      targetTamerId: partnerId,
      targetParticipantId: params.counterattackerParticipantId,
      timestamp: new Date().toISOString(),
      data: {
        counterattackerParticipantId: params.counterattackerParticipantId,
        counterattackerEntityId: counterattacker.entityId,
        counterattackerName,
        originalAttackerParticipantId: params.originalAttackerParticipantId,
        originalAttackerEntityId: originalAttacker.entityId,
        originalAttackerName,
      },
    }

    return {
      participants,
      battleLog,
      pendingRequests: [...pendingRequests, counterattackPrompt],
    }
  }

  // NPC counterattacker → auto-resolve
  // Pick best attack: first damage attack without Area Attack tag, then fall back to any damage attack
  const attacks = counterattackerDigimon.attacks
    ? (typeof counterattackerDigimon.attacks === 'string'
        ? JSON.parse(counterattackerDigimon.attacks)
        : counterattackerDigimon.attacks)
    : []

  const damageAttacks = (attacks as any[]).filter((a: any) => a.type === 'damage')
  const nonAreaAttacks = damageAttacks.filter(
    (a: any) => !(a.tags || []).some((t: string) => t.startsWith('Area Attack')),
  )
  const chosenAttack = nonAreaAttacks[0] || damageAttacks[0] || null

  if (!chosenAttack) {
    battleLog = [
      ...battleLog,
      {
        id: `log-${Date.now()}-ca-fizzle`,
        timestamp: new Date().toISOString(),
        round: params.round,
        actorId: params.counterattackerParticipantId,
        actorName: counterattackerName,
        action: 'Counterattack',
        target: originalAttackerName,
        result: 'Counterattack fizzled – no valid attack',
        damage: 0,
        effects: ['Counterattack', 'Fizzled'],
      },
    ]
    return { participants, battleLog, pendingRequests }
  }

  // Determine accuracy pool
  const baseStats = typeof counterattackerDigimon.baseStats === 'string'
    ? JSON.parse(counterattackerDigimon.baseStats) : counterattackerDigimon.baseStats
  const bonusStats = typeof (counterattackerDigimon as any).bonusStats === 'string'
    ? JSON.parse((counterattackerDigimon as any).bonusStats) : (counterattackerDigimon as any).bonusStats
  const accuracyPool = Math.max(1, (baseStats?.accuracy ?? 0) + (bonusStats?.accuracy ?? 0) || 3)

  // Roll accuracy dice server-side
  const accuracyDiceResults: number[] = []
  for (let i = 0; i < accuracyPool; i++) {
    accuracyDiceResults.push(Math.floor(Math.random() * 6) + 1)
  }
  const accuracySuccesses = accuracyDiceResults.filter((d: number) => d >= 5).length

  // Mark used
  participants = participants.map((p: any) =>
    p.id === params.counterattackerParticipantId
      ? { ...p, usedCounterattackThisCombat: true }
      : p,
  )

  // Log accuracy roll
  battleLog = [
    ...battleLog,
    {
      id: `log-${Date.now()}-ca-accuracy`,
      timestamp: new Date().toISOString(),
      round: params.round,
      actorId: params.counterattackerParticipantId,
      actorName: counterattackerName,
      action: 'Counterattack Accuracy',
      target: originalAttackerName,
      result: `${accuracyPool}d6 => [${accuracyDiceResults.join(',')}] = ${accuracySuccesses} successes`,
      damage: null,
      effects: ['Counterattack', 'Accuracy Roll'],
    },
  ]

  if (accuracySuccesses === 0) {
    battleLog = [
      ...battleLog,
      {
        id: `log-${Date.now()}-ca-miss`,
        timestamp: new Date().toISOString(),
        round: params.round,
        actorId: params.counterattackerParticipantId,
        actorName: counterattackerName,
        action: 'Counterattack Result',
        target: originalAttackerName,
        result: 'AUTO MISS - 0 accuracy successes',
        damage: 0,
        effects: ['Counterattack', 'Miss'],
        hit: false,
      },
    ]
    return { participants, battleLog, pendingRequests }
  }

  // Determine if original attacker is player-controlled
  let originalAttackerIsPlayer = false
  let originalAttackerTamerId: string | null = null

  if (originalAttacker.type === 'tamer') {
    originalAttackerIsPlayer = true
    originalAttackerTamerId = originalAttacker.entityId
  } else if (originalAttacker.type === 'digimon') {
    const [origDig] = await db.select().from(digimon).where(eq(digimon.id, originalAttacker.entityId))
    if (origDig?.partnerId && !origDig.isEnemy) {
      originalAttackerIsPlayer = true
      originalAttackerTamerId = origDig.partnerId
    }
  }

  if (originalAttackerIsPlayer && originalAttackerTamerId) {
    // Create dodge-roll directly (bypassing intercede-offer) with halfDodge: true
    const dodgeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'dodge-roll',
      targetTamerId: originalAttackerTamerId,
      targetParticipantId: params.originalAttackerParticipantId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: counterattackerName,
        targetName: originalAttackerName,
        attackName: chosenAttack.name || 'Counterattack',
        accuracySuccesses,
        accuracyDice: accuracyDiceResults,
        attackId: chosenAttack.id,
        attackData: chosenAttack,
        attackerEntityId: counterattacker.entityId,
        attackerParticipantId: params.counterattackerParticipantId,
        targetEntityId: originalAttacker.entityId,
        dodgePenalty: originalAttacker.dodgePenalty ?? 0,
        bolstered: false,
        bolsterType: null,
        bolsterDamageBonus: 0,
        bolsterBitCpuBonus: 0,
        lifestealed: false,
        isSupportAttack: chosenAttack.type === 'support',
        isSignatureMove: false,
        batteryCount: 0,
        clashAttack: false,
        outsideClashCpuPenalty: 0,
        halfDodge: true,
        isCounterattack: true,
      },
    }
    pendingRequests = [...pendingRequests, dodgeRequest]
  } else {
    // NPC original attacker — call resolveNpcAttack with counterattack: true
    const result = await resolveNpcAttack({
      participants,
      battleLog,
      attackerParticipantId: params.counterattackerParticipantId,
      targetParticipantId: params.originalAttackerParticipantId,
      attackId: chosenAttack.id,
      accuracySuccesses,
      accuracyDice: accuracyDiceResults,
      round: params.round,
      attackerName: counterattackerName,
      targetName: originalAttackerName,
      turnOrder: params.turnOrder,
      currentTurnIndex: params.currentTurnIndex,
      houseRules: params.houseRules,
      counterattack: true,
    })
    participants = result.participants
    battleLog = result.battleLog
  }

  return { participants, battleLog, pendingRequests }
}
