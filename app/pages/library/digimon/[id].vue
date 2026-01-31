<script setup lang="ts">
import type { Digimon } from '../../../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize, type DigimonFamily } from '../../../types'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../../../data/qualities'

definePageMeta({
  title: 'Edit Digimon',
})

const route = useRoute()
const router = useRouter()
const { digimonList, fetchDigimonById, fetchDigimon, updateDigimon, copyDigimon, loading, error, getPreviousStages, getNextStages, getEvolutionChain } = useDigimon()
const { tamers, fetchTamers } = useTamers()
const copying = ref(false)

const digimon = ref<Digimon | null>(null)
const initialLoading = ref(true)

const form = reactive({
  name: '',
  species: '',
  stage: 'rookie' as DigimonStage,
  attribute: 'data' as 'vaccine' | 'data' | 'virus' | 'free',
  family: 'nature-spirits' as DigimonFamily,
  type: '',
  size: 'medium' as DigimonSize,
  baseStats: {
    accuracy: 3,
    damage: 3,
    dodge: 3,
    armor: 3,
    health: 3,
  },
  attacks: [] as Digimon['attacks'],
  qualities: [] as Digimon['qualities'],
  dataOptimization: '',
  bonusDP: 0,
  bonusStats: {
    accuracy: 0,
    damage: 0,
    dodge: 0,
    armor: 0,
    health: 0,
  },
  bonusDPForQualities: 0,
  syncBonusDP: true,
  partnerId: '' as string | null,
  isEnemy: false,
  notes: '',
  spriteUrl: '',
  evolvesFromId: null as string | null,
  evolutionPathIds: [] as string[],
})

// Collapsible sections
const basicInfoExpanded = ref(false)
const baseStatsExpanded = ref(false)

const stages: DigimonStage[] = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega']
const sizes: DigimonSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gigantic']
const attributes = ['vaccine', 'data', 'virus', 'free'] as const
const families: DigimonFamily[] = [
  'dark-empire',
  'deep-savers',
  'dragons-roar',
  'jungle-troopers',
  'metal-empire',
  'nature-spirits',
  'nightmare-soldiers',
  'unknown',
  'virus-busters',
  'wind-guardians',
]

// Family display names for dropdown
const familyLabels: Record<DigimonFamily, string> = {
  'dark-empire': 'Dark Empire',
  'deep-savers': 'Deep Savers',
  'dragons-roar': "Dragon's Roar",
  'jungle-troopers': 'Jungle Troopers',
  'metal-empire': 'Metal Empire',
  'nature-spirits': 'Nature Spirits',
  'nightmare-soldiers': 'Nightmare Soldiers',
  'unknown': 'Unknown',
  'virus-busters': 'Virus Busters',
  'wind-guardians': 'Wind Guardians',
}

const currentStageConfig = computed(() => STAGE_CONFIG[form.stage])
const currentSizeConfig = computed(() => SIZE_CONFIG[form.size])

// DP calculation - DDA 1.4 rules:
// Base stats cost 1 DP per point from BASE DP pool
// Qualities cost from BASE DP pool OR bonus quality DP pool
const dpUsedOnStats = computed(() => {
  return Object.values(form.baseStats).reduce((a, b) => a + b, 0)
})

const dpUsedOnQualities = computed(() => {
  return form.qualities.reduce((total, q) => total + (q.dpCost || 0) * (q.ranks || 1), 0)
})

// Base DP pool (from stage only - NOT including bonus DP)
const baseDP = computed(() => {
  return currentStageConfig.value.dp
})

// How much of quality spending comes from base DP (vs bonus DP for qualities)
const qualitiesFromBaseDP = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return Math.min(dpUsedOnQualities.value, baseDPAvailableForQualities)
})

// Base DP used = stats + qualities (only qualities that fit in remaining base DP)
// Qualities beyond base DP are paid from bonus DP for qualities
const baseDPUsed = computed(() => {
  return dpUsedOnStats.value + qualitiesFromBaseDP.value
})

// Base DP remaining (can go negative if overspent)
const baseDPRemaining = computed(() => {
  return baseDP.value - baseDPUsed.value
})

// Total bonus DP spent on stats
const bonusStatsTotal = computed(() => {
  return Object.values(form.bonusStats).reduce((a, b) => a + b, 0)
})

// Bonus DP available for stats (excluding DP allocated to qualities)
const bonusDPForStats = computed(() => {
  return Math.max(0, (form.bonusDP || 0) - (form.bonusDPForQualities || 0))
})

// Check if bonus stats overspent (using DP meant for qualities)
const bonusStatsOverspent = computed(() => {
  return bonusStatsTotal.value > bonusDPForStats.value
})

// Total bonus DP allocated (stats + qualities)
const bonusDPAllocated = computed(() => {
  return bonusStatsTotal.value + (form.bonusDPForQualities || 0)
})

// Bonus DP remaining
const bonusDPRemaining = computed(() => {
  return (form.bonusDP || 0) - bonusDPAllocated.value
})

// Can add qualities if there's DP available for qualities
// Available = (base DP not used on stats) + bonus DP for qualities
// BUT also must not exceed total bonus DP budget
// Total DP budget for qualities
const totalDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
})

// Available DP for adding new qualities
const availableDPForQualities = computed(() => {
  return Math.max(0, totalDPForQualities.value - dpUsedOnQualities.value)
})

const canAddQualities = computed(() => {
  // Check 1: Is there room in the quality budget?
  const hasRoomInQualityBudget = dpUsedOnQualities.value < totalDPForQualities.value

  // Check 2: Is the bonus DP allocation valid (not over-allocated)?
  const bonusDPValid = bonusDPRemaining.value >= 0

  return hasRoomInQualityBudget && bonusDPValid
})

// Minimum bonus DP required for qualities (quality spending that exceeds base DP coverage)
const minBonusDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return Math.max(0, dpUsedOnQualities.value - baseDPAvailableForQualities)
})

// Maximum bonus DP that can be allocated to qualities (total bonus DP minus what's used on stats)
const maxBonusDPForQualities = computed(() => {
  return Math.max(minBonusDPForQualities.value, (form.bonusDP || 0) - bonusStatsTotal.value)
})

// For display compatibility
const totalDP = computed(() => baseDP.value)
const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
const dpRemaining = computed(() => baseDPRemaining.value)

