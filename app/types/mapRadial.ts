/** A menu choice; branches open an outer ring and leaves are returned to the map. */
export interface MapRadialItem {
  id: string
  label: string
  icon?: string
  description?: string
  disabled?: boolean
  active?: boolean
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
