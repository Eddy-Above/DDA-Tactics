<script setup lang="ts">
import type { CreateDigimonData } from '../../../composables/useDigimon'
import type { Digimon } from '../../../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize, type DigimonFamily } from '../../../types'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../../../data/qualities'
import { EFFECT_ALIGNMENT, TAG_RESTRICTIONS, getTagPatternForQuality } from '../../../data/attackConstants'

definePageMeta({
  title: 'New Digimon',
})

const router = useRouter()
const { createDigimon, fetchDigimonById, loading, error, getPreviousStages, getNextStages } = useDigimon()
const { tamers, fetchTamers } = useTamers()

onMounted(() => {
  fetchTamers()
})

const form = reactive<CreateDigimonData & {
  bonusStats: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  bonusDPForQualities: number
  syncBonusDP: boolean
  evolvesFromId: string | null
  evolutionPathIds: string[]
}>({
  name: '',
  species: '',
  stage: 'rookie',
  attribute: 'data',
  family: 'nature-spirits',
  type: '',
  size: 'medium',
  baseStats: {
    accuracy: 3,
    damage: 3,
    dodge: 3,
    armor: 3,
    health: 3,
  },
  bonusStats: {
    accuracy: 0,
    damage: 0,
    dodge: 0,
    armor: 0,
    health: 0,
  },
  attacks: [],
  qualities: [],
  dataOptimization: '',
  bonusDP: 0,
  bonusDPForQualities: 0,
  syncBonusDP: true,
  partnerId: '',
  isEnemy: false,
  notes: '',
  spriteUrl: '',
  evolvesFromId: null,
  evolutionPathIds: [],
})

// Linked Digimon data for Evolution Chain Preview
const linkedEvolvesFrom = ref<Digimon | null>(null)
const linkedEvolvesTo = ref<Digimon[]>([])

// Collapsible sections
const basicInfoExpanded = ref(true)  // Start expanded for new Digimon
const bonusDPExpanded = ref(false)

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

const currentSizeConfig = computed(() => SIZE_CONFIG[form.size || 'medium'])

const currentStageConfig = computed(() => STAGE_CONFIG[form.stage])

// DP calculation - DDA 1.4 rules:
// Base stats cost 1 DP per point from BASE DP pool
// Qualities cost from BASE DP pool OR bonus quality DP pool
const dpUsedOnStats = computed(() => {
  return Object.values(form.baseStats).reduce((a, b) => a + b, 0)
})

const dpUsedOnQualities = computed(() => {
  return (form.qualities || []).reduce((total, q) => total + (q.dpCost || 0) * (q.ranks || 1), 0)
})

// Base DP pool (from stage only)
const baseDP = computed(() => currentStageConfig.value.dp)

// Base DP remaining (after stats and base-covered qualities)
const baseDPRemaining = computed(() => {
  return baseDP.value - dpUsedOnStats.value - Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0))
})

// Bonus stats total
const bonusStatsTotal = computed(() => {
  return Object.values(form.bonusStats).reduce((a, b) => a + b, 0)
})

// Bonus DP allocated (stats + qualities)
const bonusDPAllocated = computed(() => {
  return bonusStatsTotal.value + (form.bonusDPForQualities || 0)
})

// Bonus DP remaining
const bonusDPRemaining = computed(() => {
  return (form.bonusDP || 0) - bonusDPAllocated.value
})

// Available bonus DP for stats
const bonusDPForStats = computed(() => {
  return (form.bonusDP || 0) - (form.bonusDPForQualities || 0)
})

// Total DP budget for qualities
const totalDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
})

// Available DP for adding new qualities
const availableDPForQualities = computed(() => {
  return Math.max(0, totalDPForQualities.value - dpUsedOnQualities.value)
})

// Can add qualities check
const canAddQualities = computed(() => {
  const hasRoomInQualityBudget = dpUsedOnQualities.value < totalDPForQualities.value
  const bonusDPValid = bonusDPRemaining.value >= 0
  return hasRoomInQualityBudget && bonusDPValid
})

