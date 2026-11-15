import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { loadParticipantDigimon } from './combatSpatial'
import { isTankBusterAttack } from '../../utils/attackArmor'
import { grantTankBusterUses } from '../../utils/tankBuster'

/** Runs inside the command transaction, covering damage, healing, falls and GM health edits. */
export async function finishTankBusterHealthChange<T>(id: string, previous: any, value: T): Promise<T> {
  const result = value as any
  const published = result?.id === id ? result : result?.encounter?.id === id ? result.encounter : null
  const encounter = published?.phase && Array.isArray(published.participants) ? published
    : (await db.select().from(encounters).where(eq(encounters.id, id)))[0]
  if (!encounter || encounter.phase !== 'combat') return value
  const records = await loadParticipantDigimon(encounter.participants)
  const before = new Map<string, any>((previous.participants ?? []).map((p: any) => [p.id, p]))
  let changed = false
  const participants = encounter.participants.map((p: any) => {
    const record = p.type === 'digimon' ? records.get(p.entityId) : undefined
    if (!record?.attacks?.some(isTankBusterAttack) && !record?.qualities?.some((q: any) => q.id === 'effect-tank-buster')) return p
    const uses = grantTankBusterUses(before.get(p.id), p, previous.phase !== 'combat')
    if (p.tankBusterUses === uses) return p
    changed = true
    return { ...p, tankBusterUses: uses }
  })
  if (!changed) return value
  const [saved] = await db.update(encounters).set({ participants, updatedAt: new Date() }).where(eq(encounters.id, id)).returning()
  if (published) Object.assign(published, saved)
  return value
}