// Derived Stats calculation - DDA 1.4 rules (page 111)
const derivedStats = computed(() => {
  // Total stats = base + bonus
  const accuracy = form.baseStats.accuracy + (form.bonusStats.accuracy || 0)
  const damage = form.baseStats.damage + (form.bonusStats.damage || 0)
  const dodge = form.baseStats.dodge + (form.bonusStats.dodge || 0)
  const armor = form.baseStats.armor + (form.bonusStats.armor || 0)
  const health = form.baseStats.health + (form.bonusStats.health || 0)

  const stageConfig = currentStageConfig.value
  const sizeConfig = currentSizeConfig.value

  // Primary Derived Stats (always round down)
  // Size affects Body and Agility differently (page 110)
  const brains = Math.floor(accuracy / 2) + stageConfig.brainsBonus
  const body = Math.max(0, Math.floor((health + damage + armor) / 3) + sizeConfig.bodyBonus)
  const agility = Math.max(0, Math.floor((accuracy + dodge) / 2) + sizeConfig.agilityBonus)

  // Spec Values (derived from derived stats)
  const bit = Math.floor(brains / 10) + stageConfig.stageBonus
  const cpu = Math.floor(body / 10) + stageConfig.stageBonus
  const ram = Math.floor(agility / 10) + stageConfig.stageBonus

  // Movement calculation with Speedy bonus
  const baseMovement = stageConfig.movement
  const speedyQuality = form.qualities.find(q => q.id === 'speedy')
  const speedyRanks = speedyQuality?.ranks || 0
  const speedyBonus = speedyRanks * 2
  // Speedy cannot more than double base movement
  const maxSpeedyBonus = baseMovement
  const movement = baseMovement + Math.min(speedyBonus, maxSpeedyBonus)

  return {
    // Primary derived stats
    brains,
    body,
    agility,
    // Spec Values (BIT, CPU, RAM)
    bit,
    cpu,
    ram,
    // Combat stats
    woundBoxes: health + stageConfig.woundBonus,
    movement,
    baseMovement,
    stageBonus: stageConfig.stageBonus,
    // Attack/Defense pools (total stats = base + bonus)
    accuracyPool: accuracy,
    damagePool: damage,
    dodgePool: dodge,
    armorValue: armor,
  }
})

// Toggle for custom attack form
const showCustomAttackForm = ref(false)

// Track which attack is being edited (-1 means creating new)
const editingAttackIndex = ref(-1)

// New attack form - DDA 1.4 structure
const newAttack = reactive({
  name: '',
  range: 'melee' as 'melee' | 'ranged',
  type: 'damage' as 'damage' | 'support',
  tags: [] as string[],
  effect: '' as string | undefined,
  description: '',
})

// Effect alignment: P = Support only, N = Damage only, NA = Both
const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
  'Vigor': 'P', 'Fury': 'P', 'Cleanse': 'P', 'Haste': 'P', 'Revitalize': 'P', 'Shield': 'P',
  'Poison': 'N', 'Confuse': 'N', 'Stun': 'N', 'Fear': 'N', 'Immobilize': 'N',
  'Lifesteal': 'NA', 'Knockback': 'NA', 'Pull': 'NA', 'Taunt': 'NA',
}

// Tag restrictions: which range/type they require
const TAG_RESTRICTIONS: Record<string, { range?: 'melee' | 'ranged'; type?: 'damage' | 'support' }> = {
  'Charge Attack': { range: 'melee' },
  'Mighty Blow': { range: 'melee' },
  'Area Attack: Pass': { range: 'melee' },
  'Area Attack: Blast': { range: 'ranged' },
}

// Watch for attack type changes - clear invalid effects
watch(() => newAttack.type, (newType) => {
  if (newAttack.effect) {
    const alignment = EFFECT_ALIGNMENT[newAttack.effect]
    if (alignment === 'P' && newType !== 'support') {
      newAttack.effect = ''
    } else if (alignment === 'N' && newType !== 'damage') {
      newAttack.effect = ''
    }
  }
})

// Watch for attack range changes - clear invalid tags
watch(() => newAttack.range, (newRange) => {
  newAttack.tags = newAttack.tags.filter((tag) => {
    const restriction = TAG_RESTRICTIONS[tag]
    if (restriction?.range && restriction.range !== newRange) {
      return false
    }
    return true
  })
})

// Watch for attack type changes - clear invalid tags
watch(() => newAttack.type, (newType) => {
  newAttack.tags = newAttack.tags.filter((tag) => {
    const restriction = TAG_RESTRICTIONS[tag]
    if (restriction?.type && restriction.type !== newType) {
      return false
    }
    return true
  })
})

type Attack = Digimon['attacks'][0]

function handleAddAttack(attack: Attack) {
  form.attacks = [...form.attacks, attack]
}

// Tag validation rules based on DDA 1.4
interface AttackTagRule {
  id: string
  name: string
  description: string
  rangeRestriction?: 'melee' | 'ranged' // null = both allowed
  typeRestriction?: 'damage' | 'support' // null = both allowed
  conflictsWith?: string[] // Tags that can't be combined with this one
  allowedWithSignature?: string[] // Conflicts that Signature Move overrides
}

// Get tags already used by existing attacks (Attack qualities can only apply to ONE attack, except Weapon which can apply to Rank attacks)
const usedAttackTags = computed(() => {
  const used = new Set<string>()
  for (const attack of form.attacks) {
    for (const tag of attack.tags) {
      // Normalize tag name to quality ID (e.g., "Weapon 2" -> "weapon", "Charge Attack" -> "charge-attack")
      const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
      used.add(normalized)
    }
  }
  return used
})

// Count how many attacks have a specific tag
function countAttacksWithTag(qualityId: string): number {
  let count = 0
  const pattern = qualityId.replace(/-/g, ' ')
  for (const attack of form.attacks) {
    for (const tag of attack.tags) {
      const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
      if (normalized === qualityId) {
        count++
      }
    }
  }
  return count
}

// Check if a quality-based tag is already used on another attack
function isTagAlreadyUsed(qualityId: string): boolean {
  return usedAttackTags.value.has(qualityId)
}

