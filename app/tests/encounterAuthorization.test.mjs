import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
function fixture({ isDm = false, member = true, scope = 'camp', recipient = 'tamer', actorCampaign = 'camp' } = {}) {
  const tables = { campaigns: { id: 'campaign-id' }, encounters: { id: 'encounter-id' }, tamers: { id: 'tamer-id' }, digimon: { id: 'digimon-id' } }
  const encounter = { id: 'enc', campaignId: scope, visibleToPlayers: true, participants: [{ id: 'player', type: 'tamer', entityId: 'tamer' }, { id: 'partner', type: 'digimon', entityId: 'mon' }, { id: 'npc', type: 'digimon', entityId: 'npc-mon', isEnemy: true }], pendingRequests: [{ id: 'request', targetTamerId: recipient, targetParticipantId: recipient === 'GM' ? 'npc' : 'player' }], requestResponses: [{ id: 'answer', tamerId: recipient }] }
  const rows = new Map([[tables.campaigns, [{ id: 'camp', ownerId: 'owner', passwordHash: member ? null : 'secret', dmPasswordHash: null }]], [tables.encounters, [encounter]], [tables.tamers, [{ id: 'tamer', campaignId: actorCampaign }]], [tables.digimon, [{ id: 'mon', campaignId: actorCampaign, partnerId: 'tamer' }]]])
  const db = { select: () => ({ from: table => ({ where: () => Promise.resolve(rows.get(table) ?? []) }) }) }
  const auth = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', {
    '../db': { db, ...tables },
    './campaignAuth': { getMyCampaignAccess: async () => ({ userId: member ? 'player-account' : null, isOwner: isDm, isCoOwner: false, isCoDm: false, accessibleTamerIds: [] }) },
    './securityTransport': { enforcePrincipalWriteLimit: () => {} },
  })
  const intents = loadTypeScriptWithMocks('server/utils/encounterAuthorization.ts', { './campaignSecurity': auth, './entitySecurity': { requireLinkedEntity: async () => {} } })
  return { ...intents, encounter, event: { node: { req: { headers: {} } }, context: {} } }
}

test('encounter intents use real campaign membership and permit trusted players to control campaign player characters', async () => {
  const f = fixture()
  assert.equal((await f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'player', campaignId: 'forged' }, 'move')).encounter.campaignId, 'camp')
  assert.ok(await f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'partner' }, 'stance'))
  const denied = fixture({ member: false })
  await assert.rejects(denied.authorizeEncounterIntent(denied.event, 'enc', { participantId: 'player' }, 'move'), { statusCode: 401 })
})

for (const operation of ['update', 'delete', 'duplicate', 'requests-create', 'grant-inspiration', 'npc-attack', 'tormentor-check', 'gm-digivolve']) test(`${operation} requires the stored campaign GM role`, async () => {
  const f = fixture()
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'player', isDm: true }, operation), { statusCode: 403 })
})

test('player log intents bind actorId to a controlled stored character', async () => {
  const f = fixture()
  assert.ok(await f.authorizeEncounterIntent(f.event, 'enc', { actorId: 'player', action: 'Skill check' }, 'log'))
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { actorId: 'npc', action: 'Forged NPC log' }, 'log'), { statusCode: 403 })
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { actorId: 'missing', action: 'Forged actor' }, 'log'), { statusCode: 404 })
})

test('NPCs and cross-campaign characters cannot be controlled by player intents', async () => {
  const f = fixture()
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'npc' }, 'move'), { statusCode: 403 })
  const foreign = fixture({ actorCampaign: 'other' })
  await assert.rejects(foreign.authorizeEncounterIntent(foreign.event, 'enc', { participantId: 'player' }, 'stance'), { statusCode: 400 })
})

for (const field of ['force', 'free', 'noActionCost', 'skipActionDeduction']) test(`public ${field} flags cannot grant action exemptions`, async () => {
  const f = fixture({ isDm: true })
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'player', [field]: true }, 'attack'), { statusCode: 400 })
})

test('uppercase GM recipients in stored requests, answers and opt-outs require GM access', async () => {
  const f = fixture({ recipient: 'GM' })
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { requestId: 'request', tamerId: 'GM' }, 'response'), { statusCode: 403 })
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { responseId: 'answer' }, 'responses-delete'), { statusCode: 403 })
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { ownerId: 'GM' }, 'intercede-optouts'), { statusCode: 403 })
})

test('unscoped encounters remain readable but deny player writes and malformed numeric action data', async () => {
  const f = fixture({ scope: null })
  assert.ok(await f.authorizeEncounterIntent(f.event, 'enc', undefined, 'read'))
  await assert.rejects(f.authorizeEncounterIntent(f.event, 'enc', { participantId: 'player' }, 'move'), { statusCode: 403 })
  const scoped = fixture()
  await assert.rejects(scoped.authorizeEncounterIntent(scoped.event, 'enc', { participantId: 'player', response: { dicePool: NaN } }, 'move'), { statusCode: 400 })
})
