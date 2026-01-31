/**
 * Tamer Form Composable
 * Extracted from duplicated form pages to reduce code duplication
 * Used by: new.vue and edit pages for tamers
 */

import type { CreateTamerData } from './useTamers'
import { getTormentBoxCount, type TormentSeverity } from '../types'
import { skillsByAttribute, skillLabels } from '../constants/tamer-skills'
import { specialOrderThresholds, specialOrdersData } from '../data/special-orders'

export interface TormentEntry {
  id: string
  name: string
  description: string
  severity: TormentSeverity
  totalBoxes: number
  markedBoxes: number
}

export function useTamerForm(initialData?: Partial<CreateTamerData>) {
  // ========================
  // Form State
  // ========================
  const form = reactive<CreateTamerData>({
    name: initialData?.name || '',
    age: initialData?.age || 14,
    campaignLevel: initialData?.campaignLevel || 'standard',
    attributes: {
      agility: initialData?.attributes?.agility || 2,
      body: initialData?.attributes?.body || 2,
      charisma: initialData?.attributes?.charisma || 2,
      intelligence: initialData?.attributes?.intelligence || 2,
      willpower: initialData?.attributes?.willpower || 2,
    },
    skills: {
      dodge: initialData?.skills?.dodge || 0,
      fight: initialData?.skills?.fight || 0,
      stealth: initialData?.skills?.stealth || 0,
      athletics: initialData?.skills?.athletics || 0,
      endurance: initialData?.skills?.endurance || 0,
      featsOfStrength: initialData?.skills?.featsOfStrength || 0,
      manipulate: initialData?.skills?.manipulate || 0,
      perform: initialData?.skills?.perform || 0,
      persuasion: initialData?.skills?.persuasion || 0,
      computer: initialData?.skills?.computer || 0,
      survival: initialData?.skills?.survival || 0,
      knowledge: initialData?.skills?.knowledge || 0,
      perception: initialData?.skills?.perception || 0,
      decipherIntent: initialData?.skills?.decipherIntent || 0,
      bravery: initialData?.skills?.bravery || 0,
    },
    aspects: initialData?.aspects || [],
    torments: initialData?.torments || [],
    xp: initialData?.xp || 0,
    inspiration: initialData?.inspiration ?? 1,
    notes: initialData?.notes || '',
    spriteUrl: initialData?.spriteUrl || '',
  })

  // XP Bonuses - tracked separately from CP-allocated values
  const xpBonuses = reactive({
    attributes: { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 },
    skills: {
      dodge: 0, fight: 0, stealth: 0,
      athletics: 0, endurance: 0, featsOfStrength: 0,
      manipulate: 0, perform: 0, persuasion: 0,
      computer: 0, survival: 0, knowledge: 0,
      perception: 0, decipherIntent: 0, bravery: 0,
    },
    inspiration: 0,
  })

  // Torment management
  const torments = ref<TormentEntry[]>(initialData?.torments?.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    severity: t.severity,
    totalBoxes: t.totalBoxes,
    markedBoxes: t.markedBoxes,
  })) || [])

  const showAddTorment = ref(false)
  const newTormentSeverity = ref<TormentSeverity>('minor')
  const spriteError = ref(false)
  const xpSectionCollapsed = ref(true)

  // ========================
  // Helper Functions
  // ========================
  const getTotalAttribute = (attr: keyof typeof form.attributes): number => {
    return form.attributes[attr] + xpBonuses.attributes[attr]
  }

  const getTotalSkill = (skill: keyof typeof form.skills): number => {
    return form.skills[skill] + xpBonuses.skills[skill]
  }

  // ========================
  // XP Cost Functions
  // ========================
  const getNextAttributeCost = (currentVal: number): number => (currentVal + 1) * 2
  const getNextSkillCost = (currentVal: number): number => currentVal + 1
  const getNextInspirationCost = (currentInspiration: number): number => currentInspiration * 2

  // ========================
  // XP Spending Functions
  // ========================
  const spendXPOnAttribute = (attr: keyof typeof form.attributes) => {
    const currentTotal = getTotalAttribute(attr)
    const cost = (currentTotal + 1) * 2
    if (form.xp >= cost && currentTotal < campaignConfig.value.finalCap) {
      form.xp -= cost
      xpBonuses.attributes[attr]++
    }
  }

  const refundXPFromAttribute = (attr: keyof typeof form.attributes) => {
    if (xpBonuses.attributes[attr] > 0) {
      const currentTotal = getTotalAttribute(attr)
      const refund = currentTotal * 2
      form.xp += refund
      xpBonuses.attributes[attr]--
    }
  }

  const spendXPOnSkill = (skill: keyof typeof form.skills) => {
    const currentTotal = getTotalSkill(skill)
    const cost = currentTotal + 1
    if (form.xp >= cost && currentTotal < campaignConfig.value.finalCap) {
      form.xp -= cost
      xpBonuses.skills[skill]++
    }
  }

  const refundXPFromSkill = (skill: keyof typeof form.skills) => {
    if (xpBonuses.skills[skill] > 0) {
      const currentTotal = getTotalSkill(skill)
      const refund = currentTotal
      form.xp += refund
      xpBonuses.skills[skill]--
    }
  }

  const spendXPOnInspiration = () => {
    const currentTotal = totalInspiration.value
    const cost = currentTotal * 2
    if (form.xp >= cost && currentTotal < maxInspiration.value) {
      form.xp -= cost
      xpBonuses.inspiration++
    }
  }

  const refundXPFromInspiration = () => {
    if (xpBonuses.inspiration > 0) {
      const currentTotal = totalInspiration.value
      const refund = (currentTotal - 1) * 2
      form.xp += refund
      xpBonuses.inspiration--
    }
  }

  // ========================
  // Torment Management
  // ========================
  const tormentMarkingLimits: Record<TormentSeverity, number> = {
    minor: 2,
    major: 3,
    terrible: 4,
  }

  const addTorment = () => {
    const severity = newTormentSeverity.value
    torments.value.push({
      id: crypto.randomUUID(),
      name: '',
      description: '',
      severity,
      totalBoxes: getTormentBoxCount(severity),
      markedBoxes: 0,
    })
    showAddTorment.value = false
  }

  const removeTorment = (id: string) => {
    torments.value = torments.value.filter(t => t.id !== id)
  }

  const updateTormentSeverity = (torment: TormentEntry, severity: TormentSeverity) => {
    torment.severity = severity
    torment.totalBoxes = getTormentBoxCount(severity)
    const maxMarked = tormentMarkingLimits[severity]
    if (torment.markedBoxes > maxMarked) {
      torment.markedBoxes = maxMarked
    }
  }

  const handleSpriteError = () => {
    spriteError.value = true
  }

  // ========================
  // Campaign Configuration
  // ========================
  const campaignConfig = computed(() => {
    switch (form.campaignLevel) {
      case 'enhanced':
        return { startingCP: 40, attrCap: 18, skillCap: 22, startingCap: 5, finalCap: 7 }
      case 'extreme':
        return { startingCP: 50, attrCap: 22, skillCap: 28, startingCap: 7, finalCap: 10 }
      default: // standard
        return { startingCP: 30, attrCap: 12, skillCap: 18, startingCap: 3, finalCap: 5 }
    }
  })

  // ========================
  // CP Calculations
  // ========================
  const attributePoints = computed(() => {
    const total = Object.values(form.attributes).reduce((a, b) => a + b, 0)
    return { used: total, max: campaignConfig.value.attrCap }
  })

  const skillPoints = computed(() => {
    const total = Object.values(form.skills).reduce((a, b) => a + b, 0)
    return { used: total, max: campaignConfig.value.skillCap }
  })

  const tormentCP = computed(() => {
    return torments.value.reduce((sum, t) => sum + t.markedBoxes, 0)
  })

  const totalCP = computed(() => {
    const total = attributePoints.value.used + skillPoints.value.used + tormentCP.value
    return { used: total, max: campaignConfig.value.startingCP }
  })

  // ========================
  // Inspiration
  // ========================
  const totalInspiration = computed(() => (form.inspiration ?? 1) + (xpBonuses.inspiration ?? 0))
  const maxInspiration = computed(() => Math.max(1, getTotalAttribute('willpower')))

  // ========================
  // Validation
  // ========================
  const cappedAttributes = computed(() => {
    const values = Object.values(form.attributes)
    const maxValue = Math.max(...values)
    return values.filter(v => v === maxValue).length
  })

  const cappedSkillGroups = computed(() => {
    const violations: string[] = []
    for (const [attr, skills] of Object.entries(skillsByAttribute)) {
      const values = skills.map(s => form.skills[s as keyof typeof form.skills])
      const maxValue = Math.max(...values)
      const countAtMax = values.filter(v => v === maxValue).length
      if (countAtMax > 1) {
        violations.push(attr)
      }
    }
    return violations
  })

  const zeroSkills = computed(() => {
    return Object.values(form.skills).filter(v => v === 0).length
  })

  const skillsExceedingAttribute = computed(() => {
    const violations: string[] = []
    const skillToAttr: Record<string, keyof typeof form.attributes> = {
      dodge: 'agility', fight: 'agility', stealth: 'agility',
      athletics: 'body', endurance: 'body', featsOfStrength: 'body',
      manipulate: 'charisma', perform: 'charisma', persuasion: 'charisma',
      computer: 'intelligence', survival: 'intelligence', knowledge: 'intelligence',
      perception: 'willpower', decipherIntent: 'willpower', bravery: 'willpower',
    }
    for (const [skill, attr] of Object.entries(skillToAttr)) {
      const skillVal = form.skills[skill as keyof typeof form.skills]
      const attrVal = form.attributes[attr]
      if (skillVal > attrVal) {
        violations.push(`${skillLabels[skill]} (${skillVal}) > ${attr} (${attrVal})`)
      }
    }
    return violations
  })

  const tormentValidation = computed(() => {
    const minorCount = torments.value.filter(t => t.severity === 'minor').length
    const majorCount = torments.value.filter(t => t.severity === 'major').length
    const terribleCount = torments.value.filter(t => t.severity === 'terrible').length

    const isValid = minorCount >= 2 || majorCount >= 1 || terribleCount >= 1

    let message = ''
    if (!isValid) {
      message = 'You need at least 2 Minor Torments OR 1 Major/Terrible Torment'
    }

    const allNamed = torments.value.every(t => t.name.trim() !== '')
    if (!allNamed && torments.value.length > 0) {
      message = 'All torments must have a name'
    }

    return { isValid: isValid && allNamed, message }
  })

  // ========================
  // Derived Stats
  // ========================
  const derivedStats = computed(() => ({
    woundBoxes: Math.max(2, getTotalAttribute('body') + getTotalSkill('endurance')),
    speed: getTotalAttribute('agility') + getTotalSkill('survival'),
    accuracyPool: getTotalAttribute('agility') + getTotalSkill('fight'),
    dodgePool: getTotalAttribute('agility') + getTotalSkill('dodge'),
    armor: getTotalAttribute('body') + getTotalSkill('endurance'),
    damage: getTotalAttribute('body') + getTotalSkill('fight'),
  }))

  // ========================
  // Affordability Checks
  // ========================
  const canAffordAttributeIncrease = (attr: keyof typeof form.attributes): boolean => {
    const currentTotal = getTotalAttribute(attr)
    const nextCost = (currentTotal + 1) * 2
    return form.xp >= nextCost && currentTotal < campaignConfig.value.finalCap
  }

  const canAffordSkillIncrease = (skill: keyof typeof form.skills): boolean => {
    const currentTotal = getTotalSkill(skill)
    const nextCost = currentTotal + 1
    return form.xp >= nextCost && currentTotal < campaignConfig.value.finalCap
  }

  const canAffordInspiration = computed(() => {
    const currentTotal = totalInspiration.value
    const cost = currentTotal * 2
    return form.xp >= cost && currentTotal < maxInspiration.value
  })

  const canAffordTormentBox = (torment: TormentEntry): boolean => {
    // Cost = 1 XP per box in new forms, might be different in edit
    const cost = 1
    return form.xp >= cost && torment.markedBoxes < torment.totalBoxes
  }

  // ========================
  // Special Orders
  // ========================
  const unlockedSpecialOrders = computed(() => {
    const thresholds = specialOrderThresholds[form.campaignLevel]
    const unlocked: { attribute: string; orders: { name: string; type: string; effect: string; tier: number }[] }[] = []

    for (const [attr, orders] of Object.entries(specialOrdersData)) {
      const attrValue = getTotalAttribute(attr as keyof typeof form.attributes)
      const unlockedOrders: { name: string; type: string; effect: string; tier: number }[] = []

      orders.forEach((order, index) => {
        if (attrValue >= thresholds[index]) {
          unlockedOrders.push({ ...order, tier: index + 1 })
        }
      })

      if (unlockedOrders.length > 0) {
        unlocked.push({ attribute: attr, orders: unlockedOrders })
      }
    }

    return unlocked
  })

  // ========================
  // Watchers
  // ========================
  watch(() => form.spriteUrl, () => {
    spriteError.value = false
  })

  return {
    // State
    form,
    xpBonuses,
    torments,
    showAddTorment,
    newTormentSeverity,
    spriteError,
    xpSectionCollapsed,
    skillLabels,
    skillsByAttribute,

    // Helper functions
    getTotalAttribute,
    getTotalSkill,
    handleSpriteError,

    // XP functions
    getNextAttributeCost,
    getNextSkillCost,
    getNextInspirationCost,
    spendXPOnAttribute,
    refundXPFromAttribute,
    spendXPOnSkill,
    refundXPFromSkill,
    spendXPOnInspiration,
    refundXPFromInspiration,

    // Torment functions
    addTorment,
    removeTorment,
    updateTormentSeverity,

    // Computed values
    campaignConfig,
    attributePoints,
    skillPoints,
    tormentCP,
    totalCP,
    totalInspiration,
    maxInspiration,
    cappedAttributes,
    cappedSkillGroups,
    zeroSkills,
    skillsExceedingAttribute,
    tormentValidation,
    derivedStats,
    canAffordAttributeIncrease,
    canAffordSkillIncrease,
    canAffordInspiration,
    canAffordTormentBox,
    unlockedSpecialOrders,
  }
}