// Minimum bonus DP required for qualities
const minBonusDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return Math.max(0, dpUsedOnQualities.value - baseDPAvailableForQualities)
})

// Maximum bonus DP that can be allocated to qualities
const maxBonusDPForQualities = computed(() => {
  return Math.max(minBonusDPForQualities.value, (form.bonusDP || 0) - bonusStatsTotal.value)
})

// Check if bonus stats are overspent
const bonusStatsOverspent = computed(() => bonusStatsTotal.value > bonusDPForStats.value)

// For display compatibility
const totalDP = computed(() => baseDP.value)
const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
const dpRemaining = computed(() => baseDPRemaining.value)

// Derived Stats calculation - DDA 1.4 rules (page 111)
const derivedStats = computed(() => {
  // Use total stats (base + bonus) for derived calculations
  const accuracy = form.baseStats.accuracy + (form.bonusStats?.accuracy || 0)
  const damage = form.baseStats.damage + (form.bonusStats?.damage || 0)
  const dodge = form.baseStats.dodge + (form.bonusStats?.dodge || 0)
  const armor = form.baseStats.armor + (form.bonusStats?.armor || 0)
  const health = form.baseStats.health + (form.bonusStats?.health || 0)
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
  const speedyQuality = (form.qualities || []).find(q => q.id === 'speedy')
  const speedyRanks = speedyQuality?.ranks || 0
  const speedyBonus = speedyRanks * 2
  // Speedy cannot more than double base movement
  const maxSpeedyBonus = baseMovement
  const movement = baseMovement + Math.min(speedyBonus, maxSpeedyBonus)

  return {
    brains,
    body,
    agility,
    bit,
    cpu,
    ram,
    woundBoxes: health + stageConfig.woundBonus,
    movement,
    baseMovement,
    stageBonus: stageConfig.stageBonus,
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

type Attack = NonNullable<CreateDigimonData['attacks']>[0]

function handleAddAttack(attack: Attack) {
  form.attacks = [...(form.attacks || []), attack]
}

// Tag validation rules based on DDA 1.4
interface AttackTagRule {
  id: string
  name: string
  description: string
  rangeRestriction?: 'melee' | 'ranged'
  typeRestriction?: 'damage' | 'support'
  conflictsWith?: string[]
  allowedWithSignature?: string[]
}

// Get tags already used by existing attacks (Attack qualities can only apply to ONE attack, except Weapon which can apply to Rank attacks)
const usedAttackTags = computed(() => {
  const used = new Set<string>()
  for (const attack of form.attacks || []) {
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
  for (const attack of form.attacks || []) {
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
  const currentTags = newAttack.tags
  const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

  for (const quality of form.qualities || []) {
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

    if (quality.id === 'armor-piercing') {
      const alreadyUsed = isTagAlreadyUsed('armor-piercing')
      const hasCertainStrike = currentTags.some((t) => t.includes('Certain Strike'))
      const blocked = alreadyUsed || (hasCertainStrike && !hasSignatureMove)
      tags.push({
        id: 'armor-piercing',
        name: `Armor Piercing ${quality.ranks || 1}`,
        description: `Ignores ${(quality.ranks || 1) * 2} Armor`,
        conflictsWith: ['certain-strike'],
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Certain Strike (unless Signature Move)' : undefined,
      })
    }

    if (quality.id === 'certain-strike') {
      const alreadyUsed = isTagAlreadyUsed('certain-strike')
      const hasArmorPiercing = currentTags.some((t) => t.includes('Armor Piercing'))
      const blocked = alreadyUsed || (hasArmorPiercing && !hasSignatureMove)
      tags.push({
        id: 'certain-strike',
        name: `Certain Strike ${quality.ranks || 1}`,
        description: 'Auto-successes on accuracy',
        conflictsWith: ['armor-piercing'],
        disabled: blocked,
        disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Armor Piercing (unless Signature Move)' : undefined,
      })
    }

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

    if (quality.id === 'area-attack') {
      const choiceId = quality.choiceId
      // Each Area Attack sub-option can only be used on ONE attack
      // Check for the specific sub-option's normalized tag name
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
      if (!choiceId || choiceId === 'burst') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-burst')
        tags.push({ id: 'area-burst', name: 'Area Attack: Burst', description: 'Circle from user', disabled: alreadyUsed, disabledReason: alreadyUsed ? 'Already used on another attack' : undefined })
      }
      if (!choiceId || choiceId === 'close-blast') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-close-blast')
        tags.push({ id: 'area-close-blast', name: 'Area Attack: Close Blast', description: 'Circle adjacent to user', disabled: alreadyUsed, disabledReason: alreadyUsed ? 'Already used on another attack' : undefined })
      }
      if (!choiceId || choiceId === 'cone') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-cone')
        tags.push({ id: 'area-cone', name: 'Area Attack: Cone', description: 'Triangle from user', disabled: alreadyUsed, disabledReason: alreadyUsed ? 'Already used on another attack' : undefined })
      }
      if (!choiceId || choiceId === 'line') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-line')
        tags.push({ id: 'area-line', name: 'Area Attack: Line', description: 'Pillar from user', disabled: alreadyUsed, disabledReason: alreadyUsed ? 'Already used on another attack' : undefined })
      }
    }
  }

  return tags
})

// Get effects already used by existing attacks
const usedEffects = computed(() => {
  const used = new Set<string>()
  for (let i = 0; i < (form.attacks || []).length; i++) {
    // Skip the attack being edited
    if (i === editingAttackIndex.value) continue
    const attack = form.attacks![i]
    if (attack.effect) {
      used.add(attack.effect.toLowerCase())
    }
  }
  return used
})

// Get available effect tags based on owned qualities AND attack type
const availableEffectTags = computed(() => {
  const currentType = newAttack.type
  const currentTags = newAttack.tags
  const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

  const effectAlignment: Record<string, 'P' | 'N' | 'NA'> = {
    'effect-vigor': 'P', 'effect-fury': 'P', 'effect-cleanse': 'P', 'effect-haste': 'P', 'effect-revitalize': 'P', 'effect-shield': 'P',
    'effect-poison': 'N', 'effect-confuse': 'N', 'effect-stun': 'N', 'effect-fear': 'N', 'effect-immobilize': 'N', 'effect-taunt': 'N',
    'effect-lifesteal': 'NA', 'effect-knockback': 'NA', 'effect-pull': 'NA',
  }
  const signatureRestricted = ['effect-poison', 'effect-hazard', 'effect-revitalize']

  return (form.qualities || [])
    .filter((q) => q.id.startsWith('effect-'))
    .map((q) => {
      const alignment = effectAlignment[q.id] || 'NA'
      const effectName = q.name
      const alreadyUsed = usedEffects.value.has(effectName.toLowerCase())
      let disabled = alreadyUsed
      let disabledReason: string | undefined = alreadyUsed ? 'Already used on another attack' : undefined

      if (!disabled && alignment === 'P' && currentType !== 'support') {
        disabled = true
        disabledReason = 'Requires [Support] attack'
      } else if (!disabled && alignment === 'N' && currentType !== 'damage') {
        disabled = true
        disabledReason = 'Requires [Damage] attack'
      }
      if (!disabled && hasSignatureMove && signatureRestricted.includes(q.id)) {
        disabled = true
        disabledReason = 'Cannot use with Signature Move'
      }

      return { id: q.id.replace('effect-', ''), name: q.name, alignment, disabled, disabledReason }
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
      ? form.attacks![editingAttackIndex.value].id
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
    form.attacks = form.attacks?.map((attack, i) =>
      i === editingAttackIndex.value ? attackData : attack
    ) || []
  } else {
    // Add new attack
    form.attacks = [...(form.attacks || []), attackData]
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
  form.attacks = form.attacks?.filter((_, i) => i !== index) || []
}

function editAttack(index: number) {
  const attack = form.attacks?.[index]
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

type Quality = NonNullable<CreateDigimonData['qualities']>[0]

function handleAddQuality(quality: Quality) {
  // Check if adding this quality would exceed the budget
  const qualityCost = (quality.dpCost || 0) * (quality.ranks || 1)
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  const totalDPForQualitiesVal = baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
  const newTotalUsed = dpUsedOnQualities.value + qualityCost

  if (newTotalUsed > totalDPForQualitiesVal) {
    // Would exceed budget - don't add
    return
  }

  form.qualities = [...(form.qualities || []), quality]
}

function handleUpdateQualityRanks(index: number, ranks: number) {
  if (!form.qualities || !form.qualities[index]) return
  // Create a new array with the updated quality
  form.qualities = form.qualities.map((q, i) =>
    i === index ? { ...q, ranks } : q
  )
}

// Map quality ID to tag pattern for attack filtering
function removeQuality(index: number) {
  const qualityToRemove = form.qualities?.[index]
  if (!qualityToRemove) return

  // Remove the quality
  form.qualities = form.qualities?.filter((_, i) => i !== index) || []

  // Remove attacks that use tags from this quality
  const tagPattern = getTagPatternForQuality(qualityToRemove.id)
  if (tagPattern) {
    form.attacks = form.attacks?.filter((attack) => {
      // Check if any tag starts with the pattern
      const hasTag = attack.tags.some((t) => t.startsWith(tagPattern))
      return !hasTag
    }) || []
  }

  // If it's an effect quality, remove attacks that use this effect
  if (qualityToRemove.id.startsWith('effect-')) {
    const effectName = qualityToRemove.name
    form.attacks = form.attacks?.filter((attack) => {
      return attack.effect !== effectName
    }) || []
  }
}

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

// Sync partnerId and bonus DP from linked evolution when link is added
watch(() => form.evolvesFromId, async (newId) => {
  if (newId) {
    const linkedDigimon = await fetchDigimonById(newId)
    if (linkedDigimon) {
      // Store for preview
      linkedEvolvesFrom.value = linkedDigimon
      // Always sync partnerId from linked Digimon
      if (linkedDigimon.partnerId && !form.partnerId) {
        form.partnerId = linkedDigimon.partnerId
      }
      // Sync bonus DP if enabled
      if (form.syncBonusDP && linkedDigimon.bonusDP) {
        form.bonusDP = linkedDigimon.bonusDP
        form.bonusStats = { ...(linkedDigimon as any).bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 } }
        form.bonusDPForQualities = (linkedDigimon as any).bonusDPForQualities || 0
        // Update prev values to prevent reversion
        prevBonusStats.value = { ...form.bonusStats }
      }
    }
  } else {
    linkedEvolvesFrom.value = null
  }
})

// Also sync from evolutionPathIds if no evolvesFromId
watch(() => form.evolutionPathIds, async (newIds) => {
  // Fetch all linked evolutions for preview
  if (newIds.length > 0) {
    const fetched: Digimon[] = []
    for (const id of newIds) {
      const d = await fetchDigimonById(id)
      if (d) fetched.push(d)
    }
    linkedEvolvesTo.value = fetched

    // Sync partnerId from first linked if no evolvesFrom
    if (!form.evolvesFromId && fetched.length > 0) {
      const linkedDigimon = fetched[0]
      if (linkedDigimon.partnerId && !form.partnerId) {
        form.partnerId = linkedDigimon.partnerId
      }
      // Sync bonus DP if enabled
      if (form.syncBonusDP && linkedDigimon.bonusDP) {
        form.bonusDP = linkedDigimon.bonusDP
        form.bonusStats = { ...(linkedDigimon as any).bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 } }
        form.bonusDPForQualities = (linkedDigimon as any).bonusDPForQualities || 0
        // Update prev values to prevent reversion
        prevBonusStats.value = { ...form.bonusStats }
      }
    }
  } else {
    linkedEvolvesTo.value = []
  }
}, { deep: true })

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
          const quality = form.qualities?.find(q => q.id === qualityId)
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
  const data: CreateDigimonData & {
    bonusStats?: typeof form.bonusStats
    bonusDPForQualities?: number
    syncBonusDP?: boolean
    evolvesFromId?: string | null
    evolutionPathIds?: string[]
  } = {
    name: form.name,
    species: form.species,
    stage: form.stage,
    attribute: form.attribute,
    family: form.family,
    type: form.type || undefined,
    size: form.size,
    baseStats: form.baseStats,
    attacks: form.attacks,
    qualities: form.qualities,
    dataOptimization: form.dataOptimization || undefined,
    bonusDP: form.bonusDP || 0,
    partnerId: form.partnerId || undefined,
    isEnemy: form.isEnemy,
    notes: form.notes,
    spriteUrl: form.spriteUrl || undefined,
  }

  // Include bonus stats and allocation if bonus DP is set
  if (form.bonusDP > 0) {
    data.bonusStats = form.bonusStats
    data.bonusDPForQualities = form.bonusDPForQualities
  }

  // Include evolution links if set
  if (form.evolvesFromId) {
    data.evolvesFromId = form.evolvesFromId
  }
  if (form.evolutionPathIds.length > 0) {
    data.evolutionPathIds = form.evolutionPathIds
  }

  // Include sync preference if evolution links exist
  if (form.evolvesFromId || form.evolutionPathIds.length > 0) {
    data.syncBonusDP = form.syncBonusDP
  }

  const created = await createDigimon(data)
  if (created) {
    router.push('/library/digimon')
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/digimon" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Digimon
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">New Digimon</h1>
    </div>

    <form class="space-y-8" @submit.prevent="handleSubmit">
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
              placeholder="e.g., Agumon"
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
              placeholder="e.g., Reptile Digimon"
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
                <template v-if="SIZE_CONFIG[size].bodyBonus !== 0 || SIZE_CONFIG[size].agilityBonus !== 0">
                  (Body {{ SIZE_CONFIG[size].bodyBonus >= 0 ? '+' : '' }}{{ SIZE_CONFIG[size].bodyBonus }},
                  Agility {{ SIZE_CONFIG[size].agilityBonus >= 0 ? '+' : '' }}{{ SIZE_CONFIG[size].agilityBonus }})
                </template>
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
              placeholder="e.g., Reptile"
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
            <span class="text-digimon-dark-400">Movement:</span>
            <span class="text-white ml-1">{{ currentStageConfig.movement }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Wound Bonus:</span>
            <span class="text-white ml-1">+{{ currentStageConfig.woundBonus }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Brains Bonus:</span>
            <span class="text-white ml-1">+{{ currentStageConfig.brainsBonus }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Attacks:</span>
            <span class="text-white ml-1">{{ currentStageConfig.attacks }}</span>
          </div>
        </div>
      </div>

      <!-- Base Stats -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Base Stats</h2>
          <div class="flex flex-col items-end gap-1">
            <span
              :class="[
                'text-sm px-3 py-1 rounded',
                dpRemaining === 0 && 'bg-green-900/30 text-green-400',
                dpRemaining > 0 && 'bg-yellow-900/30 text-yellow-400',
                dpRemaining < 0 && 'bg-red-900/30 text-red-400',
              ]"
            >
              {{ dpRemaining }} DP remaining
            </span>
            <span class="text-xs text-digimon-dark-400">
              Stats: {{ dpUsedOnStats }} | Qualities: {{ dpUsedOnQualities }} | Total: {{ dpUsed }} / {{ totalDP }}
            </span>
          </div>
        </div>
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

      <!-- Bonus DP Section (Collapsible) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <button
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="bonusDPExpanded = !bonusDPExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', bonusDPExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Bonus DP</h2>
          </div>
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
        </button>

        <div v-show="bonusDPExpanded" class="px-6 pb-6">
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
      </div>

      <!-- Attacks -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">
          Attacks ({{ form.attacks?.length || 0 }} / {{ currentStageConfig.attacks }})
        </h2>

        <!-- Custom attack toggle -->
        <div v-if="(form.attacks?.length || 0) < currentStageConfig.attacks" class="mb-4">
          <button
            v-if="!showCustomAttackForm"
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
                      : newAttack.effect?.toLowerCase() === effect.name.toLowerCase()
                        ? 'bg-purple-500 text-white'
                        : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                  :title="effect.disabled ? effect.disabledReason : `${effect.alignment === 'P' ? '[Support only]' : effect.alignment === 'N' ? '[Damage only]' : '[Any type]'}`"
                  @click="!effect.disabled && (newAttack.effect = newAttack.effect?.toLowerCase() === effect.name.toLowerCase() ? '' : effect.name)"
                >
                  {{ effect.name }}
                  <span class="ml-1 text-digimon-dark-500">[{{ effect.alignment === 'P' ? 'S' : effect.alignment === 'N' ? 'D' : '±' }}]</span>
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
          :current-attacks="form.attacks || []"
          :current-qualities="form.qualities || []"
          :base-stats="form.baseStats"
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
          :current-qualities="form.qualities || []"
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
              :exclude-ids="[]"
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
              :exclude-ids="[]"
              label="Evolves To"
              placeholder="Select evolutions..."
            />
            <p v-if="getNextStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No later stages available (already at Ultra)
            </p>
          </div>
        </div>

        <!-- Evolution Chain Preview -->
        <div v-if="linkedEvolvesFrom || linkedEvolvesTo.length > 0" class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain Preview</h3>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Evolves From -->
            <template v-if="linkedEvolvesFrom">
              <NuxtLink
                :to="`/library/digimon/${linkedEvolvesFrom.id}`"
                class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
              >
                <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    v-if="linkedEvolvesFrom.spriteUrl"
                    :src="linkedEvolvesFrom.spriteUrl"
                    :alt="linkedEvolvesFrom.name"
                    class="max-w-full max-h-full object-contain"
                  />
                  <span v-else class="text-sm">🦖</span>
                </div>
                <div>
                  <div class="text-white text-sm font-medium">{{ linkedEvolvesFrom.name }}</div>
                  <div class="text-xs text-digimon-dark-400 capitalize">{{ linkedEvolvesFrom.stage }}</div>
                </div>
              </NuxtLink>
              <span class="text-digimon-dark-500 self-center">→</span>
            </template>

            <!-- Current (New Digimon being created) -->
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
                <div class="text-digimon-orange-400 text-sm font-medium">{{ form.name || 'New Digimon' }}</div>
                <div class="text-xs text-digimon-dark-400 capitalize">{{ form.stage }}</div>
              </div>
            </div>

            <!-- Evolves To (tree structure) -->
            <template v-if="linkedEvolvesTo.length > 0">
              <span class="text-digimon-dark-500 self-center">→</span>
              <!-- Single evolution - show inline -->
              <template v-if="linkedEvolvesTo.length === 1">
                <NuxtLink
                  :to="`/library/digimon/${linkedEvolvesTo[0].id}`"
                  class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                >
                  <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                    <img
                      v-if="linkedEvolvesTo[0].spriteUrl"
                      :src="linkedEvolvesTo[0].spriteUrl"
                      :alt="linkedEvolvesTo[0].name"
                      class="max-w-full max-h-full object-contain"
                    />
                    <span v-else class="text-sm">🦖</span>
                  </div>
                  <div>
                    <div class="text-white text-sm font-medium">{{ linkedEvolvesTo[0].name }}</div>
                    <div class="text-xs text-digimon-dark-400 capitalize">{{ linkedEvolvesTo[0].stage }}</div>
                  </div>
                </NuxtLink>
              </template>
              <!-- Multiple evolutions - show as vertical branch -->
              <template v-else>
                <div class="flex flex-col gap-2">
                  <NuxtLink
                    v-for="evo in linkedEvolvesTo"
                    :key="evo.id"
                    :to="`/library/digimon/${evo.id}`"
                    class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                  >
                    <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                      <img
                        v-if="evo.spriteUrl"
                        :src="evo.spriteUrl"
                        :alt="evo.name"
                        class="max-w-full max-h-full object-contain"
                      />
                      <span v-else class="text-sm">🦖</span>
                    </div>
                    <div>
                      <div class="text-white text-sm font-medium">{{ evo.name }}</div>
                      <div class="text-xs text-digimon-dark-400 capitalize">{{ evo.stage }}</div>
                    </div>
                  </NuxtLink>
                </div>
              </template>
            </template>
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
          {{ loading ? 'Creating...' : 'Create Digimon' }}
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
