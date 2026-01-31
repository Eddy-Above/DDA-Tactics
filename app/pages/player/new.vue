<script setup lang="ts">
import type { CreateTamerData } from '../../composables/useTamers'
import { getTormentBoxCount, type TormentSeverity } from '../../types'
import { skillsByAttribute, skillLabels } from '../../constants/tamer-skills'
import { specialOrderThresholds, specialOrdersData } from '../../data/special-orders'

definePageMeta({
  layout: 'player',
  title: 'Create Your Character',
})

const router = useRouter()
const { createTamer, loading, error } = useTamers()
const selectedTamerId = useCookie<string | null>('player-tamer-id', { default: () => null })

const majorAspect = reactive({ name: '', description: '' })
const minorAspect = reactive({ name: '', description: '' })

// Torment management
interface TormentEntry {
  id: string
  name: string
  description: string
  severity: TormentSeverity
  totalBoxes: number
  markedBoxes: number
}

const torments = ref<TormentEntry[]>([])
const showAddTorment = ref(false)
const newTormentSeverity = ref<TormentSeverity>('minor')

// XP & Inspiration management (collapsed by default in new)
const xpSectionCollapsed = ref(true)

// XP Spending System - Direct spend/refund (not session-based)

// XP Cost Functions
function getNextAttributeCost(currentVal: number): number {
  return (currentVal + 1) * 2  // new rating × 2
}

function getNextSkillCost(currentVal: number): number {
  return currentVal + 1  // new rating
}

function getNextInspirationCost(currentInspiration: number): number {
  return currentInspiration * 2  // 2 × current inspiration
}

// Spend/Refund functions for attributes (modifies xpBonuses, not form)
function spendXPOnAttribute(attr: keyof typeof form.attributes) {
  const currentTotal = getTotalAttribute(attr)
  const cost = (currentTotal + 1) * 2
  if (form.xp >= cost && currentTotal < campaignConfig.value.finalCap) {
    form.xp -= cost
    xpBonuses.attributes[attr]++
  }
}

function refundXPFromAttribute(attr: keyof typeof form.attributes) {
  if (xpBonuses.attributes[attr] > 0) {
    const currentTotal = getTotalAttribute(attr)
    const refund = currentTotal * 2  // refund is current total rating × 2
    form.xp += refund
    xpBonuses.attributes[attr]--
  }
}

// Spend/Refund functions for skills (modifies xpBonuses, not form)
function spendXPOnSkill(skill: keyof typeof form.skills) {
  const currentTotal = getTotalSkill(skill)
  const cost = currentTotal + 1
  if (form.xp >= cost && currentTotal < campaignConfig.value.finalCap) {
    form.xp -= cost
    xpBonuses.skills[skill]++
  }
}

function refundXPFromSkill(skill: keyof typeof form.skills) {
  if (xpBonuses.skills[skill] > 0) {
    const currentTotal = getTotalSkill(skill)
    const refund = currentTotal  // refund is current total rating
    form.xp += refund
    xpBonuses.skills[skill]--
  }
}

// Spend/Refund functions for inspiration (modifies xpBonuses, not form)
function spendXPOnInspiration() {
  const currentTotal = totalInspiration.value
  const cost = currentTotal * 2
  if (form.xp >= cost && currentTotal < maxInspiration.value) {
    form.xp -= cost
    xpBonuses.inspiration++
  }
}

function refundXPFromInspiration() {
  if (xpBonuses.inspiration > 0) {
    const currentTotal = totalInspiration.value
    const refund = (currentTotal - 1) * 2  // refund cost of buying current point
    form.xp += refund
    xpBonuses.inspiration--
  }
}

// Sprite preview
const spriteError = ref(false)

function handleSpriteError() {
  spriteError.value = true
}

// Creation limits for marking torment boxes
const tormentMarkingLimits: Record<TormentSeverity, number> = {
  minor: 2,
  major: 3,
  terrible: 4,
}