// Get available tags based on owned qualities AND current attack state
const availableAttackTags = computed(() => {
  const tags: Array<AttackTagRule & { disabled: boolean; disabledReason?: string }> = []
  const currentRange = newAttack.range
  const currentType = newAttack.type
  const currentTags = newAttack.tags
  const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

  for (const quality of form.qualities) {
    // Weapon - can be applied to a number of attacks equal to its rank
    if (quality.id === 'weapon') {
      const weaponRank = quality.ranks || 1
      const weaponUsedCount = countAttacksWithTag('weapon')
      const atMaxUses = weaponUsedCount >= weaponRank
      tags.push({
        id: 'weapon',
        name: `Weapon ${weaponRank}`,
        description: `+${weaponRank} Accuracy and Damage (${weaponUsedCount}/${weaponRank} attacks tagged)`,
        disabled: atMaxUses,
        disabledReason: atMaxUses ? `Already applied to ${weaponRank} attack${weaponRank > 1 ? 's' : ''} (max for rank ${weaponRank})` : undefined,
      })
    }

    // Armor Piercing - conflicts with Certain Strike (unless Signature Move)
    if (quality.id === 'armor-piercing') {
      const alreadyUsed = isTagAlreadyUsed('armor-piercing')
      const hasCertainStrike = currentTags.some((t) => t.includes('Certain Strike'))
      const blocked = alreadyUsed || (hasCertainStrike && !hasSignatureMove)
      tags.push({
        id: 'armor-piercing',
        name: `Armor Piercing ${quality.ranks || 1}`,
        description: `Ignores ${(quality.ranks || 1) * 2} Armor`,
        conflictsWith: ['certain-strike'],
        allowedWithSignature: ['certain-strike'],
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Certain Strike (unless Signature Move)' : undefined,
      })
    }

    // Certain Strike - conflicts with Armor Piercing (unless Signature Move)
    if (quality.id === 'certain-strike') {
      const alreadyUsed = isTagAlreadyUsed('certain-strike')
      const hasArmorPiercing = currentTags.some((t) => t.includes('Armor Piercing'))
      const blocked = alreadyUsed || (hasArmorPiercing && !hasSignatureMove)
      tags.push({
        id: 'certain-strike',
        name: `Certain Strike ${quality.ranks || 1}`,
        description: 'Auto-successes on accuracy',
        conflictsWith: ['armor-piercing'],
        allowedWithSignature: ['armor-piercing'],
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Armor Piercing (unless Signature Move)' : undefined,
      })
    }

    // Charge Attack - MELEE ONLY
    if (quality.id === 'charge-attack') {
      const alreadyUsed = isTagAlreadyUsed('charge-attack')
      const blocked = alreadyUsed || currentRange !== 'melee'
      tags.push({
        id: 'charge-attack',
        name: 'Charge Attack',
        description: 'Move and attack as one Simple Action',
        rangeRestriction: 'melee',
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
      })
    }

    // Mighty Blow - MELEE ONLY
    if (quality.id === 'mighty-blow') {
      const alreadyUsed = isTagAlreadyUsed('mighty-blow')
      const blocked = alreadyUsed || currentRange !== 'melee'
      tags.push({
        id: 'mighty-blow',
        name: 'Mighty Blow',
        description: 'Stun on high damage',
        rangeRestriction: 'melee',
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
      })
    }

    // Signature Move - restrictions with certain effects
    if (quality.id === 'signature-move') {
      const alreadyUsed = isTagAlreadyUsed('signature-move')
      const hasPoison = currentTags.some((t) => t.includes('Poison'))
      const hasHazard = currentTags.some((t) => t.includes('Hazard'))
      const hasRevitalize = currentTags.some((t) => t.includes('Revitalize'))
      const hasAmmo = currentTags.some((t) => t.includes('Ammo'))
      const blocked = alreadyUsed || hasPoison || hasHazard || hasRevitalize || hasAmmo
      tags.push({
        id: 'signature-move',
        name: 'Signature Move',
        description: 'Powerful attack (available Round 3+, 2 round cooldown)',
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Poison, Hazard, Revitalize, or Ammo' : undefined,
      })
    }

    // Ammo - requires 3 tags total (including free Damage/Support + Melee/Ranged), cannot combine with Signature Move
    if (quality.id === 'ammo') {
      const alreadyUsed = isTagAlreadyUsed('ammo')
      const hasSignature = currentTags.some((t) => t.includes('Signature Move'))
      // Need at least 1 other quality-based tag (since Damage/Support and Melee/Ranged are free)
      const hasEnoughTags = currentTags.length >= 1
      const blocked = alreadyUsed || hasSignature || !hasEnoughTags
      let reason: string | undefined
      if (alreadyUsed) reason = 'Already used on another attack'
      else if (hasSignature) reason = 'Cannot combine with Signature Move'
      else if (!hasEnoughTags) reason = 'Requires at least 1 other tag first'
      tags.push({
        id: 'ammo',
        name: 'Ammo',
        description: 'Use attack up to 5 times consecutively (then unavailable for battle)',
        disabled: blocked,
        disabledReason: reason,
      })
    }

    // Area Attack options (with range restrictions)
    // Each Area Attack sub-option can only be used on ONE attack
    if (quality.id === 'area-attack') {
      const choiceId = quality.choiceId
      // Blast - RANGED ONLY
      if (!choiceId || choiceId === 'blast') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-blast')
        const blocked = alreadyUsed || currentRange !== 'ranged'
        tags.push({
          id: 'area-blast',
          name: 'Area Attack: Blast',
          description: `Circle at range (3m +BIT diameter)`,
          rangeRestriction: 'ranged',
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Ranged] attack' : undefined,
        })
      }
      // Pass - MELEE ONLY
      if (!choiceId || choiceId === 'pass') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-pass')
        const blocked = alreadyUsed || currentRange !== 'melee'
        tags.push({
          id: 'area-pass',
          name: 'Area Attack: Pass',
          description: 'Charge through enemies in a line',
          rangeRestriction: 'melee',
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
        })
      }
      // Burst, Close Blast, Cone, Line - both ranges allowed
      if (!choiceId || choiceId === 'burst') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-burst')
        tags.push({
          id: 'area-burst',
          name: 'Area Attack: Burst',
          description: 'Circle from user (1m +BIT+1 radius)',
          disabled: alreadyUsed,
          disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
        })
      }
      if (!choiceId || choiceId === 'close-blast') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-close-blast')
        tags.push({
          id: 'area-close-blast',
          name: 'Area Attack: Close Blast',
          description: 'Circle adjacent to user (2m +BIT radius)',
          disabled: alreadyUsed,
          disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
        })
      }
      if (!choiceId || choiceId === 'cone') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-cone')
        tags.push({
          id: 'area-cone',
          name: 'Area Attack: Cone',
          description: 'Triangle from user (3m +BIT length)',
          disabled: alreadyUsed,
          disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
        })
      }
      if (!choiceId || choiceId === 'line') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-line')
        tags.push({
          id: 'area-line',
          name: 'Area Attack: Line',
          description: 'Pillar from user (5m +BIT×2 length)',
          disabled: alreadyUsed,
          disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
        })
      }
    }
  }

  return tags
})

// Get effects already used by existing attacks
const usedEffects = computed(() => {
  const used = new Set<string>()
  for (const attack of form.attacks) {
    if (attack.effect) {
      used.add(attack.effect.toLowerCase())
    }
  }
  return used
})

// Get available effect tags based on owned qualities AND attack type
// [P] Positive effects = Support attacks only
// [N] Negative effects = Damage attacks only
// [N/A] = Both types allowed
const availableEffectTags = computed(() => {
  const currentType = newAttack.type
  const currentTags = newAttack.tags
  const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

  // Effect alignment: P = Support only, N = Damage only, NA = Both
  const effectAlignment: Record<string, 'P' | 'N' | 'NA'> = {
    'effect-vigor': 'P',
    'effect-fury': 'P',
    'effect-cleanse': 'P',
    'effect-haste': 'P',
    'effect-revitalize': 'P',
    'effect-shield': 'P',
    'effect-poison': 'N',
    'effect-confuse': 'N',
    'effect-stun': 'N',
    'effect-fear': 'N',
    'effect-immobilize': 'N',
    'effect-taunt': 'N',
    'effect-lifesteal': 'NA',
    'effect-knockback': 'NA',
    'effect-pull': 'NA',
  }

  // Signature Move restrictions
  const signatureRestricted = ['effect-poison', 'effect-hazard', 'effect-revitalize']

  return form.qualities
    .filter((q) => q.id.startsWith('effect-'))
    .map((q) => {
      const alignment = effectAlignment[q.id] || 'NA'
      const effectName = q.name
      const alreadyUsed = usedEffects.value.has(effectName.toLowerCase())
      let disabled = alreadyUsed
      let disabledReason: string | undefined = alreadyUsed ? 'Already used on another attack' : undefined

      // Check type restriction
      if (!disabled && alignment === 'P' && currentType !== 'support') {
        disabled = true
        disabledReason = 'Requires [Support] attack'
      } else if (!disabled && alignment === 'N' && currentType !== 'damage') {
        disabled = true
        disabledReason = 'Requires [Damage] attack'
      }

      // Check Signature Move restriction
      if (!disabled && hasSignatureMove && signatureRestricted.includes(q.id)) {
        disabled = true
        disabledReason = 'Cannot use with Signature Move'
      }

      return {
        id: q.id.replace('effect-', ''),
        name: q.name,
        alignment,
        disabled,
        disabledReason,
      }
    })
})

