export interface RewardAmounts {
  tamerXp: number
  tamerInspiration: number
  digimonBonusDP: number
}
export interface RewardRequest extends RewardAmounts {
  requestId: string
  tamerIds: string[]
  digimonIds: string[]
}
export interface RewardReceiptPayload extends RewardRequest {
  partnerDigimonIds?: string[]
  affectedDigimonIds?: string[]
}
export interface RewardRoster {
  tamers: { id: string; name: string; spriteUrl: string | null; xp: number; totalXp: number | null; inspiration: number }[]
  digimon: { id: string; name: string; spriteUrl: string | null; partnerId: string; bonusDP: number }[]
}
export interface RewardResult extends RewardAmounts {
  requestId: string
  tamerCount: number
  digimonCount: number
  untrackedTamerIds: string[]
  replayed: boolean
  affectedDigimonIds: string[]
}
