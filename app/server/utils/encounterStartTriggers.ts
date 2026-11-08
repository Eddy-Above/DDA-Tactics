import { applyEffectToParticipant } from './applyEffect'
import { getUnlockedSpecialOrders } from '../../utils/specialOrders'
import { STAGE_ORDER } from '../../data/qualities'
import { loadParticipantDigimon, loadTamersByIds } from './combatSpatial'

/**
 * Applied the moment an encounter's phase transitions into 'combat' — i.e. "the beginning
 * of the battle" for passives like [Challenger] that key off that moment. Also re-applied,
 * restricted to just the newly-added participants via `onlyParticipantIds`, when a partner
 * digimon joins an already-running combat (see [id].put.ts), so reinforcements aren't
 * silently skipped.
 */
export async function applyEncounterStartTriggers(
  participants: any[],
  campaignLevel: 'standard' | 'enhanced' | 'extreme',
  houseRules?: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean },
  onlyParticipantIds?: Set<string>
): Promise<any[]> {
  const digimonParticipants = participants.filter((p) => p.type === 'digimon')
  if (digimonParticipants.length === 0) return participants

  const digimonRows = await loadParticipantDigimon(digimonParticipants)

  // Main enemy = highest-stage enemy digimon present at the start of the encounter.
  // Enemies still in reserve aren't actually on the board yet, so they don't count.
  let mainEnemyStageIdx = -1
  for (const p of digimonParticipants) {
    if (!p.isEnemy || p.inReserve) continue
    const d = digimonRows.get(p.entityId)
    if (!d) continue
    const idx = STAGE_ORDER.indexOf(d.stage as any)
    if (idx > mainEnemyStageIdx) mainEnemyStageIdx = idx
  }

  const partnerIds = digimonParticipants.flatMap(p => {
    if (p.isEnemy || (onlyParticipantIds && !onlyParticipantIds.has(p.id))) return []
    const partnerId = digimonRows.get(p.entityId)?.partnerId
    return partnerId ? [partnerId] : []
  })
  const tamerRows = await loadTamersByIds(partnerIds)

  const updated: any[] = []
  for (const p of participants) {
    if (p.type !== 'digimon' || p.isEnemy) {
      updated.push(p)
      continue
    }

    if (onlyParticipantIds && !onlyParticipantIds.has(p.id)) {
      updated.push(p)
      continue
    }

    const d = digimonRows.get(p.entityId)
    if (!d?.partnerId) {
      updated.push(p)
      continue
    }

    const tamer = tamerRows.get(d.partnerId)
    if (!tamer) {
      updated.push(p)
      continue
    }

    const unlockedOrders = getUnlockedSpecialOrders(tamer.attributes as any, tamer.xpBonuses as any, campaignLevel)
    const initialized = { ...p, enduringSoulAvailable: unlockedOrders.some(o => o.name === 'Enduring Soul'), enduringSoulUsed: false,
      strikeFastReady: false, finishingTouchReady: false, decimationReady: false, strikeLastCounter: undefined,
      quickReactionDiceBonus: 0 }
    if (mainEnemyStageIdx < 0 || !unlockedOrders.some((o) => o.name === 'Challenger')) {
      updated.push(initialized)
      continue
    }

    const partnerStageIdx = STAGE_ORDER.indexOf(d.stage as any)
    const stageDiff = Math.max(0, mainEnemyStageIdx - partnerStageIdx)
    const tempWoundsGranted = Math.min(5, 2 + stageDiff)

    const effectData = {
      name: 'Shield',
      type: 'buff' as const,
      duration: 1,
      source: 'Challenger',
      description: 'Temporary Wound Boxes gained from [Challenger] at the start of battle',
      potency: tempWoundsGranted,
    }

    const currentTemp = p.currentTempWounds ?? 0
    const shouldOverride = !houseRules?.maxTempWoundsRule || tempWoundsGranted >= currentTemp

    const next: any = {
      ...initialized,
      activeEffects: applyEffectToParticipant(p.activeEffects || [], effectData, houseRules),
    }
    if (shouldOverride) {
      next.currentTempWounds = tempWoundsGranted
    }
    updated.push(next)
  }
  return updated
}
