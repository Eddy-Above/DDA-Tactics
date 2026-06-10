import type { Stance } from '~/types'

export const STANCE_COLORS: Record<Stance, string> = {
  neutral: '#4b5563', // gray-600
  defensive: '#2563eb', // blue-600
  offensive: '#dc2626', // red-600
  sniper: '#9333ea', // purple-600
  brave: '#ca8a04', // yellow-600
}

export function applyStanceToAccuracy(pool: number, stance: string): number {
  if (stance === 'defensive') return Math.ceil(pool / 2)
  if (stance === 'offensive') return Math.floor(pool * 1.5)
  return pool
}

export function applyStanceToDodge(pool: number, stance: string): number {
  if (stance === 'defensive') return Math.floor(pool * 1.5)
  if (stance === 'offensive') return Math.ceil(pool / 2)
  return pool
}
