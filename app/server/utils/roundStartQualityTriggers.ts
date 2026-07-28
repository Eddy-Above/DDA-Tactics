import { eq } from 'drizzle-orm'
import { db, digimon } from '../db'
import { rollBlackArmorBonus } from './digizoidArmor'

/**
 * Applied at every point a new combat round starts, regardless of which code path advanced it
 * (manual GM/player "End Turn" PUT, or a server-side auto-wrap mid-attack-resolution) — round
 * advancement happens via several independent call sites, so this must be called from each one.
 */
export async function applyRoundStartQualityTriggers(participants: any[]): Promise<any[]> {
  const juggernautStatMap: Record<number, 'accuracy' | 'damage' | 'dodge' | 'armor'> = {
    1: 'armor',    // 1: Health → nearest analog is armor for automation
    2: 'accuracy',
    3: 'damage',
    4: 'dodge',
    5: 'armor',
    6: 'damage',   // 6: Choose → default to damage
  }

  const updated: any[] = []
  for (const p of participants) {
    if (p.type !== 'digimon') {
      updated.push(p)
      continue
    }

    const [digi] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
    if (!digi) {
      updated.push(p)
      continue
    }

    const quals = digi.qualities || []
    let next = p

    // Boss quality: Juggernaut — at the start of each new round, add stacking +2 to a random stat
    if ((quals as any[]).some((q: any) => q.id === 'juggernaut')) {
      const roll = Math.floor(Math.random() * 6) + 1
      const stat = juggernautStatMap[roll]
      const prev = next.juggernauntBonuses ?? {}
      next = { ...next, juggernauntBonuses: { ...prev, [stat]: ((prev as any)[stat] ?? 0) + 2 } }
    }

    const digizoidArmor = (quals as any[]).find((q: any) => q.id === 'digizoid-armor')
    if (digizoidArmor?.choiceId === 'black') {
      next = { ...next, blackArmorRoundBonus: rollBlackArmorBonus() }
    }
    if (digizoidArmor?.choiceId === 'brown') {
      next = { ...next, brownArmorAutoDodgeAvailable: true }
    }

    updated.push(next)
  }
  return updated
}
