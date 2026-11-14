import type { H3Event } from 'h3'
import { requireEncounterAccess, requireEncounterActor } from './campaignSecurity'
import { requireLinkedEntity } from './entitySecurity'
import type { Encounter } from '../db'

/** Bind every intent to its stored encounter and request; never use a supplied campaign/role. */
export async function authorizeEncounterIntent(event: H3Event, encounterId: string | undefined, body: any, operation: string, lockedEncounter?: Encounter) {
  if (!encounterId) throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  const gmOperations = new Set(['update', 'delete', 'duplicate', 'requests-create', 'grant-inspiration', 'data-absorb', 'tormentor-check', 'npc-attack', 'gm-digivolve'])
  const context = await requireEncounterAccess(event, encounterId, gmOperations.has(operation) ? 'dm' : 'member', lockedEncounter)
  const { encounter, access } = context
  if (operation === 'read') return context
  const validate = (value: any, depth = 0): void => {
    if (depth > 30 || typeof value === 'number' && !Number.isFinite(value)) throw createError({ statusCode: 400, message: 'Invalid action value' })
    if (Array.isArray(value)) value.forEach(item => validate(item, depth + 1))
    else if (value && typeof value === 'object') for (const [field, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(field)) throw createError({ statusCode: 400, message: 'Invalid action field' })
      validate(item, depth + 1)
    }
  }
  validate(body)
  if (operation === 'requests-create') {
    if (String(body?.targetTamerId).toLowerCase() !== 'gm') await requireLinkedEntity(event, 'tamer', body?.targetTamerId, encounter.campaignId)
    if (body?.targetParticipantId && !encounter.participants.some((p: any) => p.id === body.targetParticipantId)) throw createError({ statusCode: 400, message: 'Unknown request recipient' })
    if (body?.data?.rookieDigimonId) await requireLinkedEntity(event, 'digimon', body.data.rookieDigimonId, encounter.campaignId)
  }
  if (gmOperations.has(operation)) return context
  if (!access) throw createError({ statusCode: 403, message: 'Standalone encounters are read-only' })
  for (const field of ['skipActionDeduction', 'noActionCost', 'free', 'force']) {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) throw createError({ statusCode: 400, message: `${field} is not accepted by public action endpoints` })
  }
  let actorId = body?.participantId ?? body?.tamerParticipantId ?? body?.interceptorParticipantId ?? body?.breakerId ?? body?.attackerId ?? (operation === 'log' ? body?.actorId : undefined)
  const requestOperations = ['response', 'requests-delete', 'intercede-skip', 'intercede-claim', 'quick-reaction', 'cleanse']
  if (requestOperations.includes(operation)) {
    const request = encounter.pendingRequests?.find((r: any) => r.id === body?.requestId)
    if (!request) throw createError({ statusCode: 404, message: 'The request is no longer pending' })
    if (String(request.targetTamerId).toLowerCase() === 'gm') {
      if (!access.isDm) throw createError({ statusCode: 403, message: 'GM requests require GM access' })
    } else {
      const target = encounter.participants?.find((p: any) => p.id === request.targetParticipantId)
        ?? encounter.participants?.find((p: any) => p.type === 'tamer' && p.entityId === request.targetTamerId)
      if (!target) throw createError({ statusCode: 403, message: 'The request has no current player recipient' })
      await requireEncounterActor(event, encounter, target.id, access)
    }
    if (body?.tamerId && body.tamerId !== request.targetTamerId && !access.isDm) throw createError({ statusCode: 403, message: 'The answer must match its stored recipient' })
    if (!actorId) actorId = request.targetParticipantId
  }
  if (operation === 'responses-delete') {
    const response = encounter.requestResponses?.find((r: any) => r.id === body?.responseId)
    if (!response) throw createError({ statusCode: 404, message: 'Response not found' })
    if (String(response.tamerId).toLowerCase() === 'gm' && !access.isDm) throw createError({ statusCode: 403, message: 'GM responses require GM access' })
    actorId = response.participantId ?? encounter.participants?.find((p: any) => p.type === 'tamer' && p.entityId === response.tamerId)?.id
  }
  if (body?.ownerId) {
    if (String(body.ownerId).toLowerCase() === 'gm') {
      if (!access.isDm) throw createError({ statusCode: 403, message: 'GM recipient requires GM access' })
    } else {
      const owner = encounter.participants?.find((p: any) => p.type === 'tamer' && p.entityId === body.ownerId)
      if (!owner) throw createError({ statusCode: 403, message: 'Unknown encounter recipient' })
      await requireEncounterActor(event, encounter, owner.id, access)
    }
  }
  if (String(actorId).toLowerCase() === 'gm') {
    if (!access.isDm) throw createError({ statusCode: 403, message: 'GM recipient requires GM access' })
  } else if (actorId) await requireEncounterActor(event, encounter, actorId, access)
  else if (!body?.ownerId && !requestOperations.includes(operation) && !access.isDm) throw createError({ statusCode: 400, message: 'A controlled encounter actor is required' })
  return context
}
