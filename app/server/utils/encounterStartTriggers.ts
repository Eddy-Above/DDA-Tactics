import { eq } from 'drizzle-orm'
import { db, digimon, tamers, type Digimon, type Tamer } from '../db'
import { applyEffectToParticipant } from './applyEffect'
import { getUnlockedSpecialOrders } from '../../utils/specialOrders'
import { STAGE_ORDER } from '../../data/qualities'

/**
 * Applied once, the moment an encounter's phase transitions into 'combat' — i.e. "the
 * beginning of the battle" for passives like [Challenger] that key off that moment.
 * Unlike round-start triggers, this only ever fires a single time per encounter.
 */
export async function applyEncounterStartTriggers(
  participants: any[],
  campaignLevel: 'standard' | 'enhanced' | 'extreme',
  houseRules?: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean }
): Promise<any[]> {
  const digimonParticipants = participants.filter((p) => p.type === 'digimon')
  if (digimonParticipants.length === 0) return participants

  const digimonRows = new Map<string, Digimon>()
  for (const p of digimonParticipants) {
    if (digimonRows.has(p.entityId)) continue
    const [d] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
    if (d) digimonRows.set(p.entityId, d)
  }

  // Main enemy = highest-stage enemy digimon present at the start of the encounter
  let mainEnemyStageIdx = -1
  for (const p of digimonParticipants) {
    if (!p.isEnemy) continue
    const d = digimonRows.get(p.entityId)
    if (!d) continue
    const idx = STAGE_ORDER.indexOf(d.stage as any)
    if (idx > mainEnemyStageIdx) mainEnemyStageIdx = idx
  }
  if (mainEnemyStageIdx === -1) return participants

  const tamerRows = new Map<string, Tamer>()

  const updated: any[] = []
  for (const p of participants) {
    if (p.type !== 'digimon' || p.isEnemy) {
      updated.push(p)
      continue
    }

    const d = digimonRows.get(p.entityId)
    if (!d?.partnerId) {
      updated.push(p)
      continue
    }

    let tamer = tamerRows.get(d.partnerId)
    if (!tamer) {
      const [t] = await db.select().from(tamers).where(eq(tamers.id, d.partnerId))
      if (t) {
        tamerRows.set(d.partnerId, t)
        tamer = t
      }
    }
    if (!tamer) {
      updated.push(p)
      continue
    }

    const unlockedOrders = getUnlockedSpecialOrders(tamer.attributes as any, tamer.xpBonuses as any, campaignLevel)
    if (!unlockedOrders.some((o) => o.name === 'Challenger')) {
      updated.push(p)
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
      ...p,
      activeEffects: applyEffectToParticipant(p.activeEffects || [], effectData, houseRules),
    }
    if (shouldOverride) {
      next.currentTempWounds = tempWoundsGranted
    }
    updated.push(next)
  }
  return updated
}
