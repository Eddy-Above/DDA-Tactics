/** A menu choice; branches open an outer ring and leaves are returned to the map. */
export type AttackRadialRider = 'bolster-damage-accuracy' | 'bolster-bit-cpu' | 'huge-power' | 'huge-power-2' | 'lifesteal' | 'act-of-inspiration' | 'fateful-intervention'

export interface MapRadialItem {
  id: string
  label: string
  icon?: string
  description?: string
  disabled?: boolean
  active?: boolean
  cost?: string
  attackId?: string
  attackRider?: AttackRadialRider
  attackRiders?: AttackRadialRider[]
  /** Attack details drawn under the label on the outer ring. */
  range?: string
  aoe?: string
  effect?: string
  tags?: string[]
  children?: MapRadialItem[]
}

export type MapRadialChoiceAction = 'direct' | 'digivolve' | 'mode-change'

export interface MapRadialOptions {
  attacks: MapRadialItem[]
  stances: MapRadialItem[]
  direct?: MapRadialItem[]
  digivolve?: MapRadialItem[]
  'mode-change'?: MapRadialItem[]
}
