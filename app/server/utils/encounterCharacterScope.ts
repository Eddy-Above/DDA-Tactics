import { inArray } from 'drizzle-orm'
import { db, digimon, tamers, evolutionLines } from '../db'
import { readCombatRecords } from './combatRecordCache'
import { createEntityScopeResolver } from './entityScopeGraph'

interface CharacterLinks {
  digimonIds?: Iterable<string>
  tamerIds?: Iterable<string>
  evolutionLineIds?: Iterable<string>
}

/** Validate the entire linked character graph before a trusted combat service can use it. */
export async function validateEncounterCharacterScope(campaignId: string, links: CharacterLinks): Promise<void> {
  const fail = (): never => { throw createError({ statusCode: 400, message: 'An encounter character or evolution form belongs to a different campaign' }) }
  const ids = (values?: Iterable<string>) => {
    const result = new Set(values ?? [])
    if ([...result].some(id => typeof id !== 'string' || !id)) fail()
    return result
  }
  const digimonIds = ids(links.digimonIds), tamerIds = ids(links.tamerIds), lineIds = ids(links.evolutionLineIds)
  const lines = [...(await readCombatRecords('evolution-line', [...lineIds], ids => db.select().from(evolutionLines).where(inArray(evolutionLines.id, ids)))).values()]
  if (lines.length !== lineIds.size) fail()
  for (const line of lines) {
    if (line.campaignId && line.campaignId !== campaignId) fail()
    if (line.partnerId) tamerIds.add(line.partnerId)
    let chain: any = line.chain
    if (typeof chain === 'string') { try { chain = JSON.parse(chain) } catch { fail() } }
    if (!Array.isArray(chain)) fail()
    if (!line.campaignId && !line.partnerId && chain.length === 0) fail()
    for (const entry of chain) {
      if (!entry || typeof entry.digimonId !== 'string' || !entry.digimonId) fail()
      digimonIds.add(entry.digimonId)
    }
  }
  const forms = [...(await readCombatRecords('digimon', [...digimonIds], ids => db.select().from(digimon).where(inArray(digimon.id, ids)))).values()]
  if (forms.length !== digimonIds.size) fail()
  for (const form of forms) {
    if (form.campaignId && form.campaignId !== campaignId) fail()
    // Older partner forms derive their scope from their Tamer. An explicit matching
    // campaign never makes a conflicting foreign partner safe.
    if (form.partnerId) tamerIds.add(form.partnerId)
  }
  const owners = [...(await readCombatRecords('tamer', [...tamerIds], ids => db.select().from(tamers).where(inArray(tamers.id, ids)))).values()]
  if (owners.length !== tamerIds.size || owners.some(owner => owner.campaignId !== campaignId)) fail()
  const resolveScope = createEntityScopeResolver(forms, 'digimon')
  for (const form of forms) if (await resolveScope('digimon', form) !== campaignId) fail()
}