function addTagToAttack(tagName: string) {
  if (!newAttack.tags.includes(tagName)) {
    newAttack.tags = [...newAttack.tags, tagName]
  }
}

function removeTagFromAttack(tagName: string) {
  newAttack.tags = newAttack.tags.filter((t) => t !== tagName)
}

function addCustomAttack() {
  if (!newAttack.name) return

  const attackData = {
    id: editingAttackIndex.value >= 0
      ? form.attacks[editingAttackIndex.value].id
      : `attack-${Date.now()}`,
    name: newAttack.name,
    range: newAttack.range,
    type: newAttack.type,
    tags: [...newAttack.tags],
    effect: newAttack.effect || undefined,
    description: newAttack.description,
  }

  if (editingAttackIndex.value >= 0) {
    // Update existing attack
    form.attacks = form.attacks.map((attack, i) =>
      i === editingAttackIndex.value ? attackData : attack
    )
  } else {
    // Add new attack
    form.attacks = [...form.attacks, attackData]
  }

  // Reset form
  newAttack.name = ''
  newAttack.range = 'melee'
  newAttack.type = 'damage'
  newAttack.tags = []
  newAttack.effect = ''
  newAttack.description = ''
  editingAttackIndex.value = -1
  showCustomAttackForm.value = false
}

function removeAttack(index: number) {
  form.attacks = form.attacks.filter((_, i) => i !== index)
}

function editAttack(index: number) {
  const attack = form.attacks[index]
  if (!attack) return

  // Populate the form with existing attack data
  newAttack.name = attack.name
  newAttack.range = attack.range
  newAttack.type = attack.type
  newAttack.tags = [...attack.tags]
  newAttack.effect = attack.effect || ''
  newAttack.description = attack.description

  editingAttackIndex.value = index
  showCustomAttackForm.value = true
}

type Quality = Digimon['qualities'][0]

function handleAddQuality(quality: Quality) {
  // Check if adding this quality would exceed the budget
  const qualityCost = (quality.dpCost || 0) * (quality.ranks || 1)
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  const totalDPForQualities = baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
  const newTotalUsed = dpUsedOnQualities.value + qualityCost

  if (newTotalUsed > totalDPForQualities) {
    // Would exceed budget - don't add
    return
  }

  form.qualities = [...form.qualities, quality]
}

function handleUpdateQualityRanks(index: number, ranks: number) {
  if (!form.qualities[index]) return

  const quality = form.qualities[index]
  const currentCost = (quality.dpCost || 0) * (quality.ranks || 1)
  const newCost = (quality.dpCost || 0) * ranks
  const costIncrease = newCost - currentCost

  // Check if the increase would exceed the budget
  if (costIncrease > 0) {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    const totalDPForQualities = baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
    const newTotalUsed = dpUsedOnQualities.value + costIncrease

    if (newTotalUsed > totalDPForQualities) {
      return
    }
  }

  // Create a new array with the updated quality
  form.qualities = form.qualities.map((q, i) =>
    i === index ? { ...q, ranks } : q
  )
}

// Map quality ID to tag pattern for attack filtering
function getTagPatternForQuality(qualityId: string): string | null {
  const patterns: Record<string, string> = {
    'weapon': 'Weapon',
    'armor-piercing': 'Armor Piercing',
    'certain-strike': 'Certain Strike',
    'charge-attack': 'Charge Attack',
    'mighty-blow': 'Mighty Blow',
    'signature-move': 'Signature Move',
    'ammo': 'Ammo',
    'area-attack': 'Area Attack',
  }
  return patterns[qualityId] || null
}

function removeQuality(index: number) {
  const qualityToRemove = form.qualities[index]
  if (!qualityToRemove) return

  // Remove the quality
  form.qualities = form.qualities.filter((_, i) => i !== index)

  // Remove attacks that use tags from this quality
  const tagPattern = getTagPatternForQuality(qualityToRemove.id)
  if (tagPattern) {
    form.attacks = form.attacks.filter((attack) => {
      // Check if any tag starts with the pattern
      const hasTag = attack.tags.some((t) => t.startsWith(tagPattern))
      return !hasTag
    })
  }

  // If it's an effect quality, remove attacks that use this effect
  if (qualityToRemove.id.startsWith('effect-')) {
    const effectName = qualityToRemove.name
    form.attacks = form.attacks.filter((attack) => {
      return attack.effect !== effectName
    })
  }
}

// Old free-form tag functions removed - now using quality-based tags

// Sprite preview
const spriteError = ref(false)
function handleSpriteError() {
  spriteError.value = true
}
watch(() => form.spriteUrl, () => {
  spriteError.value = false
})

// Enforce bonus DP for qualities stays within valid range
watch(() => form.bonusDPForQualities, (newVal) => {
  if (newVal < minBonusDPForQualities.value) {
    form.bonusDPForQualities = minBonusDPForQualities.value
  } else if (newVal > maxBonusDPForQualities.value) {
    form.bonusDPForQualities = maxBonusDPForQualities.value
  }
})

// Also enforce when bonus stats change (which affects maxBonusDPForQualities)
watch(() => bonusStatsTotal.value, () => {
  if (form.bonusDPForQualities > maxBonusDPForQualities.value) {
    form.bonusDPForQualities = maxBonusDPForQualities.value
  }
})

// Enforce when quality spending changes (which affects minBonusDPForQualities)
watch(() => minBonusDPForQualities.value, (newMin) => {
  if (form.bonusDPForQualities < newMin) {
    form.bonusDPForQualities = newMin
  }
})

// Track previous stat values to revert changes that exceed limits
const prevBonusStats = ref({ ...form.bonusStats })
const prevBaseStats = ref({ ...form.baseStats })

// Enforce bonus stats don't exceed available bonus DP for stats
watch(() => form.bonusStats, (stats) => {
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  const max = bonusDPForStats.value
  if (total > max) {
    // Find which stat changed and revert it
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
      if (stats[key] !== prevBonusStats.value[key]) {
        form.bonusStats[key] = prevBonusStats.value[key]
      }
    }
  } else {
    // Update previous values
    prevBonusStats.value = { ...stats }
  }
}, { deep: true })

