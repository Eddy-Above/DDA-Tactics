<script setup lang="ts">
import type { CreateDigimonData } from '../../../../composables/useDigimon'
import type { Digimon } from '../../../../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize, type DigimonFamily } from '../../../../types'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../../../../data/qualities'

definePageMeta({
  layout: 'player',
  title: 'Create Partner Digimon',
})

const route = useRoute()
const router = useRouter()
const tamerId = computed(() => route.params.tamerId as string)

const { createDigimon, fetchDigimonById, loading, error, getPreviousStages, getNextStages } = useDigimon()

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
  partnerId: tamerId.value, // Auto-set to current tamer
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
const basicInfoExpanded = ref(true)
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

// DP calculations
const dpUsedOnStats = computed(() => {
  return Object.values(form.baseStats).reduce((a, b) => a + b, 0)
})

const dpUsedOnQualities = computed(() => {
  return (form.qualities || []).reduce((total, q) => total + (q.dpCost || 0) * (q.ranks || 1), 0)
})

const baseDP = computed(() => currentStageConfig.value.dp)

const baseDPRemaining = computed(() => {
  return baseDP.value - dpUsedOnStats.value - Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0))
})

const bonusStatsTotal = computed(() => {
  return Object.values(form.bonusStats).reduce((a, b) => a + b, 0)
})

const bonusDPAllocated = computed(() => {
  return bonusStatsTotal.value + (form.bonusDPForQualities || 0)
})

const bonusDPRemaining = computed(() => {
  return (form.bonusDP || 0) - bonusDPAllocated.value
})

const bonusDPForStats = computed(() => {
  return (form.bonusDP || 0) - (form.bonusDPForQualities || 0)
})

const totalDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
})

const availableDPForQualities = computed(() => {
  return Math.max(0, totalDPForQualities.value - dpUsedOnQualities.value)
})

const canAddQualities = computed(() => {
  const hasRoomInQualityBudget = dpUsedOnQualities.value < totalDPForQualities.value
  const bonusDPValid = bonusDPRemaining.value >= 0
  return hasRoomInQualityBudget && bonusDPValid
})

const minBonusDPForQualities = computed(() => {
  const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
  return Math.max(0, dpUsedOnQualities.value - baseDPAvailableForQualities)
})

const maxBonusDPForQualities = computed(() => {
  return Math.max(minBonusDPForQualities.value, (form.bonusDP || 0) - bonusStatsTotal.value)
})

const bonusStatsOverspent = computed(() => bonusStatsTotal.value > bonusDPForStats.value)

const totalDP = computed(() => baseDP.value)
const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
const dpRemaining = computed(() => baseDPRemaining.value)

