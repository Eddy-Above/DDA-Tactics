import type { RewardRequest } from '../types/rewards'

export function normalizeRewardRequest(value: any): RewardRequest {
  if (!value || typeof value !== 'object') throw new Error('Reward details are required')
  if (typeof value.requestId !== 'string' || !value.requestId.trim() || value.requestId.length > 128) throw new Error('A reward request ID is required')
  function ids(input: unknown, label: string): string[] {
    if (!Array.isArray(input) || input.some(id => typeof id !== 'string' || !id.trim())) throw new Error(`Choose valid ${label}`)
    return [...new Set(input.map(id => id.trim()))].sort()
  }
  for (const key of ['tamerXp', 'tamerInspiration', 'digimonBonusDP']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error('Reward amounts must be nonnegative whole numbers')
  }
  if (!value.tamerXp && !value.tamerInspiration && !value.digimonBonusDP) throw new Error('Enter at least one reward amount')
  const tamerIds = ids(value.tamerIds, 'Tamers')
  const digimonIds = ids(value.digimonIds, 'Digimon')
  if (!tamerIds.length) throw new Error('Select at least one Tamer')
  if (value.digimonBonusDP && !digimonIds.length) throw new Error('Select at least one Digimon form for Bonus DP')
  return { requestId: value.requestId, tamerIds, digimonIds: value.digimonBonusDP ? digimonIds : [],
    tamerXp: value.tamerXp, tamerInspiration: value.tamerInspiration, digimonBonusDP: value.digimonBonusDP }
}

export function sameRewardRequest(a: RewardRequest, b: RewardRequest) {
  return JSON.stringify(normalizeRewardRequest(a)) === JSON.stringify(normalizeRewardRequest(b))
}