// Enforce base stats don't exceed base DP (accounting for qualities that use base DP)
watch(() => form.baseStats, (stats) => {
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  // Qualities not covered by bonus DP must come from base DP
  const qualitiesFromBaseDP = Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0))
  const maxForStats = baseDP.value - qualitiesFromBaseDP
  if (total > maxForStats) {
    // Find which stat changed and revert it
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
      if (stats[key] !== prevBaseStats.value[key]) {
        form.baseStats[key] = prevBaseStats.value[key]
      }
    }
  } else {
    // Update previous values
    prevBaseStats.value = { ...stats }
  }
}, { deep: true })

onMounted(async () => {
  await Promise.all([fetchTamers(), fetchDigimon()])

  const id = route.params.id as string
  const fetched = await fetchDigimonById(id)
  if (fetched) {
    digimon.value = fetched
    form.name = fetched.name
    form.species = fetched.species
    form.stage = fetched.stage as DigimonStage
    form.attribute = fetched.attribute
    form.family = (fetched.family as DigimonFamily) || 'nature-spirits'
    form.type = fetched.type || ''
    form.size = (fetched.size as DigimonSize) || 'medium'
    Object.assign(form.baseStats, fetched.baseStats)
    form.attacks = [...(fetched.attacks || [])]
    form.qualities = [...(fetched.qualities || [])]
    form.dataOptimization = fetched.dataOptimization || ''
    form.bonusDP = fetched.bonusDP || 0
    const defaultBonusStats = { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }
    form.bonusStats = { ...defaultBonusStats, ...((fetched as any).bonusStats || {}) }
    form.bonusDPForQualities = (fetched as any).bonusDPForQualities || 0
    // Initialize previous values for stat enforcement
    prevBaseStats.value = { ...form.baseStats }
    prevBonusStats.value = { ...form.bonusStats }
    form.partnerId = fetched.partnerId || ''
    form.isEnemy = fetched.isEnemy
    form.notes = fetched.notes || ''
    form.spriteUrl = fetched.spriteUrl || ''
    form.evolvesFromId = fetched.evolvesFromId || null
    form.evolutionPathIds = [...(fetched.evolutionPathIds || [])]
  }
  initialLoading.value = false
})

// Watch for stage changes - adjust quality ranks and attack tags to new max
watch(() => form.stage, (newStage) => {
  if (!form.qualities) return

  // Adjust quality ranks to max allowed at new stage
  form.qualities = form.qualities.map(quality => {
    const template = QUALITY_DATABASE.find(t => t.id === quality.id)
    if (!template) return quality

    const maxRanks = getMaxRanksAtStage(template, newStage)
    if ((quality.ranks || 1) > maxRanks) {
      return { ...quality, ranks: maxRanks }
    }
    return quality
  })

  // Update attack tags that have ranks (e.g., "Weapon 2" -> "Weapon 1")
  if (form.attacks) {
    form.attacks = form.attacks.map(attack => {
      const updatedTags = attack.tags.map(tag => {
        // Check for ranked tags like "Weapon 2", "Armor Piercing 2", "Certain Strike 2"
        const rankMatch = tag.match(/^(.+?)\s+(\d+)$/)
        if (rankMatch) {
          const tagName = rankMatch[1]
          const qualityId = tagName.toLowerCase().replace(/\s+/g, '-')
          const quality = form.qualities.find(q => q.id === qualityId)
          if (quality) {
            const template = QUALITY_DATABASE.find(t => t.id === qualityId)
            if (template) {
              const maxRanks = getMaxRanksAtStage(template, newStage)
              const newRank = Math.min(quality.ranks || 1, maxRanks)
              return `${tagName} ${newRank}`
            }
          }
        }
        return tag
      })
      return { ...attack, tags: updatedTags }
    })
  }
})

async function handleSubmit() {
  if (!digimon.value) return
  const updated = await updateDigimon(digimon.value.id, {
    name: form.name,
    species: form.species,
    stage: form.stage,
    attribute: form.attribute,
    family: form.family,
    type: form.type || undefined,
    size: form.size,
    baseStats: { ...form.baseStats },
    attacks: [...form.attacks],
    qualities: [...form.qualities],
    dataOptimization: form.dataOptimization || undefined,
    bonusDP: form.bonusDP || 0,
    bonusStats: { ...form.bonusStats },
    bonusDPForQualities: form.bonusDPForQualities || 0,
    syncBonusDP: form.syncBonusDP,
    partnerId: form.partnerId || null,
    isEnemy: form.isEnemy,
    notes: form.notes || undefined,
    spriteUrl: form.spriteUrl || undefined,
    evolvesFromId: form.evolvesFromId || null,
    evolutionPathIds: [...form.evolutionPathIds],
  })
  if (updated) {
    router.push('/library/digimon')
  }
}