// Derived Stats calculation
const derivedStats = computed(() => {
  const accuracy = form.baseStats.accuracy + (form.bonusStats?.accuracy || 0)
  const damage = form.baseStats.damage + (form.bonusStats?.damage || 0)
  const dodge = form.baseStats.dodge + (form.bonusStats?.dodge || 0)
  const armor = form.baseStats.armor + (form.bonusStats?.armor || 0)
  const health = form.baseStats.health + (form.bonusStats?.health || 0)
  const stageConfig = currentStageConfig.value
  const sizeConfig = currentSizeConfig.value

  const brains = Math.floor(accuracy / 2) + stageConfig.brainsBonus
  const body = Math.max(0, Math.floor((health + damage + armor) / 3) + sizeConfig.bodyBonus)
  const agility = Math.max(0, Math.floor((accuracy + dodge) / 2) + sizeConfig.agilityBonus)

  const bit = Math.floor(brains / 10) + stageConfig.stageBonus
  const cpu = Math.floor(body / 10) + stageConfig.stageBonus
  const ram = Math.floor(agility / 10) + stageConfig.stageBonus

  const baseMovement = stageConfig.movement
  const speedyQuality = (form.qualities || []).find(q => q.id === 'speedy')
  const speedyRanks = speedyQuality?.ranks || 0
  const speedyBonus = speedyRanks * 2
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

// Attack management
const showCustomAttackForm = ref(false)
const editingAttackIndex = ref(-1)

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

const usedAttackTags = computed(() => {
  const used = new Set<string>()
  for (const attack of form.attacks || []) {
    for (const tag of attack.tags) {
      const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
      used.add(normalized)
    }
  }
  return used
})

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

function isTagAlreadyUsed(qualityId: string): boolean {
  return usedAttackTags.value.has(qualityId)
}

// Attack tags based on owned qualities
const availableAttackTags = computed(() => {
  const tags: Array<{ id: string; name: string; description: string; rangeRestriction?: 'melee' | 'ranged'; disabled: boolean; disabledReason?: string }> = []
  const currentRange = newAttack.range
  const currentTags = newAttack.tags
  const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

  for (const quality of form.qualities || []) {
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

    if (quality.id === 'ammo') {
      const alreadyUsed = isTagAlreadyUsed('ammo')
      const hasSignature = currentTags.some((t) => t.includes('Signature Move'))
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
      if (!choiceId || choiceId === 'blast') {
        const alreadyUsed = isTagAlreadyUsed('area-attack-blast')
        const blocked = alreadyUsed || currentRange !== 'ranged'
        tags.push({
          id: 'area-blast',
          name: 'Area Attack: Blast',
          description: 'Circle at range (3m +BIT diameter)',
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
    form.attacks = form.attacks?.map((attack, i) =>
      i === editingAttackIndex.value ? attackData : attack
    ) || []
  } else {
    form.attacks = [...(form.attacks || []), attackData]
  }

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
  form.qualities = form.qualities.map((q, i) =>
    i === index ? { ...q, ranks } : q
  )
}

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
  const qualityToRemove = form.qualities?.[index]
  if (!qualityToRemove) return

  form.qualities = form.qualities?.filter((_, i) => i !== index) || []

  const tagPattern = getTagPatternForQuality(qualityToRemove.id)
  if (tagPattern) {
    form.attacks = form.attacks?.filter((attack) => {
      const hasTag = attack.tags.some((t) => t.startsWith(tagPattern))
      return !hasTag
    }) || []
  }

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

// Watchers for DP enforcement
watch(() => form.bonusDPForQualities, (newVal) => {
  if (newVal < minBonusDPForQualities.value) {
    form.bonusDPForQualities = minBonusDPForQualities.value
  } else if (newVal > maxBonusDPForQualities.value) {
    form.bonusDPForQualities = maxBonusDPForQualities.value
  }
})

watch(() => bonusStatsTotal.value, () => {
  if (form.bonusDPForQualities > maxBonusDPForQualities.value) {
    form.bonusDPForQualities = maxBonusDPForQualities.value
  }
})

watch(() => minBonusDPForQualities.value, (newMin) => {
  if (form.bonusDPForQualities < newMin) {
    form.bonusDPForQualities = newMin
  }
})

const prevBonusStats = ref({ ...form.bonusStats })
const prevBaseStats = ref({ ...form.baseStats })

watch(() => form.bonusStats, (stats) => {
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  const max = bonusDPForStats.value
  if (total > max) {
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
      if (stats[key] !== prevBonusStats.value[key]) {
        form.bonusStats[key] = prevBonusStats.value[key]
      }
    }
  } else {
    prevBonusStats.value = { ...stats }
  }
}, { deep: true })

watch(() => form.baseStats, (stats) => {
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  const qualitiesFromBaseDP = Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0))
  const maxForStats = baseDP.value - qualitiesFromBaseDP
  if (total > maxForStats) {
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
      if (stats[key] !== prevBaseStats.value[key]) {
        form.baseStats[key] = prevBaseStats.value[key]
      }
    }
  } else {
    prevBaseStats.value = { ...stats }
  }
}, { deep: true })

// Evolution link sync
watch(() => form.evolvesFromId, async (newId) => {
  if (newId) {
    const linkedDigimon = await fetchDigimonById(newId)
    if (linkedDigimon) {
      linkedEvolvesFrom.value = linkedDigimon
      if (form.syncBonusDP && linkedDigimon.bonusDP) {
        form.bonusDP = linkedDigimon.bonusDP
        form.bonusStats = { ...(linkedDigimon as any).bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 } }
        form.bonusDPForQualities = (linkedDigimon as any).bonusDPForQualities || 0
        prevBonusStats.value = { ...form.bonusStats }
      }
    }
  } else {
    linkedEvolvesFrom.value = null
  }
})

watch(() => form.evolutionPathIds, async (newIds) => {
  if (newIds.length > 0) {
    const fetched: Digimon[] = []
    for (const id of newIds) {
      const d = await fetchDigimonById(id)
      if (d) fetched.push(d)
    }
    linkedEvolvesTo.value = fetched

    if (!form.evolvesFromId && fetched.length > 0) {
      const linkedDigimon = fetched[0]
      if (form.syncBonusDP && linkedDigimon.bonusDP) {
        form.bonusDP = linkedDigimon.bonusDP
        form.bonusStats = { ...(linkedDigimon as any).bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 } }
        form.bonusDPForQualities = (linkedDigimon as any).bonusDPForQualities || 0
        prevBonusStats.value = { ...form.bonusStats }
      }
    }
  } else {
    linkedEvolvesTo.value = []
  }
}, { deep: true })

// Stage change handler
const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
  'Vigor': 'P', 'Fury': 'P', 'Cleanse': 'P', 'Haste': 'P', 'Revitalize': 'P', 'Shield': 'P',
  'Poison': 'N', 'Confuse': 'N', 'Stun': 'N', 'Fear': 'N', 'Immobilize': 'N',
  'Lifesteal': 'NA', 'Knockback': 'NA', 'Pull': 'NA', 'Taunt': 'NA',
}

