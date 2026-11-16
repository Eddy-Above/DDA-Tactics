import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { preserveEnduringSoul } from '../../utils/specialOrderCombat'
import { AsyncLocalStorage } from 'node:async_hooks'

const fallScopes = new AsyncLocalStorage<{ deferred: boolean }>()

export function withFallProtection<T>(work: () => Promise<T>): Promise<T> {
  return fallScopes.getStore() ? work() : fallScopes.run({ deferred: false }, work)
}

/** Fall movement resolves immediately; eligible Tamers decide whether to take its wounds. */
export function applyFallDamage(participant: any, damage: number, targetName?: string): boolean {
  if (!(damage > 0)) return false
  if (participant.type === 'tamer'
    && ((participant.divineProtectionUsesThisBattle ?? 0) === 0 || (participant.currentInspiration ?? 0) >= 2)) {
    participant.pendingFallDamage = [...(participant.pendingFallDamage ?? []), { damage, targetName }]
    const scope = fallScopes.getStore()
    if (scope) scope.deferred = true
    return true
  }
  const previousWounds = participant.currentWounds ?? 0
  participant.currentWounds = Math.min(participant.maxWounds, previousWounds + damage)
  preserveEnduringSoul(participant, previousWounds)
  return false
}

/** Finalize every fall source inside the command transaction, before publishing its snapshot. */
export async function finishFallProtection<T>(id: string, value: T, previous?: any): Promise<T> {
  const result = value as any
  const published = result?.id === id ? result : result?.encounter?.id === id ? result.encounter : null
  if (Array.isArray(published?.participants) && !published.participants.some((p: any) => p.pendingFallDamage?.length)) return value
  // Commands returning only a movement/log result need no extra read unless a fall was queued.
  const scope = fallScopes.getStore()
  if (!published && scope && !scope.deferred && !previous?.participants?.some((p: any) => p.pendingFallDamage?.length)) return value
  const encounter = published?.phase && Array.isArray(published.participants) ? published
    : (await db.select().from(encounters).where(eq(encounters.id, id)))[0]
  if (!encounter?.participants?.some((p: any) => p.pendingFallDamage?.length)) return value
  const pendingRequests = [...(encounter.pendingRequests ?? [])]
  const logEntries: any[] = []
  let changed = false
  const participants = encounter.participants.map((original: any) => {
    if (!original.pendingFallDamage?.length) return original
    // Keep separate damage events in order. A previous decision may spend the free use or Inspiration.
    if (pendingRequests.some(request => request.type === 'divine-protection-offer' && request.targetParticipantId === original.id)) return original
    const participant = { ...original }
    const remaining = [...participant.pendingFallDamage]
    changed = true
    while (remaining.length) {
      const { damage, targetName } = remaining.shift()!
      const firstUse = (participant.divineProtectionUsesThisBattle ?? 0) === 0
      if (encounter.phase === 'combat' && participant.type === 'tamer' && (firstUse || (participant.currentInspiration ?? 0) >= 2)) {
        participant.pendingDivineProtectionDamage = damage
        pendingRequests.push({
          id: `fall-protection-${crypto.randomUUID()}`,
          type: 'divine-protection-offer', targetTamerId: participant.entityId,
          targetParticipantId: participant.id, timestamp: new Date().toISOString(),
          data: { pendingDamage: damage, targetName: targetName ?? participant.name ?? 'Tamer',
            attackerName: 'Fall', damageSource: 'fall', targetParticipantId: participant.id,
            firstUse, inspirationCost: firstUse ? 0 : 2 },
        })
        break
      }
      const previousWounds = participant.currentWounds ?? 0
      participant.currentWounds = Math.min(participant.maxWounds, previousWounds + damage)
      preserveEnduringSoul(participant, previousWounds)
      logEntries.push({
        id: `fall-damage-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), round: encounter.round,
        actorId: participant.id, actorName: targetName ?? participant.name ?? 'Tamer', action: 'Fall Damage', target: null,
        result: `${targetName ?? participant.name ?? 'Tamer'} takes ${damage} fall damage (Divine Protection unavailable)`,
        damage, effects: ['Fall'],
      })
    }
    if (remaining.length) participant.pendingFallDamage = remaining
    else delete participant.pendingFallDamage
    return participant
  })
  if (!changed) return value
  const [saved] = await db.update(encounters).set({ participants, pendingRequests, updatedAt: new Date(),
    ...(logEntries.length ? { battleLog: [...(encounter.battleLog ?? []), ...logEntries] } : {}) })
    .where(eq(encounters.id, id)).returning()
  if (published) Object.assign(published, saved)
  return value
}
