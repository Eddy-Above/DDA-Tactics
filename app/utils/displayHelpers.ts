import type { DigimonStage } from '../types'

/**
 * Display color mappings for Digimon stages and attributes
 * Extracted from duplicate definitions across multiple page components
 */

/**
 * Get text color class for a Digimon stage
 * @param stage - The Digimon stage
 * @returns Tailwind text color class
 */
export function getStageTextColor(stage: DigimonStage): string {
  const colors: Record<DigimonStage, string> = {
    fresh: 'text-digimon-stage-fresh',
    'in-training': 'text-digimon-stage-intraining',
    rookie: 'text-digimon-stage-rookie',
    champion: 'text-digimon-stage-champion',
    ultimate: 'text-digimon-stage-ultimate',
    mega: 'text-digimon-stage-mega',
    ultra: 'text-digimon-stage-ultra',
  }
  return colors[stage] || 'text-gray-400'
}

/**
 * Get badge color classes for a Digimon stage (background + text)
 * @param stage - The Digimon stage
 * @returns Tailwind background and text color classes
 */
export function getStageBadgeColor(stage: DigimonStage): string {
  const colors: Record<DigimonStage, string> = {
    fresh: 'bg-digimon-stage-fresh/20 text-digimon-stage-fresh',
    'in-training': 'bg-digimon-stage-intraining/20 text-digimon-stage-intraining',
    rookie: 'bg-digimon-stage-rookie/20 text-digimon-stage-rookie',
    champion: 'bg-digimon-stage-champion/20 text-digimon-stage-champion',
    ultimate: 'bg-digimon-stage-ultimate/20 text-digimon-stage-ultimate',
    mega: 'bg-digimon-stage-mega/20 text-digimon-stage-mega',
    ultra: 'bg-digimon-stage-ultra/20 text-digimon-stage-ultra',
  }
  return colors[stage] || 'bg-gray-500/20 text-gray-400'
}

/**
 * Get text color class for a Digimon attribute
 * @param attr - The Digimon attribute
 * @returns Tailwind text color class
 */
export function getAttributeColor(attr: string): string {
  const colors: Record<string, string> = {
    vaccine: 'text-digimon-attr-vaccine',
    data: 'text-digimon-attr-data',
    virus: 'text-digimon-attr-virus',
    free: 'text-digimon-attr-free',
  }
  return colors[attr] || 'text-gray-400'
}

/**
 * Get badge color classes for a Digimon attribute (background + text)
 * @param attr - The Digimon attribute
 * @returns Tailwind background and text color classes
 */
export function getAttributeBadgeColor(attr: string): string {
  const colors: Record<string, string> = {
    vaccine: 'bg-digimon-attr-vaccine/20 text-digimon-attr-vaccine',
    data: 'bg-digimon-attr-data/20 text-digimon-attr-data',
    virus: 'bg-digimon-attr-virus/20 text-digimon-attr-virus',
    free: 'bg-digimon-attr-free/20 text-digimon-attr-free',
  }
  return colors[attr] || 'bg-gray-500/20 text-gray-400'
}

/**
 * Get color classes for a quality type tag
 * @param qualityType - The quality type ('static', 'trigger', or 'attack')
 * @returns Tailwind background and text color classes
 */
export function getQualityTypeColor(qualityType: 'static' | 'trigger' | 'attack'): string {
  switch (qualityType) {
    case 'static':
      return 'bg-blue-900/30 text-blue-400'
    case 'trigger':
      return 'bg-yellow-900/30 text-yellow-400'
    case 'attack':
      return 'bg-red-900/30 text-red-400'
    default:
      return 'bg-digimon-dark-600 text-digimon-dark-300'
  }
}

// Legacy aliases for backwards compatibility
export const getStageColor = getStageTextColor
