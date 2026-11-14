import type { H3Event } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { db, digimon, evolutionLines } from '../db'
import { entityCampaignId, requireEntityAccess, requireLinkedEntity } from './entitySecurity'
import { requireEvolutionGmFields } from './libraryGmFields'
import { generateId } from './id'
import { planEvolutionLineSync } from '../../utils/evolutionLineTree'

/** Serialize link saves in the surrounding entityWrite transaction, including missing-line creation. */
export async function lockEvolutionLineSync(scope: string | null) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`evolution-lines:${scope ?? 'workshop'}`}))`)
}

export async function syncEvolutionLines(event: H3Event, changedIds: string[], scope: string | null) {
  const forms = await db.select().from(digimon)
  const lines = await db.select().from(evolutionLines).where(undefined).for('update')
  const plans = planEvolutionLineSync(forms, lines, changedIds)
  for (const plan of plans) {
    const existing = plan.existing
    const body = { chain: plan.chain, currentStageIndex: plan.currentStageIndex }
    // Unrelated private records can be present in the snapshot, but never in a saved tree.
    for (const entry of plan.chain) await requireLinkedEntity(event, 'digimon', entry.digimonId, scope)
    if (existing) {
      if (await entityCampaignId('evolution-line', existing) !== scope) throw createError({ statusCode: 400, message: 'Evolution line belongs to a different campaign' })
      await requireEntityAccess(event, 'evolution-line', existing, true)
      await requireEvolutionGmFields(event, scope, body, existing)
      if (JSON.stringify(existing.chain) === JSON.stringify(plan.chain) && existing.currentStageIndex === plan.currentStageIndex) continue
      await db.update(evolutionLines).set({ ...body, updatedAt: new Date() }).where(eq(evolutionLines.id, existing.id))
    } else {
      const partnerIds = [...new Set(plan.chain.flatMap(entry => {
        const partnerId = forms.find(form => form.id === entry.digimonId)?.partnerId
        return partnerId ? [partnerId] : []
      }))]
      const line = { ...body, id: generateId(), name: `${plan.root.name} Line`, description: '',
        campaignId: scope, partnerId: partnerIds.length === 1 ? partnerIds[0]! : null, createdAt: new Date(), updatedAt: new Date() }
      await requireEntityAccess(event, 'evolution-line', line, true)
      await requireEvolutionGmFields(event, scope, line)
      await db.insert(evolutionLines).values(line)
    }
  }
}