function addTorment() {
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

function removeTorment(id: string) {
  torments.value = torments.value.filter(t => t.id !== id)
}

function updateTormentSeverity(torment: TormentEntry, severity: TormentSeverity) {
  torment.severity = severity
  torment.totalBoxes = getTormentBoxCount(severity)
  // Reset marked boxes if they exceed the new limit
  const maxMarked = tormentMarkingLimits[severity]
  if (torment.markedBoxes > maxMarked) {
    torment.markedBoxes = maxMarked
  }
}

// Validation for torments (2 Minor OR 1 Major minimum)
const tormentValidation = computed(() => {
  const minorCount = torments.value.filter(t => t.severity === 'minor').length
  const majorCount = torments.value.filter(t => t.severity === 'major').length
  const terribleCount = torments.value.filter(t => t.severity === 'terrible').length

  // Valid if: 2+ minor, OR 1+ major/terrible
  const isValid = minorCount >= 2 || majorCount >= 1 || terribleCount >= 1

  let message = ''
  if (!isValid) {
    message = 'You need at least 2 Minor Torments OR 1 Major/Terrible Torment'
  }

  // Check if all torments have names
  const allNamed = torments.value.every(t => t.name.trim() !== '')
  if (!allNamed && torments.value.length > 0) {
    message = 'All torments must have a name'
  }

  return { isValid: isValid && allNamed, message }
})

const form = reactive<CreateTamerData>({
  name: '',
  age: 14,
  campaignLevel: 'standard',
  attributes: {
    agility: 2,
    body: 2,
    charisma: 2,
    intelligence: 2,
    willpower: 2,
  },
  skills: {
    dodge: 0,
    fight: 0,
    stealth: 0,
    athletics: 0,
    endurance: 0,
    featsOfStrength: 0,
    manipulate: 0,
    perform: 0,
    persuasion: 0,
    computer: 0,
    survival: 0,
    knowledge: 0,
    perception: 0,
    decipherIntent: 0,
    bravery: 0,
  },
  aspects: [],
  torments: [],
  xp: 0,
  inspiration: 1, // Every character starts with 1 free Inspiration
  notes: '',
  spriteUrl: '',
})

// XP Bonuses - tracked separately from CP-allocated values
// This ensures XP spending doesn't affect CP calculations
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

// Get total attribute value (CP + XP bonuses)
function getTotalAttribute(attr: keyof typeof form.attributes): number {
  return form.attributes[attr] + xpBonuses.attributes[attr]
}

// Get total skill value (CP + XP bonuses)
function getTotalSkill(skill: keyof typeof form.skills): number {
  return form.skills[skill] + xpBonuses.skills[skill]
}

// Get total inspiration (CP + XP bonuses)
const totalInspiration = computed(() => (form.inspiration ?? 1) + (xpBonuses.inspiration ?? 0))

// Campaign level configuration based on official rules
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

// Validation: only 1 attribute can be at the highest value
const cappedAttributes = computed(() => {
  const values = Object.values(form.attributes)
  const maxValue = Math.max(...values)
  return values.filter(v => v === maxValue).length
})

// Validation: only 1 skill can be at the highest value per skill group
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

// Warning: skills at 0 have -1 modifier
const zeroSkills = computed(() => {
  return Object.values(form.skills).filter(v => v === 0).length
})

// Validation: skills cannot exceed their linked attribute
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


// Derived stats calculated from total attributes and skills (CP + XP)
const derivedStats = computed(() => ({
  woundBoxes: Math.max(2, getTotalAttribute('body') + getTotalSkill('endurance')),
  speed: getTotalAttribute('agility') + getTotalSkill('survival'),
  accuracyPool: getTotalAttribute('agility') + getTotalSkill('fight'),
  dodgePool: getTotalAttribute('agility') + getTotalSkill('dodge'),
  armor: getTotalAttribute('body') + getTotalSkill('endurance'),
  damage: getTotalAttribute('body') + getTotalSkill('fight'),
}))

// Max inspiration = Willpower (min 1) - uses total attribute
const maxInspiration = computed(() => Math.max(1, getTotalAttribute('willpower')))

// Affordability checks (uses total values)
function canAffordAttributeIncrease(attr: keyof typeof form.attributes): boolean {
  const currentTotal = getTotalAttribute(attr)
  const nextCost = (currentTotal + 1) * 2
  return form.xp >= nextCost && currentTotal < campaignConfig.value.finalCap
}

function canAffordSkillIncrease(skill: keyof typeof form.skills): boolean {
  const currentTotal = getTotalSkill(skill)
  const nextCost = currentTotal + 1
  return form.xp >= nextCost && currentTotal < campaignConfig.value.finalCap
}

const canAffordInspiration = computed(() => {
  const currentTotal = totalInspiration.value
  const cost = currentTotal * 2
  return form.xp >= cost && currentTotal < maxInspiration.value
})

// Reset sprite error when URL changes
watch(() => form.spriteUrl, () => {
  spriteError.value = false
})


// Compute unlocked Special Orders based on total attributes (CP + XP)
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

async function handleSubmit() {
  // Build aspects array
  const aspects: Array<{ id: string; name: string; description: string; type: 'major' | 'minor'; usesRemaining: number }> = []
  if (majorAspect.name) {
    aspects.push({
      id: crypto.randomUUID(),
      name: majorAspect.name,
      description: majorAspect.description,
      type: 'major',
      usesRemaining: 1,
    })
  }
  if (minorAspect.name) {
    aspects.push({
      id: crypto.randomUUID(),
      name: minorAspect.name,
      description: minorAspect.description,
      type: 'minor',
      usesRemaining: 2,
    })
  }

  // Build torments array
  const tormentData = torments.value.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    severity: t.severity,
    totalBoxes: t.totalBoxes,
    markedBoxes: t.markedBoxes,
    cpMarkedBoxes: t.markedBoxes, // Lock boxes marked at creation with CP
  }))

  // Save base values and xpBonuses separately - do NOT combine them
  // This allows users to reallocate XP at any time
  const created = await createTamer({
    ...form,
    aspects,
    torments: tormentData,
    xpBonuses: {
      attributes: { ...xpBonuses.attributes },
      skills: { ...xpBonuses.skills },
      inspiration: xpBonuses.inspiration,
    },
  })
  if (created) {
    selectedTamerId.value = created.id
    router.push(`/player/${created.id}`)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/player" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Create Your Character</h1>
    </div>

    <form class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Basic Information</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <label class="block text-sm text-digimon-dark-400 mb-1">Age</label>
            <input
              v-model.number="form.age"
              type="number"
              min="6"
              max="100"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Campaign Level</label>
            <select
              v-model="form.campaignLevel"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced</option>
              <option value="extreme">Extreme</option>
            </select>
          </div>
        </div>
        <div class="flex justify-between items-center mt-4 pt-4 border-t border-digimon-dark-700">
          <span class="text-sm text-digimon-dark-400">Creation Points</span>
          <span
            :class="[
              'text-sm px-3 py-1 rounded font-semibold',
              totalCP.used === totalCP.max && 'bg-green-900/30 text-green-400',
              totalCP.used < totalCP.max && 'bg-yellow-900/30 text-yellow-400',
              totalCP.used > totalCP.max && 'bg-red-900/30 text-red-400',
            ]"
          >
            {{ totalCP.used }} / {{ totalCP.max }} CP
          </span>
        </div>
      </div>

      <!-- Attributes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Attributes</h2>
          <span
            :class="[
              'text-sm px-3 py-1 rounded',
              attributePoints.used === attributePoints.max && 'bg-green-900/30 text-green-400',
              attributePoints.used < attributePoints.max && 'bg-yellow-900/30 text-yellow-400',
              attributePoints.used > attributePoints.max && 'bg-red-900/30 text-red-400',
            ]"
          >
            {{ attributePoints.used }} / {{ attributePoints.max }} area cap
          </span>
        </div>
        <div class="grid grid-cols-5 gap-4">
          <div v-for="attr in (['agility', 'body', 'charisma', 'intelligence', 'willpower'] as const)" :key="attr" class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2 capitalize">{{ attr }}</label>
            <input
              v-model.number="form.attributes[attr]"
              type="number"
              min="1"
              :max="campaignConfig.startingCap"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>
        <p class="text-xs text-digimon-dark-500 mt-2">Max per attribute: {{ campaignConfig.startingCap }} (only 1 can be at max)</p>
        <p v-if="cappedAttributes > 1" class="text-xs text-red-400 mt-1">
          Only 1 attribute can be at the highest value. You have {{ cappedAttributes }} tied for highest.
        </p>
      </div>

      <!-- Skills -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Skills</h2>
          <span
            :class="[
              'text-sm px-3 py-1 rounded',
              skillPoints.used === skillPoints.max && 'bg-green-900/30 text-green-400',
              skillPoints.used < skillPoints.max && 'bg-yellow-900/30 text-yellow-400',
              skillPoints.used > skillPoints.max && 'bg-red-900/30 text-red-400',
            ]"
          >
            {{ skillPoints.used }} / {{ skillPoints.max }} area cap
          </span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div v-for="(skills, attr) in skillsByAttribute" :key="attr">
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3 capitalize">{{ attr }}</h3>
            <div class="space-y-2">
              <div v-for="skill in skills" :key="skill" class="flex items-center gap-2">
                <label class="flex-1 text-sm text-digimon-dark-300">{{ skillLabels[skill] }}</label>
                <input
                  v-model.number="form.skills[skill as keyof typeof form.skills]"
                  type="number"
                  min="0"
                  :max="campaignConfig.startingCap"
                  class="w-14 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                         text-white text-center text-sm focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
        <p class="text-xs text-digimon-dark-500 mt-2">Max per skill: {{ campaignConfig.startingCap }} (only 1 can be at max)</p>
        <p v-if="cappedSkillGroups.length > 0" class="text-xs text-red-400 mt-1">
          Only 1 skill per group can be at the highest value. Violations in: {{ cappedSkillGroups.join(', ') }}
        </p>
        <p v-if="zeroSkills > 0" class="text-xs text-yellow-400 mt-1">
          {{ zeroSkills }} skill(s) at 0 will have -1 modifier on checks.
        </p>
        <p v-if="skillsExceedingAttribute.length > 0" class="text-xs text-red-400 mt-1">
          Skills cannot exceed their linked attribute: {{ skillsExceedingAttribute.join(', ') }}
        </p>
      </div>

      <!-- Aspects -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Aspects</h2>
        <p class="text-xs text-digimon-dark-500 mb-4">Personality traits that can help or hinder you. Major (+/-4, 1/day), Minor (+/-2, 2/day).</p>

        <div class="space-y-6">
          <!-- Major Aspect -->
          <div>
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3">Major Aspect (+/-4)</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
                <input
                  v-model="majorAspect.name"
                  type="text"
                  placeholder="e.g., Track Star, Thuggish Looks"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Description</label>
                <textarea
                  v-model="majorAspect.description"
                  rows="2"
                  placeholder="Describe when this aspect helps (+4) and hinders (-4)..."
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
                />
              </div>
            </div>
          </div>

          <!-- Minor Aspect -->
          <div>
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3">Minor Aspect (+/-2)</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
                <input
                  v-model="minorAspect.name"
                  type="text"
                  placeholder="e.g., Smarter Than They Act, Single-Minded Focus"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Description</label>
                <textarea
                  v-model="minorAspect.description"
                  rows="2"
                  placeholder="Describe when this aspect helps (+2) and hinders (-2)..."
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Torments -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Torments</h2>
          <button
            type="button"
            class="text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-3 py-1.5 rounded-lg transition-colors"
            @click="showAddTorment = !showAddTorment"
          >
            + Add Torment
          </button>
        </div>
        <p class="text-xs text-digimon-dark-500 mb-4">
          Character flaws or traumas to overcome. Require 2 Minor OR 1 Major/Terrible.
          Roll: 3d6 + Willpower - unmarked boxes vs TN 12.
        </p>

        <!-- Add torment dialog -->
        <div v-if="showAddTorment" class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
          <div class="flex items-center gap-4 flex-wrap">
            <label class="text-sm text-digimon-dark-400">Severity:</label>
            <select
              v-model="newTormentSeverity"
              class="bg-digimon-dark-600 border border-digimon-dark-500 rounded px-3 py-1.5 text-white text-sm"
            >
              <option value="minor">Minor (5 boxes)</option>
              <option value="major">Major (7 boxes)</option>
              <option value="terrible">Terrible (10 boxes)</option>
            </select>
            <button
              type="button"
              class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-1.5 rounded text-sm font-semibold"
              @click="addTorment"
            >
              Add
            </button>
            <button
              type="button"
              class="text-digimon-dark-400 hover:text-white text-sm"
              @click="showAddTorment = false"
            >
              Cancel
            </button>
          </div>
        </div>

        <!-- Torment list -->
        <div v-if="torments.length === 0" class="text-center py-6 text-digimon-dark-400">
          No torments added yet. Add at least 2 Minor OR 1 Major/Terrible Torment.
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="torment in torments"
            :key="torment.id"
            class="bg-digimon-dark-700 rounded-lg p-4"
          >
            <div class="flex items-start justify-between gap-4 mb-3">
              <div class="flex-1 space-y-2">
                <div class="flex items-center gap-3 flex-wrap">
                  <input
                    v-model="torment.name"
                    type="text"
                    placeholder="Torment name..."
                    class="flex-1 min-w-48 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-3 py-1.5
                           text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
                  />
                  <select
                    :value="torment.severity"
                    class="bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1.5 text-white text-sm"
                    @change="updateTormentSeverity(torment, ($event.target as HTMLSelectElement).value as TormentSeverity)"
                  >
                    <option value="minor">Minor</option>
                    <option value="major">Major</option>
                    <option value="terrible">Terrible</option>
                  </select>
                </div>
                <textarea
                  v-model="torment.description"
                  rows="2"
                  placeholder="Describe the torment..."
                  class="w-full bg-digimon-dark-600 border border-digimon-dark-500 rounded px-3 py-1.5
                         text-white text-sm focus:border-digimon-orange-500 focus:outline-none resize-none"
                />
              </div>
              <button
                type="button"
                class="text-red-400 hover:text-red-300 text-sm"
                @click="removeTorment(torment.id)"
              >
                Remove
              </button>
            </div>

            <!-- Torment boxes visualization -->
            <div class="flex items-center gap-3 flex-wrap">
              <span class="text-xs text-digimon-dark-400 w-20">Progress:</span>
              <div class="flex gap-1 flex-wrap">
                <button
                  v-for="i in torment.totalBoxes"
                  :key="i"
                  type="button"
                  :class="[
                    'w-5 h-5 rounded border-2 transition-colors',
                    i <= torment.markedBoxes
                      ? 'bg-green-500 border-green-400'
                      : 'bg-digimon-dark-600 border-digimon-dark-500 hover:border-digimon-dark-400',
                    i > tormentMarkingLimits[torment.severity] && i > torment.markedBoxes
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                  ]"
                  :disabled="i > tormentMarkingLimits[torment.severity] && i > torment.markedBoxes"
                  :title="i > tormentMarkingLimits[torment.severity] ? 'Cannot mark more than ' + tormentMarkingLimits[torment.severity] + ' boxes at creation' : ''"
                  @click="torment.markedBoxes = torment.markedBoxes >= i ? i - 1 : Math.min(i, tormentMarkingLimits[torment.severity])"
                />
              </div>
              <span class="text-xs text-digimon-dark-400">
                {{ torment.markedBoxes }}/{{ torment.totalBoxes }}
                <span v-if="torment.markedBoxes < torment.totalBoxes" class="text-yellow-400 ml-1">
                  (Roll modifier: -{{ torment.totalBoxes - torment.markedBoxes }})
                </span>
                <span v-else class="text-green-400 ml-1">(Overcome!)</span>
              </span>
            </div>
            <p class="text-xs text-digimon-dark-500 mt-2">
              Max {{ tormentMarkingLimits[torment.severity] }} boxes can be marked at creation (1 CP each)
            </p>
          </div>
        </div>

        <!-- Validation message -->
        <div
          v-if="torments.length > 0 && !tormentValidation.isValid"
          class="mt-4 text-xs text-red-400"
        >
          {{ tormentValidation.message }}
        </div>
      </div>

      <!-- XP & Inspiration -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !xpSectionCollapsed }"
          @click="xpSectionCollapsed = !xpSectionCollapsed"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': xpSectionCollapsed }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 class="font-display text-xl font-semibold text-white">Experience & Inspiration</h2>
          </div>
          <span class="text-sm text-digimon-dark-400">{{ form.xp }} XP · {{ totalInspiration }}/{{ maxInspiration }} Insp</span>
        </div>

        <div v-show="!xpSectionCollapsed">
          <p class="text-xs text-digimon-dark-500 mb-4">
            XP can be spent to improve beyond your starting CP allocation. Inspiration starts at 1 for free.
          </p>

          <!-- XP Display -->
          <div class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
            <div class="text-2xl font-bold text-white">{{ form.xp }}</div>
            <div class="text-sm text-digimon-dark-400">Available XP</div>
          </div>

          <!-- Set XP -->
          <div class="flex items-center gap-4 mb-4">
            <label class="text-sm text-digimon-dark-400">Starting XP:</label>
            <input
              v-model.number="form.xp"
              type="number"
              min="0"
              class="w-24 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
            <span class="text-xs text-digimon-dark-500">(Set by GM for non-fresh characters)</span>
          </div>

          <!-- Spend XP Section -->
          <div v-if="form.xp > 0" class="border-t border-digimon-dark-600 pt-4 space-y-4">
            <h3 class="text-sm font-semibold text-digimon-dark-300">Spend XP</h3>

            <!-- Attributes -->
            <div class="bg-digimon-dark-700/50 rounded-lg p-3">
              <div class="text-xs text-digimon-dark-400 mb-2">Attributes <span class="text-digimon-dark-500">(Cost: new rating × 2)</span></div>
              <div class="grid grid-cols-5 gap-2">
                <div v-for="attr in (['agility', 'body', 'charisma', 'intelligence', 'willpower'] as const)" :key="attr" class="text-center">
                  <div class="text-xs text-digimon-dark-400 capitalize mb-1">{{ attr.slice(0, 3) }}</div>
                  <div class="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      class="w-6 h-6 rounded bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="xpBonuses.attributes[attr] <= 0"
                      @click="refundXPFromAttribute(attr)"
                    >-</button>
                    <span class="w-6 text-center text-white text-sm">{{ getTotalAttribute(attr) }}</span>
                    <button
                      type="button"
                      class="w-6 h-6 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      :class="canAffordAttributeIncrease(attr) ? 'bg-digimon-orange-500 hover:bg-digimon-orange-600' : 'bg-digimon-dark-600'"
                      :disabled="!canAffordAttributeIncrease(attr)"
                      @click="spendXPOnAttribute(attr)"
                    >+</button>
                  </div>
                  <div v-if="getTotalAttribute(attr) < campaignConfig.finalCap" class="text-xs mt-1" :class="canAffordAttributeIncrease(attr) ? 'text-digimon-orange-400' : 'text-red-400'">
                    {{ (getTotalAttribute(attr) + 1) * 2 }} XP
                  </div>
                </div>
              </div>
            </div>

            <!-- Skills -->
            <div class="bg-digimon-dark-700/50 rounded-lg p-3">
              <div class="text-xs text-digimon-dark-400 mb-2">Skills <span class="text-digimon-dark-500">(Cost: new rating)</span></div>
              <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div v-for="(skills, attrGroup) in skillsByAttribute" :key="attrGroup">
                  <div class="text-xs text-digimon-orange-400 mb-1 capitalize">{{ attrGroup }}</div>
                  <div class="space-y-1">
                    <div v-for="skill in skills" :key="skill" class="flex items-center justify-between gap-1">
                      <span class="text-xs text-digimon-dark-300 truncate flex-1">{{ skillLabels[skill] }}</span>
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class="w-5 h-5 rounded bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          :disabled="xpBonuses.skills[skill as keyof typeof xpBonuses.skills] <= 0"
                          @click="refundXPFromSkill(skill as keyof typeof form.skills)"
                        >-</button>
                        <span class="w-4 text-center text-white text-xs">{{ getTotalSkill(skill as keyof typeof form.skills) }}</span>
                        <button
                          type="button"
                          class="w-5 h-5 rounded text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          :class="canAffordSkillIncrease(skill as keyof typeof form.skills) ? 'bg-digimon-orange-500 hover:bg-digimon-orange-600' : 'bg-digimon-dark-600'"
                          :disabled="!canAffordSkillIncrease(skill as keyof typeof form.skills)"
                          @click="spendXPOnSkill(skill as keyof typeof form.skills)"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Inspiration -->
            <div class="bg-digimon-dark-700/50 rounded-lg p-3">
              <div class="text-xs text-digimon-dark-400 mb-2">Inspiration <span class="text-digimon-dark-500">(Cost: current × 2)</span></div>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="w-6 h-6 rounded bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="xpBonuses.inspiration <= 0"
                  @click="refundXPFromInspiration()"
                >-</button>
                <span class="text-white">{{ totalInspiration }} / {{ maxInspiration }}</span>
                <button
                  type="button"
                  class="w-6 h-6 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="canAffordInspiration ? 'bg-digimon-orange-500 hover:bg-digimon-orange-600' : 'bg-digimon-dark-600'"
                  :disabled="!canAffordInspiration"
                  @click="spendXPOnInspiration()"
                >+</button>
                <span v-if="totalInspiration < maxInspiration" class="text-xs" :class="canAffordInspiration ? 'text-digimon-orange-400' : 'text-red-400'">
                  Next: {{ totalInspiration * 2 }} XP
                </span>
                <span v-else class="text-xs text-green-400">Max reached</span>
              </div>
              <p class="text-xs text-digimon-dark-500 mt-2">
                Inspiration can be spent to re-roll dice or bolster rolls. Max = Willpower.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Derived Stats -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Derived Stats</h2>
        <p class="text-xs text-digimon-dark-500 mb-4">These are calculated automatically from your attributes and skills.</p>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.woundBoxes }}</div>
            <div class="text-sm text-digimon-dark-400">Wound Boxes</div>
          </div>
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.speed }}</div>
            <div class="text-sm text-digimon-dark-400">Speed</div>
          </div>
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.accuracyPool }}</div>
            <div class="text-sm text-digimon-dark-400">Accuracy Pool</div>
          </div>
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.dodgePool }}</div>
            <div class="text-sm text-digimon-dark-400">Dodge Pool</div>
          </div>
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.armor }}</div>
            <div class="text-sm text-digimon-dark-400">Armor</div>
          </div>
          <div class="bg-digimon-dark-700 rounded-lg p-4 text-center">
            <div class="text-2xl font-bold text-white">{{ derivedStats.damage }}</div>
            <div class="text-sm text-digimon-dark-400">Damage</div>
          </div>
        </div>
      </div>

      <!-- Special Orders -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Special Orders</h2>
        <p class="text-xs text-digimon-dark-500 mb-4">Combat directives unlocked by your attributes. Must have previous tier to unlock next.</p>

        <div v-if="unlockedSpecialOrders.length === 0" class="text-center py-4 text-digimon-dark-400">
          No Special Orders unlocked yet. Increase your attributes to unlock orders.
        </div>

        <div v-else class="space-y-4">
          <div v-for="group in unlockedSpecialOrders" :key="group.attribute">
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-2 capitalize">{{ group.attribute }}</h3>
            <div class="space-y-2">
              <div
                v-for="order in group.orders"
                :key="order.name"
                class="bg-digimon-dark-700 rounded-lg p-3"
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-semibold text-white">{{ order.name }}</span>
                  <span class="text-xs px-2 py-0.5 rounded bg-digimon-dark-600 text-digimon-dark-300">{{ order.type }}</span>
                </div>
                <p class="text-sm text-digimon-dark-300">{{ order.effect }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Portrait / Image -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Portrait / Image</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Image URL</label>
            <input
              v-model="form.spriteUrl"
              type="url"
              placeholder="https://example.com/portrait.png"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
            <p class="text-xs text-digimon-dark-500 mt-1">
              Enter a URL to an image for your tamer's portrait.
            </p>
          </div>
          <div class="flex items-center justify-center">
            <div
              v-if="form.spriteUrl && !spriteError"
              class="w-32 h-32 bg-digimon-dark-700 rounded-lg overflow-hidden flex items-center justify-center"
            >
              <img
                :src="form.spriteUrl"
                :alt="form.name || 'Tamer portrait'"
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
          placeholder="Character background, personality, goals..."
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
          {{ loading ? 'Creating...' : 'Create Character' }}
        </button>
        <NuxtLink
          to="/player"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
