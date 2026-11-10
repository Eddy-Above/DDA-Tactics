import type { H3Event } from 'h3'
import { requireCampaignDm } from './campaignSecurity'
import { finiteNumber } from './securityValidation'

function amount(value: unknown, field: string): number {
  return value == null ? 0 : finiteNumber(value, field, { integer: true, min: 0 })
}

function tormentMarks(torments: unknown): Map<string, number> {
  if (!Array.isArray(torments)) throw createError({ statusCode: 400, message: 'Torments must be an array' })
  const marks = new Map<string, number>()
  for (const torment of torments) {
    if (!torment || typeof torment.id !== 'string' || !torment.id || marks.has(torment.id)) throw createError({ statusCode: 400, message: 'Torments must have unique identifiers' })
    marks.set(torment.id, amount(torment.gmMarkedBoxes, 'GM-marked Torment boxes'))
  }
  return marks
}

/** Player full-form saves may echo GM grants; changing a grant requires verified GM access. */
export async function requireTamerGmFields(event: H3Event, campaignId: string | null | undefined, body: any, previous?: any): Promise<void> {
  let changed = false
  for (const [field, label] of [['grantedInspiration', 'Granted Inspiration'], ['digivolutionsUsedToday', 'Digivolutions used today']] as const) {
    if (body[field] !== undefined && amount(body[field], label) !== amount(previous?.[field], label)) changed = true
  }
  if (body.torments !== undefined) {
    const before = tormentMarks(previous?.torments ?? []), after = tormentMarks(body.torments)
    for (const id of new Set([...before.keys(), ...after.keys()])) if ((before.get(id) ?? 0) !== (after.get(id) ?? 0)) changed = true
    if (campaignId) {
      const previousById = new Map<string, any>((previous?.torments ?? []).map((torment: any) => [torment.id, torment]))
      for (const torment of body.torments) {
        const stored = previousById.get(torment.id), floor = before.get(torment.id) ?? 0
        if (floor > 0 && amount(torment.markedBoxes, 'Marked Torment boxes') < Math.min(floor, amount(stored?.markedBoxes, 'Marked Torment boxes'))) changed = true
      }
    }
  }
  if (campaignId && changed) await requireCampaignDm(event, campaignId)
}

function chainArray(value: unknown): any[] {
  let chain = value
  if (typeof chain === 'string') { try { chain = JSON.parse(chain) } catch { /* Invalid below. */ } }
  if (!Array.isArray(chain)) throw createError({ statusCode: 400, message: 'Evolution chain must be an array' })
  return chain
}

function unlocks(chain: any[]): Map<string, number> {
  const states = new Map<string, number>()
  chain.forEach((entry, index) => {
    if (!entry || typeof entry.digimonId !== 'string' || !entry.digimonId || entry.isUnlocked !== undefined && typeof entry.isUnlocked !== 'boolean') throw createError({ statusCode: 400, message: 'Invalid evolution unlock state' })
    const parent = entry.evolvesFromIndex === undefined ? (index === 0 ? null : index - 1) : entry.evolvesFromIndex
    if (parent !== null && (!Number.isSafeInteger(parent) || parent < 0 || parent >= chain.length)) throw createError({ statusCode: 400, message: 'Invalid evolution parent' })
    const key = JSON.stringify([entry.digimonId, parent === null ? null : chain[parent]?.digimonId, !!entry.isUnlocked])
    states.set(key, (states.get(key) ?? 0) + 1)
  })
  return states
}

/** Match forms and their parent identities, so reordering cannot promote a locked form to an unlocked root. */
export async function requireEvolutionGmFields(event: H3Event, campaignId: string | null | undefined, body: any, previous?: any): Promise<void> {
  if (body.chain === undefined) return
  const chain = chainArray(body.chain)
  const before = previous ? unlocks(chainArray(previous.chain)) : new Map<string, number>()
  const after = unlocks(chain)
  let changed = false
  if (!previous) {
    if (chain[0]?.evolvesFromIndex != null) throw createError({ statusCode: 400, message: 'The first evolution form must be a root' })
    changed = chain.some((entry, index) => index > 0 && entry.isUnlocked === true)
  }
  else {
    // Reordering or an echoed state is harmless; adding an unlocked node or changing
    // an existing node's state is a GM operation. New locked forms remain editable.
    for (const [key, count] of after) {
      const [formId, parentId, unlocked] = JSON.parse(key)
      const opposite = JSON.stringify([formId, parentId, !unlocked])
      const previouslyUnlocked = [...before.keys()].some(oldKey => { const [oldForm, , wasUnlocked] = JSON.parse(oldKey); return oldForm === formId && wasUnlocked })
      if (count > (before.get(key) ?? 0) && (unlocked || before.has(opposite) || previouslyUnlocked)) changed = true
    }
  }
  if (campaignId && changed) await requireCampaignDm(event, campaignId)
}