const TAG_RESTRICTIONS: Record<string, { range?: 'melee' | 'ranged'; type?: 'damage' | 'support' }> = {
  'Charge Attack': { range: 'melee' },
  'Mighty Blow': { range: 'melee' },
  'Area Attack: Pass': { range: 'melee' },
  'Area Attack: Blast': { range: 'ranged' },
}

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

watch(() => newAttack.range, (newRange) => {
  newAttack.tags = newAttack.tags.filter((tag) => {
    const restriction = TAG_RESTRICTIONS[tag]
    if (restriction?.range && restriction.range !== newRange) {
      return false
    }
    return true
  })
})

watch(() => form.stage, (newStage) => {
  if (!form.qualities) return

  form.qualities = form.qualities.map(quality => {
    const template = QUALITY_DATABASE.find(t => t.id === quality.id)
    if (!template) return quality

    const maxRanks = getMaxRanksAtStage(template, newStage)
    if ((quality.ranks || 1) > maxRanks) {
      return { ...quality, ranks: maxRanks }
    }
    return quality
  })

  if (form.attacks) {
    form.attacks = form.attacks.map(attack => {
      const updatedTags = attack.tags.map(tag => {
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
    partnerId: tamerId.value, // Always use the tamer ID
    isEnemy: false, // Player-created Digimon are never enemies
    notes: form.notes,
    spriteUrl: form.spriteUrl || undefined,
  }

  if (form.bonusDP > 0) {
    data.bonusStats = form.bonusStats
    data.bonusDPForQualities = form.bonusDPForQualities
  }

  if (form.evolvesFromId) {
    data.evolvesFromId = form.evolvesFromId
  }
  if (form.evolutionPathIds.length > 0) {
    data.evolutionPathIds = form.evolutionPathIds
  }

  if (form.evolvesFromId || form.evolutionPathIds.length > 0) {
    data.syncBonusDP = form.syncBonusDP
  }

  const created = await createDigimon(data)
  if (created) {
    router.push(`/player/${tamerId.value}`)
  }
}

function handleCancel() {
  router.push(`/player/${tamerId.value}`)
}
</script>

<template>
  <div class="min-h-screen bg-digimon-dark-900">
    <!-- Player Header -->
    <header class="bg-digimon-dark-800 border-b border-digimon-dark-700 sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <NuxtLink :to="`/player/${tamerId}`" class="flex items-center gap-2 text-digimon-dark-400 hover:text-white transition-colors">
            <span>&larr;</span>
            <span>Back to Dashboard</span>
          </NuxtLink>
          <span class="font-display text-white font-semibold">Create Partner Digimon</span>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-8 max-w-4xl">
      <form class="space-y-8" @submit.prevent="handleSubmit">
        <!-- Basic Info -->
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

        <!-- Bonus DP Section -->
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

            <div class="border-t border-digimon-dark-600 pt-4">
              <div class="flex justify-between items-center mb-3">
                <h3 :class="['text-sm font-semibold', bonusStatsOverspent ? 'text-red-400' : 'text-digimon-dark-300']">
                  Bonus Stats ({{ bonusStatsTotal }} / {{ bonusDPForStats }} DP)
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
          </div>
        </div>

        <!-- Attacks -->
        <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
          <h2 class="font-display text-xl font-semibold text-white mb-4">
            Attacks ({{ form.attacks?.length || 0 }} / {{ currentStageConfig.attacks }})
          </h2>

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
                </div>
              </div>

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
                      'text-xs px-2 py-1 rounded transition-colors',
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
                      'text-xs px-2 py-1 rounded transition-colors',
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
                  </button>
                </div>
              </div>

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
            <div>
              <DigimonSelector
                v-model="form.evolvesFromId"
                :stage="getPreviousStages(form.stage)"
                :exclude-ids="[]"
                label="Evolves From"
                placeholder="Select pre-evolution..."
              />
            </div>
            <div>
              <DigimonMultiSelector
                v-model="form.evolutionPathIds"
                :stage="getNextStages(form.stage)"
                :exclude-ids="[]"
                label="Evolves To"
                placeholder="Select evolutions..."
              />
            </div>
          </div>

          <div v-if="linkedEvolvesFrom || linkedEvolvesTo.length > 0" class="mt-6 pt-4 border-t border-digimon-dark-600">
            <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain Preview</h3>
            <div class="flex items-center gap-2 flex-wrap">
              <template v-if="linkedEvolvesFrom">
                <div class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2">
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
                </div>
                <span class="text-digimon-dark-500 self-center">→</span>
              </template>

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

              <template v-if="linkedEvolvesTo.length > 0">
                <span class="text-digimon-dark-500 self-center">→</span>
                <template v-if="linkedEvolvesTo.length === 1">
                  <div class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2">
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
                  </div>
                </template>
                <template v-else>
                  <div class="flex flex-col gap-2">
                    <div
                      v-for="evo in linkedEvolvesTo"
                      :key="evo.id"
                      class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2"
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
                    </div>
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
          <button
            type="button"
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                   font-semibold transition-colors"
            @click="handleCancel"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  </div>
</template>
