import { autoDevolveParticipant } from './partnerDevolution'
import { recordCleanseOutcome } from './cleanse'
import { serverDodgeDefense } from './combatDodge'
import { preserveEnduringSouls } from '../../utils/specialOrderCombat'
import { eq, inArray } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import type { Vec3, GameMap } from '../../types'
import { getEffectStatModifiers } from '../../data/attackConstants'
import { applyEffectToParticipant } from './applyEffect'
import { applyStanceToDodge } from '../../utils/stanceModifiers'
import { resolveParticipantName } from './participantName'
import { computeAttackDamage } from './computeAttackDamage'
import { loadParticipantDigimon } from './combatSpatial'
import { computePushPull, resolveInstantSupportEffect } from './pushPull'
import { loadDamageOverTimeRules } from './damageOverTime'
import { readCombatRecord, withCombatRecords } from './combatRecordCache'
import { hasUnusedTimeControl, knockedOutEnemyIds, resolveEnemyKnockouts, triggerTimeControl } from './enemyKnockouts'
import { getDigizoidArmorBonus } from './digizoidArmor'
import { isAttackedFromOutsideClash } from '../../utils/clashRules'
import { refreshGuidingLightForParticipants } from './guidingLight'
import { lifestealHealing } from '../../utils/lifesteal'
import { applyPositiveSupportEffect } from './positiveSupportEffect'

interface ResolveNpcAttackParams {
  pendingRequests?: any[]
  cleanseCastId?: string
  participants: any[]
  battleLog: any[]
  attackerParticipantId: string
  targetParticipantId: string
  attackId: string
  isSignatureMove?: boolean
  batteryCount?: number
  lifestealed?: boolean
  shieldComplex?: boolean
  accuracySuccesses: number
  accuracyDice: number[]
  round: number
  attackerName: string
  targetName: string
  turnOrder?: string[]
  currentTurnIndex?: number
  houseRules?: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean }
  clashAttack?: boolean        // If true, target's dodge pool is halved (clash mechanic)
  counterattack?: boolean      // If true, target's dodge pool is halved (Counterattack mechanic)
  counterBlow?: boolean        // Strike Last: Counter Blow also halves Armor
  halfDodge?: boolean
  strikeFast?: boolean
  cannotDodge?: boolean        // If true, target gets NO dodge (attacked from outside their clash)
  totalTargetCount?: number     // Total original targets of an [Area] attack (for Selective Targeting)
  mapRecord?: GameMap           // If provided, enables push/pull displacement
  participantPositions?: Record<string, Vec3>
  encounterId?: string          // Loads the campaign's EddySoul rules for Poison/Burn (round wrap, Burn on Knockback/Pull)
}

/**
 * Auto-resolve an attack against an NPC target (rolls dodge server-side, calculates damage).
 * Does NOT deduct attacker actions — caller handles that.
 * Returns updated participants, battleLog, and optionally turnOrder arrays.
 */
