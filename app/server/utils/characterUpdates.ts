import { broadcast } from './encounterRoom'
import { encounterAudience, type CharacterUpdate, type EncounterAudience } from '../../utils/characterUpdates'

/** broadcast() defers publication until the surrounding entity/command transaction commits. */
export function notifyCharacterUpdated(campaignId: string | null | undefined,
  update: Partial<Omit<CharacterUpdate, 'type' | 'campaignId'>>,
) {
  if (!campaignId) return
  const message: CharacterUpdate = {
    type: 'character-updated', campaignId,
    tamerIds: [], digimonIds: [], ownerTamerIds: [], partnerDigimon: false, evolutionLines: false,
    ...update,
  }
  broadcast(`campaign:${campaignId}`, message)
}

/** Only changes in who can see an encounter need a campaign-wide discovery signal. */
export function notifyEncounterAudienceChanged(previous: EncounterAudience, next: EncounterAudience | null) {
  if (!previous.campaignId) return
  const before = encounterAudience(previous)
  const after = encounterAudience(next)
  if (JSON.stringify(before) === JSON.stringify(after)) return
  broadcast(`campaign:${previous.campaignId}`, {
    type: 'encounter-availability-changed', campaignId: previous.campaignId, encounterId: previous.id,
    deleted: next === null,
    tamerIds: [...new Set([...before.tamerIds, ...after.tamerIds])],
    digimonIds: [...new Set([...before.digimonIds, ...after.digimonIds])],
  })
}