async function handleCopy() {
  if (!digimon.value) return
  copying.value = true
  try {
    const copy = await copyDigimon(digimon.value)
    if (copy) {
      router.push(`/library/digimon/${copy.id}`)
    }
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/digimon" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Digimon
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Edit Digimon</h1>
    </div>

    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading digimon...</div>
    </div>

    <div v-else-if="!digimon" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Digimon Not Found</h2>
      <NuxtLink
        to="/library/digimon"
        class="text-digimon-orange-400 hover:text-digimon-orange-300"
      >
        Return to Digimon list
      </NuxtLink>
    </div>

    <form v-else class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info (Collapsible) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <button
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="basicInfoExpanded = !basicInfoExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', basicInfoExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Basic Information</h2>
          </div>
          <span class="text-sm text-digimon-dark-400">
            {{ form.name || 'Unnamed' }} · {{ form.stage }} · {{ form.attribute }}
          </span>
        </button>

        <div v-show="basicInfoExpanded" class="px-6 pb-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Species</label>
            <input
              v-model="form.species"
              type="text"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Stage</label>
            <select
              v-model="form.stage"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
            >
              <option v-for="stage in stages" :key="stage" :value="stage" class="capitalize">
                {{ stage }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Attribute</label>
            <select
              v-model="form.attribute"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
            >
              <option v-for="attr in attributes" :key="attr" :value="attr" class="capitalize">
                {{ attr }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Size</label>
            <select
              v-model="form.size"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
            >
              <option v-for="size in sizes" :key="size" :value="size" class="capitalize">
                {{ size }}
              </option>
            </select>
            <div v-if="currentSizeConfig.bodyBonus !== 0 || currentSizeConfig.agilityBonus !== 0" class="text-xs text-digimon-dark-500 mt-1">
              Body {{ currentSizeConfig.bodyBonus >= 0 ? '+' : '' }}{{ currentSizeConfig.bodyBonus }},
              Agility {{ currentSizeConfig.agilityBonus >= 0 ? '+' : '' }}{{ currentSizeConfig.agilityBonus }}
            </div>
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Family</label>
            <select
              v-model="form.family"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option v-for="fam in families" :key="fam" :value="fam">
                {{ familyLabels[fam] }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Type</label>
            <input
              v-model="form.type"
              type="text"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Partner Tamer (Optional)</label>
            <select
              v-model="form.partnerId"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option value="">No Partner (Wild/Enemy)</option>
              <option v-for="tamer in tamers" :key="tamer.id" :value="tamer.id">
                {{ tamer.name }}
              </option>
            </select>
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="form.isEnemy"
                type="checkbox"
                class="w-5 h-5 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                       text-digimon-orange-500 focus:ring-digimon-orange-500"
              />
              <span class="text-white">This is an enemy Digimon</span>
            </label>
          </div>
        </div>
        </div>
      </div>

      <!-- Stage Info -->
      <div class="bg-digimon-dark-700/50 rounded-xl p-4 border border-digimon-dark-600">
        <h3 class="font-semibold text-digimon-orange-400 mb-2 capitalize">{{ form.stage }} Stage Stats</h3>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <span class="text-digimon-dark-400">Base DP:</span>
            <span class="text-white ml-1">{{ currentStageConfig.dp }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Total DP:</span>
            <span class="text-white ml-1 font-semibold">{{ totalDP }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Movement:</span>
            <span class="text-white ml-1">{{ currentStageConfig.movement }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Wound Bonus:</span>
            <span class="text-white ml-1">+{{ currentStageConfig.woundBonus }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Attacks:</span>
            <span class="text-white ml-1">{{ currentStageConfig.attacks }}</span>
          </div>
        </div>
      </div>

      <!-- Base Stats (Collapsible) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <button
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="baseStatsExpanded = !baseStatsExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', baseStatsExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Base Stats</h2>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span
              :class="[
                'text-sm px-3 py-1 rounded',
                baseDPRemaining === 0 && 'bg-green-900/30 text-green-400',
                baseDPRemaining > 0 && 'bg-yellow-900/30 text-yellow-400',
                baseDPRemaining < 0 && 'bg-red-900/30 text-red-400',
              ]"
            >
              {{ baseDPRemaining }} Base DP remaining
            </span>
            <span class="text-xs text-digimon-dark-400">
              Stats: {{ dpUsedOnStats }} DP | Qualities: {{ qualitiesFromBaseDP }} DP
            </span>
          </div>
        </button>

        <div v-show="baseStatsExpanded" class="px-6 pb-6">
        <div class="grid grid-cols-5 gap-4">
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Accuracy</label>
            <input
              v-model.number="form.baseStats.accuracy"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Damage</label>
            <input
              v-model.number="form.baseStats.damage"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Dodge</label>
            <input
              v-model.number="form.baseStats.dodge"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Armor</label>
            <input
              v-model.number="form.baseStats.armor"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Health</label>
            <input
              v-model.number="form.baseStats.health"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>

        <!-- Derived Stats Display -->
        <div class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Derived Stats</h3>

          <!-- Primary Derived Stats + Spec Values -->
          <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Brains</div>
              <div class="text-lg font-bold text-cyan-400">{{ derivedStats.brains }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Body</div>
              <div class="text-lg font-bold text-orange-400">{{ derivedStats.body }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Agility</div>
              <div class="text-lg font-bold text-green-400">{{ derivedStats.agility }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">BIT</div>
              <div class="text-lg font-bold text-cyan-400">{{ derivedStats.bit }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">CPU</div>
              <div class="text-lg font-bold text-orange-400">{{ derivedStats.cpu }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">RAM</div>
              <div class="text-lg font-bold text-green-400">{{ derivedStats.ram }}</div>
            </div>
          </div>

          <!-- Combat Stats -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Wound Boxes</div>
              <div class="text-lg font-bold text-red-400">{{ derivedStats.woundBoxes }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Movement</div>
              <div class="text-lg font-bold text-blue-400">{{ derivedStats.movement }}m</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Stage Bonus</div>
              <div class="text-lg font-bold text-purple-400">+{{ derivedStats.stageBonus }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Initiative</div>
              <div class="text-lg font-bold text-yellow-400">3d6 + {{ derivedStats.agility }}</div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <!-- Bonus DP Section -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Bonus DP</h2>
          <div
            :class="[
              'text-sm px-3 py-1 rounded',
              bonusDPAllocated === form.bonusDP
                ? 'bg-green-900/30 text-green-400'
                : bonusDPAllocated > form.bonusDP
                  ? 'bg-red-900/30 text-red-400'
                  : 'bg-yellow-900/30 text-yellow-400',
            ]"
          >
            {{ bonusDPAllocated }} / {{ form.bonusDP }} allocated
          </div>
        </div>
        <!-- Sync checkbox for evolution chains -->
        <label
          v-if="form.evolvesFromId || form.evolutionPathIds.length > 0"
          class="flex items-center gap-2 cursor-pointer mb-4"
        >
          <input
            v-model="form.syncBonusDP"
            type="checkbox"
            class="w-4 h-4 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                   text-digimon-orange-500 focus:ring-digimon-orange-500"
          />
          <span class="text-sm text-digimon-dark-300">Sync across evolutions</span>
        </label>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Total Bonus DP</label>
            <input
              v-model.number="form.bonusDP"
              type="number"
              min="0"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
            <p class="text-xs text-digimon-dark-500 mt-1">XP earned, GM rewards, etc.</p>
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Allocated to Qualities</label>
            <input
              v-model.number="form.bonusDPForQualities"
              type="number"
              :min="minBonusDPForQualities"
              :max="maxBonusDPForQualities"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
            <p class="text-xs text-digimon-dark-500 mt-1">
              {{ minBonusDPForQualities > 0 ? `Min ${minBonusDPForQualities} required` : '' }}
              {{ minBonusDPForQualities > 0 && maxBonusDPForQualities < (form.bonusDP || 0) ? ' · ' : '' }}
              {{ maxBonusDPForQualities < (form.bonusDP || 0) ? `Max ${maxBonusDPForQualities} (stats using ${bonusStatsTotal})` : '' }}
            </p>
          </div>
        </div>

        <!-- Bonus Stats Allocation -->
        <div class="border-t border-digimon-dark-600 pt-4">
          <div class="flex justify-between items-center mb-3">
            <h3 :class="['text-sm font-semibold', bonusStatsOverspent ? 'text-red-400' : 'text-digimon-dark-300']">
              Bonus Stats ({{ bonusStatsTotal }} / {{ bonusDPForStats }} DP)
              <span v-if="bonusStatsOverspent" class="text-red-400">⚠️</span>
            </h3>
          </div>
          <div class="grid grid-cols-5 gap-3">
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Accuracy</label>
              <input
                v-model.number="form.bonusStats.accuracy"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Damage</label>
              <input
                v-model.number="form.bonusStats.damage"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Dodge</label>
              <input
                v-model.number="form.bonusStats.dodge"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Armor</label>
              <input
                v-model.number="form.bonusStats.armor"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Health</label>
              <input
                v-model.number="form.bonusStats.health"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div v-if="form.syncBonusDP && (form.evolvesFromId || form.evolutionPathIds.length > 0)" class="mt-4 p-3 bg-cyan-900/20 border border-cyan-500/30 rounded-lg">
          <p class="text-sm text-cyan-400">
            Bonus DP and stat allocations will sync to all linked evolution forms when you save.
          </p>
        </div>
      </div>

      <!-- Attacks -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">
          Attacks ({{ form.attacks.length }} / {{ currentStageConfig.attacks }})
        </h2>

        <!-- Custom attack toggle -->
        <div v-if="form.attacks.length < currentStageConfig.attacks || showCustomAttackForm" class="mb-4">
          <button
            v-if="!showCustomAttackForm && form.attacks.length < currentStageConfig.attacks"
            type="button"
            class="w-full border-2 border-dashed border-digimon-dark-600 rounded-lg p-4
                   text-digimon-dark-400 hover:border-digimon-dark-500 hover:text-digimon-dark-300
                   transition-colors"
            @click="showCustomAttackForm = true"
          >
            + Create Custom Attack
          </button>

          <!-- Custom attack form -->
          <div v-else class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
            <div class="flex justify-between items-center mb-3">
              <h3 class="text-sm font-semibold text-digimon-dark-300">
                {{ editingAttackIndex >= 0 ? 'Edit Attack' : 'Create Custom Attack' }}
              </h3>
              <button
                type="button"
                class="text-digimon-dark-400 hover:text-white text-sm"
                @click="showCustomAttackForm = false; editingAttackIndex = -1"
              >
                Cancel
              </button>
            </div>
            <!-- Name -->
            <div>
              <label class="text-xs text-digimon-dark-400">Attack Name</label>
              <input
                v-model="newAttack.name"
                type="text"
                placeholder="Attack name"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
              />
            </div>

            <!-- Range and Type (DDA 1.4 core tags) -->
            <div class="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label class="text-xs text-digimon-dark-400">[Range]</label>
                <select
                  v-model="newAttack.range"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                         text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
                >
                  <option value="melee">[Melee] - Adjacent</option>
                  <option value="ranged">[Ranged] - {{ derivedStats.ram }}m (RAM)</option>
                </select>
                <p v-if="newAttack.range === 'ranged'" class="text-xs text-blue-400 mt-1">
                  Range: {{ derivedStats.ram }}m (based on RAM stat)
                </p>
                <p v-else class="text-xs text-red-400 mt-1">
                  Range: Adjacent targets only
                </p>
              </div>
              <div>
                <label class="text-xs text-digimon-dark-400">[Type]</label>
                <select
                  v-model="newAttack.type"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                         text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
                >
                  <option value="damage">[Damage]</option>
                  <option value="support">[Support]</option>
                </select>
                <p class="text-xs text-digimon-dark-500 mt-1">
                  {{ newAttack.type === 'damage' ? 'Deals damage to enemies' : 'Buffs allies or debuffs enemies' }}
                </p>
              </div>
            </div>

            <!-- Quality-based Tags -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Tags (from owned qualities)</label>
              <div v-if="availableAttackTags.length === 0" class="text-xs text-digimon-dark-500 mt-1">
                No attack-modifying qualities owned. Add qualities like Weapon, Armor Piercing, Area Attack, etc.
              </div>
              <div v-else class="flex flex-wrap gap-2 mt-1">
                <button
                  v-for="tag in availableAttackTags"
                  :key="tag.id"
                  type="button"
                  :disabled="tag.disabled"
                  :class="[
                    'text-xs px-2 py-1 rounded transition-colors relative group',
                    tag.disabled
                      ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed opacity-50'
                      : newAttack.tags.includes(tag.name)
                        ? 'bg-digimon-orange-500 text-white'
                        : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                  :title="tag.disabled ? tag.disabledReason : tag.description"
                  @click="!tag.disabled && (newAttack.tags.includes(tag.name) ? removeTagFromAttack(tag.name) : addTagToAttack(tag.name))"
                >
                  {{ tag.name }}
                  <span v-if="tag.rangeRestriction" class="ml-1 text-digimon-dark-500">[{{ tag.rangeRestriction === 'melee' ? 'M' : 'R' }}]</span>
                  <!-- Tooltip for disabled reason -->
                  <span
                    v-if="tag.disabled && tag.disabledReason"
                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-red-900/90 text-red-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  >
                    {{ tag.disabledReason }}
                  </span>
                </button>
              </div>
              <div v-if="newAttack.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
                <span class="text-xs text-digimon-dark-400">Selected:</span>
                <span
                  v-for="tag in newAttack.tags"
                  :key="tag"
                  class="text-xs bg-digimon-orange-500/20 text-digimon-orange-400 px-2 py-0.5 rounded flex items-center gap-1"
                >
                  {{ tag }}
                  <button type="button" class="text-red-400 hover:text-red-300" @click="removeTagFromAttack(tag)">&times;</button>
                </span>
              </div>
            </div>

            <!-- Effect (from effect qualities) -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Effect (optional)</label>
              <div v-if="availableEffectTags.length === 0" class="text-xs text-digimon-dark-500 mt-1">
                Add effect qualities (Poison, Paralysis, etc.) to enable attack effects.
              </div>
              <div v-else class="flex flex-wrap gap-2 mt-1">
                <button
                  v-for="effect in availableEffectTags"
                  :key="effect.id"
                  type="button"
                  :disabled="effect.disabled"
                  :class="[
                    'text-xs px-2 py-1 rounded transition-colors relative group',
                    effect.disabled
                      ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed opacity-50'
                      : newAttack.effect === effect.name
                        ? 'bg-purple-500 text-white'
                        : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                  :title="effect.disabled ? effect.disabledReason : `${effect.alignment === 'P' ? '[Support only]' : effect.alignment === 'N' ? '[Damage only]' : '[Any type]'}`"
                  @click="!effect.disabled && (newAttack.effect = newAttack.effect === effect.name ? '' : effect.name)"
                >
                  {{ effect.name }}
                  <span class="ml-1 text-digimon-dark-500">
                    [{{ effect.alignment === 'P' ? 'S' : effect.alignment === 'N' ? 'D' : '±' }}]
                  </span>
                  <!-- Tooltip for disabled reason -->
                  <span
                    v-if="effect.disabled && effect.disabledReason"
                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-red-900/90 text-red-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  >
                    {{ effect.disabledReason }}
                  </span>
                </button>
              </div>
              <p class="text-xs text-digimon-dark-500 mt-1">
                [S] = Support only, [D] = Damage only, [±] = Any type
              </p>
            </div>

            <!-- Description -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Description (flavor text)</label>
              <textarea
                v-model="newAttack.description"
                rows="2"
                placeholder="Describe the attack's appearance and style..."
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none resize-none mt-1"
              />
            </div>
            <button
              type="button"
              class="mt-3 bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded text-sm"
              @click="addCustomAttack"
            >
              {{ editingAttackIndex >= 0 ? 'Update Attack' : 'Add Custom Attack' }}
            </button>
          </div>
        </div>

        <!-- Attack Selector from Database -->
        <AttackSelector
          :stage="form.stage"
          :max-attacks="currentStageConfig.attacks"
          :current-attacks="form.attacks"
          :current-qualities="form.qualities"
          :base-stats="form.baseStats"
          :bonus-stats="form.bonusStats"
          :data-optimization="form.dataOptimization"
          @add="handleAddAttack"
          @remove="removeAttack"
          @edit="editAttack"
        />
      </div>

      <!-- Qualities -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Qualities</h2>
        <QualitySelector
          :stage="form.stage"
          :current-qualities="form.qualities"
          :can-add="canAddQualities"
          :available-d-p="availableDPForQualities"
          @add="handleAddQuality"
          @remove="removeQuality"
          @update-ranks="handleUpdateQualityRanks"
        />
      </div>

      <!-- Sprite -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Sprite / Image</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Sprite URL</label>
            <input
              v-model="form.spriteUrl"
              type="url"
              placeholder="https://example.com/digimon-sprite.png"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
            <p class="text-xs text-digimon-dark-500 mt-1">
              Enter a URL to a sprite or image. Common sources: Wikimon, DigimonWiki
            </p>
          </div>
          <div class="flex items-center justify-center">
            <div
              v-if="form.spriteUrl && !spriteError"
              class="w-32 h-32 bg-digimon-dark-700 rounded-lg overflow-hidden flex items-center justify-center"
            >
              <img
                :src="form.spriteUrl"
                :alt="form.name || 'Digimon sprite'"
                class="max-w-full max-h-full object-contain"
                @error="handleSpriteError"
              />
            </div>
            <div
              v-else
              class="w-32 h-32 bg-digimon-dark-700 rounded-lg flex items-center justify-center text-digimon-dark-500"
            >
              <span v-if="spriteError" class="text-red-400 text-xs text-center px-2">Failed to load image</span>
              <span v-else class="text-4xl">?</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Notes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Notes</h2>
        <textarea
          v-model="form.notes"
          rows="4"
          placeholder="Evolution requirements, special abilities, personality..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                 text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
      </div>

      <!-- Evolution Links -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Evolution Links</h2>
        <p class="text-sm text-digimon-dark-400 mb-4">
          Link this Digimon to its pre-evolution and evolutions. Changes sync automatically.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Evolves From -->
          <div>
            <DigimonSelector
              v-model="form.evolvesFromId"
              :stage="getPreviousStages(form.stage)"
              :exclude-ids="digimon ? [digimon.id] : []"
              label="Evolves From"
              placeholder="Select pre-evolution..."
            />
            <p v-if="getPreviousStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No earlier stages available (already at Fresh)
            </p>
          </div>

          <!-- Evolves To -->
          <div>
            <DigimonMultiSelector
              v-model="form.evolutionPathIds"
              :stage="getNextStages(form.stage)"
              :exclude-ids="digimon ? [digimon.id] : []"
              label="Evolves To"
              placeholder="Select evolutions..."
            />
            <p v-if="getNextStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No later stages available (already at Ultra)
            </p>
          </div>
        </div>

        <!-- Evolution Chain Preview -->
        <div v-if="digimon && digimonList.length > 0" class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain</h3>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Ancestors -->
            <template v-for="(ancestor, index) in getEvolutionChain(digimon, digimonList).ancestors" :key="ancestor.id">
              <NuxtLink
                :to="`/library/digimon/${ancestor.id}`"
                class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
              >
                <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    v-if="ancestor.spriteUrl"
                    :src="ancestor.spriteUrl"
                    :alt="ancestor.name"
                    class="max-w-full max-h-full object-contain"
                  />
                  <span v-else class="text-sm">🦖</span>
                </div>
                <div>
                  <div class="text-white text-sm font-medium">{{ ancestor.name }}</div>
                  <div class="text-xs text-digimon-dark-400 capitalize">{{ ancestor.stage }}</div>
                </div>
              </NuxtLink>
              <span class="text-digimon-dark-500 self-center">→</span>
            </template>

            <!-- Current (highlighted) -->
            <div class="flex items-center gap-2 bg-digimon-orange-500/20 border border-digimon-orange-500 rounded-lg px-3 py-2">
              <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                <img
                  v-if="form.spriteUrl"
                  :src="form.spriteUrl"
                  :alt="form.name"
                  class="max-w-full max-h-full object-contain"
                />
                <span v-else class="text-sm">🦖</span>
              </div>
              <div>
                <div class="text-digimon-orange-400 text-sm font-medium">{{ form.name || 'Current' }}</div>
                <div class="text-xs text-digimon-dark-400 capitalize">{{ form.stage }}</div>
              </div>
            </div>

            <!-- Descendants (tree structure) -->
            <template v-if="getEvolutionChain(digimon, digimonList).descendants.length > 0">
              <span class="text-digimon-dark-500 self-center">→</span>
              <!-- Single descendant - show inline -->
              <template v-if="getEvolutionChain(digimon, digimonList).descendants.length === 1">
                <NuxtLink
                  :to="`/library/digimon/${getEvolutionChain(digimon, digimonList).descendants[0].id}`"
                  class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                >
                  <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                    <img
                      v-if="getEvolutionChain(digimon, digimonList).descendants[0].spriteUrl"
                      :src="getEvolutionChain(digimon, digimonList).descendants[0].spriteUrl"
                      :alt="getEvolutionChain(digimon, digimonList).descendants[0].name"
                      class="max-w-full max-h-full object-contain"
                    />
                    <span v-else class="text-sm">🦖</span>
                  </div>
                  <div>
                    <div class="text-white text-sm font-medium">{{ getEvolutionChain(digimon, digimonList).descendants[0].name }}</div>
                    <div class="text-xs text-digimon-dark-400 capitalize">{{ getEvolutionChain(digimon, digimonList).descendants[0].stage }}</div>
                  </div>
                </NuxtLink>
              </template>
              <!-- Multiple descendants - show as vertical branch -->
              <template v-else>
                <div class="flex flex-col gap-2">
                  <NuxtLink
                    v-for="descendant in getEvolutionChain(digimon, digimonList).descendants"
                    :key="descendant.id"
                    :to="`/library/digimon/${descendant.id}`"
                    class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                  >
                    <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                      <img
                        v-if="descendant.spriteUrl"
                        :src="descendant.spriteUrl"
                        :alt="descendant.name"
                        class="max-w-full max-h-full object-contain"
                      />
                      <span v-else class="text-sm">🦖</span>
                    </div>
                    <div>
                      <div class="text-white text-sm font-medium">{{ descendant.name }}</div>
                      <div class="text-xs text-digimon-dark-400 capitalize">{{ descendant.stage }}</div>
                    </div>
                  </NuxtLink>
                </div>
              </template>
            </template>

            <!-- No links message -->
            <span
              v-if="getEvolutionChain(digimon, digimonList).ancestors.length === 0 && getEvolutionChain(digimon, digimonList).descendants.length === 0"
              class="text-digimon-dark-500 text-sm ml-2"
            >
              No evolution links yet
            </span>
          </div>
        </div>
      </div>

      <!-- Error message -->
      <div v-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
        {{ error }}
      </div>

      <!-- Submit -->
      <div class="flex gap-4">
        <button
          type="submit"
          :disabled="loading"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {{ loading ? 'Saving...' : 'Save Changes' }}
        </button>
        <button
          type="button"
          :disabled="copying"
          class="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
          @click="handleCopy"
        >
          {{ copying ? 'Copying...' : 'Copy' }}
        </button>
        <NuxtLink
          to="/library/digimon"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