export async function resolveNpcAttack(params: ResolveNpcAttackParams): Promise<{
  participants: any[]
  battleLog: any[]
  turnOrder?: string[]
  hit: boolean
  nextTurnIndex?: number
  nextRound?: number
  positionPatch?: Record<string, Vec3>
}> {
  return withCombatRecords(async () => {
  let { participants, battleLog } = params

  const currentTurnIndex = params.currentTurnIndex ?? 0
  // Digimon are not in turnOrder — use their partner Tamer's position instead.
  const targetParticipantForTurn = params.participants.find((p: any) => p.id === params.targetParticipantId)
  let targetHasGone = false
  if (targetParticipantForTurn?.type === 'tamer') {
    const idx = (params.turnOrder || []).indexOf(targetParticipantForTurn.id)
    targetHasGone = idx >= 0 && idx < currentTurnIndex
  } else if (targetParticipantForTurn?.type === 'digimon') {
    const targetDigimonForTurn = await readCombatRecord('digimon', targetParticipantForTurn.entityId, () => db.select().from(digimon).where(eq(digimon.id, targetParticipantForTurn.entityId)))
    if (targetDigimonForTurn?.partnerId) {
      const tamerOfTarget = params.participants.find((p: any) => p.type === 'tamer' && p.entityId === targetDigimonForTurn.partnerId)
      if (tamerOfTarget) {
        const idx = (params.turnOrder || []).indexOf(tamerOfTarget.id)
        targetHasGone = idx >= 0 && idx < currentTurnIndex
      }
    } else {
      // NPC digimon — appears in turnOrder directly
      const idx = (params.turnOrder || []).indexOf(targetParticipantForTurn.id)
      targetHasGone = idx >= 0 && idx < currentTurnIndex
    }
  }

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  const target = participants.find((p: any) => p.id === params.targetParticipantId)
  if (!attacker || !target) {
    return { participants, battleLog, hit: false }
  }

  // Enemies already knocked out before this attack (see the defeat check below)
  const knockedOutBefore = new Set(knockedOutEnemyIds(participants))

  // --- Target quality vars (used in dodge pool and participant update below) ---
  let targetHasPositiveReinforcement = false
  let targetHasCombatMonster = false
  const targetMoodValue = target.moodValue ?? 3
  let targetQualities: any[] = []  // Hoisted: needed for Immunity + Adaptive Intelligence

  // Resolve from the same record-backed formula displayed by both clients.
  const targetRecord: any = target.type === 'digimon'
    ? await readCombatRecord('digimon', target.entityId, () => db.select().from(digimon).where(eq(digimon.id, target.entityId)))
    : await readCombatRecord('tamer', target.entityId, () => db.select().from(tamers).where(eq(tamers.id, target.entityId)))
  targetQualities = targetRecord?.qualities ?? []
  targetHasPositiveReinforcement = targetQualities.some((q: any) => q.id === 'positive-reinforcement')
  targetHasCombatMonster = targetQualities.some((q: any) => q.id === 'combat-monster')
  const defense = serverDodgeDefense({
    targetParticipantId: target.id,
    data: { ...params, attackerParticipantId: attacker.id, dodgePenalty: target.dodgePenalty ?? 0,
      halfDodge: params.counterattack || (params as any).halfDodge },
  }, participants, targetRecord)
  const dodgePool = defense.pool
  const cannotDodge = defense.blocked

  // Roll dodge
  const dodgeDiceResults: number[] = []
  for (let i = 0; i < dodgePool; i++) {
    dodgeDiceResults.push(Math.floor(Math.random() * 6) + 1)
  }
  let dodgeSuccesses = dodgeDiceResults.filter((d: number) => d >= 5).length

  // Digizoid Armor: Brown's 1 automatic dodge success, resets once per round
  let brownArmorAutoDodgeConsumed = false
  const targetHasBrownArmor = targetQualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'brown')
  if (!cannotDodge && targetHasBrownArmor && (target as any).brownArmorAutoDodgeAvailable) {
    dodgeSuccesses += 1
    brownArmorAutoDodgeConsumed = true
  }

  // Shared damage calculation (handles attacker loading, armor, and effects internally)
  const damageCalc = await computeAttackDamage({
    shieldComplex: params.shieldComplex,
    attackerParticipant: attacker,
    targetParticipant: target,
    participants,
    attackId: params.attackId,
    isSignatureMove: params.isSignatureMove,
    batteryCount: params.batteryCount,
    attackerName: params.attackerName,
    accuracySuccesses: params.accuracySuccesses,
    dodgeSuccesses,
    totalTargetCount: params.totalTargetCount,
    counterBlow: params.counterBlow,
    houseRules: params.houseRules,
  })

  const attackDef = damageCalc.attackDef
  if (attackDef?.effect === 'Cleanse') {
    recordCleanseOutcome(params.pendingRequests, params.cleanseCastId, target.id, target,
      damageCalc.netSuccesses, damageCalc.hit && (attackDef.type === 'support' || damageCalc.damageDealt >= 2)
        && !targetQualities.some((quality: any) => quality.id === 'immunity'))
  }
  const attackBaseDamage = damageCalc.attackBaseDamage
  const armorPiercing = damageCalc.armorPiercing
  const attackerHasCombatMonster = damageCalc.attackerHasCombatMonster
  const attackerCombatMonsterBonus = damageCalc.attackerCombatMonsterBonus
  const attackerHasPositiveReinforcement = damageCalc.attackerHasPositiveReinforcement
  const attackerMoodValue = damageCalc.attackerMoodValue
  const netSuccesses = damageCalc.netSuccesses
  const hit = damageCalc.hit
  const targetArmor = damageCalc.targetArmor
  const damageDealt = damageCalc.damageDealt
  const effectiveArmor = damageCalc.effectiveArmor
  const clashArmorBonus = damageCalc.outsideClashArmorBonus

  // --- Support attack: skip damage, apply effect only ---
  if (attackDef?.type === 'support') {
    let appliedEffectName: string | null = null

    participants = participants.map((p: any) => {
      if (p.id === params.targetParticipantId) {
        const updated = {
          ...p,
          dodgePenalty: (p.dodgePenalty ?? 0) + 1,
          activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          ...(brownArmorAutoDodgeConsumed ? { brownArmorAutoDodgeAvailable: false } : {}),
        }

        if (hit && damageCalc.effectData) {
          if (damageCalc.effectData.name === 'Shield' || damageCalc.effectData.name === 'Haste') Object.assign(updated, applyPositiveSupportEffect(updated, damageCalc.effectData, params.houseRules, targetQualities))
          else updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.effectData, params.houseRules, targetQualities, params.round, p.naturewalkActiveElements)
          appliedEffectName = damageCalc.appliedEffectName
          if (damageCalc.secondaryEffectData) {
            updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.secondaryEffectData, params.houseRules, targetQualities, params.round, p.naturewalkActiveElements)
          }
          // Stun: immediately reduce actions if target hasn't taken their turn yet this round
          if (attackDef.effect === 'Stun' && !targetHasGone) {
            updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
            updated.stunActionReducedThisRound = true
          } else if (attackDef.effect === 'Stun' && targetHasGone) {
            // Target already went — reduce intercede capacity this round and carry -1 action to next round
            updated.interceptPenalty = (p.interceptPenalty || 0) + 1
            updated.stunActionReducedThisRound = true
          }
        }

        return updated
      }
      return p
    })

    let forcedMovement: Awaited<ReturnType<typeof resolveInstantSupportEffect>> | null = null
    if (hit && (appliedEffectName === 'Knockback' || appliedEffectName === 'Pull')) {
      forcedMovement = await resolveInstantSupportEffect({
        participants, battleLog, pendingRequests: params.pendingRequests ?? [],
        attackerParticipantId: attacker.id, targetParticipantId: target.id, attackDef,
        round: params.round, attackerName: params.attackerName, targetName: params.targetName,
        encounterId: params.encounterId ?? '', mapId: params.mapRecord?.id,
        turnOrder: params.turnOrder, currentTurnIndex: params.currentTurnIndex, houseRules: params.houseRules,
        distance: damageCalc.effectData?.potency ?? 0, deferPositionBroadcast: true,
        spatial: params.mapRecord && params.participantPositions ? {
          map: params.mapRecord, positions: params.participantPositions, digimonById: await loadParticipantDigimon(participants),
        } : undefined,
      })
      participants = forcedMovement.participants
      battleLog = forcedMovement.battleLog
      if (forcedMovement.positionPatch && params.encounterId) participants = await refreshGuidingLightForParticipants(
        params.encounterId, participants, { ...params.participantPositions, ...forcedMovement.positionPatch },
      )
    }

    const supportDodgeLog = {
      id: `log-${Date.now()}-dodge`,
      timestamp: new Date().toISOString(),
      round: params.round,
      actorId: params.targetParticipantId,
      actorName: params.targetName,
      action: 'Dodge (Support)',
      target: null,
      result: `${dodgePool}d6 => [${dodgeDiceResults.join(',')}] = ${dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
      damage: 0,
      effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
      hit,
      dodgeDicePool: dodgePool,
      dodgeDiceResults,
      dodgeSuccesses,
    }

    battleLog = [...battleLog, supportDodgeLog]
    return { participants, battleLog, turnOrder: forcedMovement?.turnOrder ?? params.turnOrder, hit,
      positionPatch: forcedMovement?.positionPatch, nextTurnIndex: forcedMovement?.nextTurnIndex, nextRound: forcedMovement?.nextRound }
  }

  // All damage/effect values computed by computeAttackDamage above.

  // --- Apply damage, effects, dodge penalty ---
  let appliedEffectName: string | null = null
  let lifestealHealAmount = 0
  participants = participants.map((p: any) => {
    // Handle attacker: reset Combat Monster bonus on hit + Lifesteal healing + Positive Reinforcement mood
    if (p.id === params.attackerParticipantId) {
      const attackerUpdates: any = {}
      if (hit && attackerHasCombatMonster) {
        attackerUpdates.combatMonsterBonus = 0
      }
      if (hit && attackDef?.effect === 'Lifesteal' && damageDealt > 0) {
        // effectData.potency is the attacker's CPU value (from computeAttackDamage)
        lifestealHealAmount = lifestealHealing(damageDealt, damageCalc.effectData?.potency ?? 0, params.lifestealed)
        attackerUpdates.currentWounds = Math.max(0, (p.currentWounds || 0) - lifestealHealAmount)
      }
      // Digizoid Armor: Gold/Obsidian reflect damage back to the attacker
      if (hit && damageCalc.reflectDamageToAttacker > 0) {
        const woundsBeforeReflect = attackerUpdates.currentWounds ?? (p.currentWounds || 0)
        attackerUpdates.currentWounds = Math.min(p.maxWounds, woundsBeforeReflect + damageCalc.reflectDamageToAttacker)
      }
      if (attackerHasPositiveReinforcement) {
        // Land attack → +1 Mood; Miss → –1 Mood
        attackerUpdates.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? 1 : -1)))
      }
      if (Object.keys(attackerUpdates).length > 0) {
        return { ...p, ...attackerUpdates }
      }
    }

    // Handle target: apply damage and Combat Monster accumulation
    if (p.id === params.targetParticipantId) {
      const updated: any = {
        ...p,
        dodgePenalty: (p.dodgePenalty ?? 0) + 1,
        // Consume Directed effect (bonus was applied to dodge pool above)
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
        ...(brownArmorAutoDodgeConsumed ? { brownArmorAutoDodgeAvailable: false } : {}),
      }
      // Positive Reinforcement: get hit → –1 Mood; successfully dodge → +1 Mood
      if (targetHasPositiveReinforcement) {
        updated.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? -1 : 1)))
      }
      if (hit) {
        const tempAvailable = p.currentTempWounds ?? 0
        const tempAbsorb = Math.min(tempAvailable, damageDealt)
        const remainder = damageDealt - tempAbsorb
        updated.currentTempWounds = tempAvailable - tempAbsorb
        if (tempAbsorb > 0 && updated.currentTempWounds === 0) {
          updated.activeEffects = (updated.activeEffects || []).filter((e: any) => e.name !== 'Shield')
        }
        updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + remainder)

        // Accumulate Combat Monster bonus for target (only from real wound damage)
        if (targetHasCombatMonster && remainder > 0) {
          updated.combatMonsterBonus = Math.min(
            p.totalHealth ?? p.maxWounds,
            (p.combatMonsterBonus ?? 0) + remainder
          )
        }

        if (damageCalc.effectData) {
          if (damageCalc.effectData.name === 'Shield' || damageCalc.effectData.name === 'Haste') Object.assign(updated, applyPositiveSupportEffect(updated, damageCalc.effectData, params.houseRules, targetQualities))
          else updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.effectData, params.houseRules, targetQualities, params.round, p.naturewalkActiveElements)
          appliedEffectName = damageCalc.appliedEffectName
          if (damageCalc.secondaryEffectData) {
            updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.secondaryEffectData, params.houseRules, targetQualities, params.round, p.naturewalkActiveElements)
          }
          // Stun: immediately reduce actions if target hasn't taken their turn yet this round
          if (attackDef?.effect === 'Stun' && !targetHasGone) {
            updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
            updated.stunActionReducedThisRound = true
          } else if (attackDef?.effect === 'Stun' && targetHasGone) {
            // Target already went — reduce intercede capacity this round and carry -1 action to next round
            updated.interceptPenalty = (p.interceptPenalty || 0) + 1
            updated.stunActionReducedThisRound = true
          }
        }
      }

      // Boss quality: Adaptive Intelligence — record this attack ID for future dodge bonuses
      if (targetQualities.some((q: any) => q.id === 'adaptive-intelligence')) {
        const prev = updated.seenAttackIds ?? {}
        updated.seenAttackIds = { ...prev, [params.attackId]: (prev[params.attackId] ?? 0) + 1 }
      }

      return updated
    }
    return p
  })

  participants = preserveEnduringSouls(participants, params.participants)

  // --- Push/Pull map displacement (map mode only) ---
  let positionPatch: Record<string, Vec3> | undefined
  let pushPullLogNote: string | null = null
  if (hit && (appliedEffectName === 'Knockback' || appliedEffectName === 'Pull') && params.mapRecord && params.participantPositions) {
    const disp = await computePushPull({
      map: params.mapRecord,
      positions: params.participantPositions,
      participants,
      digimonById: await loadParticipantDigimon(participants),
      attackerParticipantId: params.attackerParticipantId,
      targetParticipantId: params.targetParticipantId,
      effect: appliedEffectName as 'Knockback' | 'Pull',
      distance: damageCalc.effectData?.potency ?? 0,
      burn: { round: params.round, rules: await loadDamageOverTimeRules(params.encounterId, participants) },
    })
    participants = disp.participants
    if (disp.patch) positionPatch = disp.patch
    pushPullLogNote = disp.logNote
  }

  // Resolve the target once; later knockout processing excludes an already-devolved target.
  const damagedTarget = participants.find((p: any) => p.id === params.targetParticipantId)
  const autoDevolveLog = damagedTarget && hit
    ? await autoDevolveParticipant(damagedTarget, participants, { round: params.round, database: db })
    : null

  // --- Boss quality: Time Control — intercept first KO, restore wounds + stat bonus ---
  if (damagedTarget && hit &&
      damagedTarget.currentWounds >= damagedTarget.maxWounds &&
      !autoDevolveLog &&
      hasUnusedTimeControl(damagedTarget, targetQualities)) {
    const timeControl = await triggerTimeControl(participants, params.targetParticipantId, {
      round: params.round,
      houseRules: params.houseRules,
      name: params.targetName,
    })
    participants = timeControl.participants
    battleLog.push(timeControl.logEntry)
  }

  // --- Defeated enemies leave the encounter (resolveEnemyKnockouts) ---
  // The target on a hit, and an attacker knocked out by Digizoid Armor's reflected damage. Removing
  // the active participant starts the next one's turn (wrapping the round past the last slot), with
  // end-of-turn gravity when the map was passed.
  const knockout = await resolveEnemyKnockouts(
    { participants, turnOrder: params.turnOrder ?? [], currentTurnIndex, round: params.round },
    [params.targetParticipantId, params.attackerParticipantId].filter((id) =>
      !(autoDevolveLog && id === params.targetParticipantId)
      && ((id === params.targetParticipantId && hit) || !knockedOutBefore.has(id))),
    {
      encounterId: params.encounterId,
      houseRules: params.houseRules,
      names: { [params.targetParticipantId]: params.targetName, [params.attackerParticipantId]: params.attackerName },
      ...(params.mapRecord && params.participantPositions
        ? { gravity: { map: params.mapRecord, positions: { ...params.participantPositions, ...(positionPatch ?? {}) } } }
        : {}),
    },
  )
  participants = knockout.participants
  if (knockout.positionPatch) positionPatch = { ...(positionPatch ?? {}), ...knockout.positionPatch }
  // Partner auto-devolution is resolved above, before the knockout helper sees the new form.
  // Its changed BIT and footprint must affect the aura without requiring another move.
  if (autoDevolveLog || (knockout.changed && params.participantPositions)) {
    const positions = params.participantPositions
      ? { ...params.participantPositions, ...(positionPatch ?? {}) }
      : undefined
    participants = await refreshGuidingLightForParticipants(params.encounterId, participants, positions)
  }
  const turnMoved = knockout.turnAdvanced || knockout.currentTurnIndex !== currentTurnIndex
  const nextTurnIndex = params.turnOrder && turnMoved ? knockout.currentTurnIndex : undefined
  const nextRound = knockout.round !== params.round ? knockout.round : undefined

  // --- Battle log ---
  const dodgeLogEntry = {
    id: `log-${Date.now()}-dodge`,
    timestamp: new Date().toISOString(),
    round: params.round,
    actorId: params.targetParticipantId,
    actorName: params.targetName,
    action: 'Dodge',
    target: null,
    result: `${dodgePool}d6 => [${dodgeDiceResults.join(',')}] = ${dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
    damage: hit ? damageDealt : 0,
    effects: [
      'Dodge',
      ...(appliedEffectName ? [`Applied: ${appliedEffectName}`] : []),
      ...(lifestealHealAmount > 0 ? [`Lifesteal: healed ${lifestealHealAmount}`] : []),
      ...(hit && damageCalc.reflectDamageToAttacker > 0 ? [`Digizoid Armor: reflected ${damageCalc.reflectDamageToAttacker} damage to ${params.attackerName}`] : []),
      ...(hit && clashArmorBonus > 0 ? [`Clash: +${clashArmorBonus} Armor (CPU)`] : []),
      ...(pushPullLogNote ? [pushPullLogNote] : []),
    ],
    attackerParticipantId: params.attackerParticipantId,
    baseDamage: attackBaseDamage,
    netSuccesses,
    targetArmor,
    ...(hit && clashArmorBonus > 0 ? { clashArmorBonus } : {}),
    armorPiercing,
    effectiveArmor: hit ? effectiveArmor : undefined,
    finalDamage: hit ? damageDealt : 0,
    hit,
    dodgeDicePool: dodgePool,
    dodgeDiceResults,
    dodgeSuccesses,
  }

  battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : []), ...knockout.logEntries]

  return { participants, battleLog, turnOrder: params.turnOrder ? knockout.turnOrder : undefined, hit, nextTurnIndex, nextRound, positionPatch }
  })
}
