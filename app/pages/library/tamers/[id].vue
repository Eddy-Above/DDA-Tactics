<script setup lang="ts">
import type { Tamer } from '../../../server/db/schema'

definePageMeta({
  title: 'Edit Tamer',
})

const route = useRoute()
const router = useRouter()
const { fetchTamer, updateTamer, loading, error } = useTamers()

const tamer = ref<Tamer | null>(null)
const initialLoading = ref(true)

const form = reactive({
  name: '',
  age: 14,
  campaignLevel: 'standard' as 'standard' | 'enhanced' | 'extreme',
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
  majorAspect: { name: '', description: '' },
  minorAspect: { name: '', description: '' },
  notes: '',
})

// Campaign level configuration based on official rules
const campaignConfig = computed(() => {
  switch (form.campaignLevel) {
    case 'enhanced':
      return { startingCP: 40, attrCap: 18, skillCap: 22, startingCap: 5 }
    case 'extreme':
      return { startingCP: 50, attrCap: 22, skillCap: 28, startingCap: 7 }
    default: // standard
      return { startingCP: 30, attrCap: 12, skillCap: 18, startingCap: 3 }
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

const totalCP = computed(() => {
  const total = attributePoints.value.used + skillPoints.value.used
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

const skillsByAttribute = {
  agility: ['dodge', 'fight', 'stealth'],
  body: ['athletics', 'endurance', 'featsOfStrength'],
  charisma: ['manipulate', 'perform', 'persuasion'],
  intelligence: ['computer', 'survival', 'knowledge'],
  willpower: ['perception', 'decipherIntent', 'bravery'],
}

const skillLabels: Record<string, string> = {
  dodge: 'Dodge',
  fight: 'Fight',
  stealth: 'Stealth',
  athletics: 'Athletics',
  endurance: 'Endurance',
  featsOfStrength: 'Feats of Strength',
  manipulate: 'Manipulate',
  perform: 'Perform',
  persuasion: 'Persuasion',
  computer: 'Computer',
  survival: 'Survival',
  knowledge: 'Knowledge',
  perception: 'Perception',
  decipherIntent: 'Decipher Intent',
  bravery: 'Bravery',
}

// Derived stats calculated from attributes and skills
const derivedStats = computed(() => ({
  woundBoxes: Math.max(2, form.attributes.body + form.skills.endurance),
  speed: form.attributes.agility + form.skills.survival,
  accuracyPool: form.attributes.agility + form.skills.fight,
  dodgePool: form.attributes.agility + form.skills.dodge,
  armor: form.attributes.body + form.skills.endurance,
  damage: form.attributes.body + form.skills.fight,
}))

// Special Orders data
const specialOrderThresholds = {
  standard: [3, 4, 5],
  enhanced: [5, 6, 7],
  extreme: [6, 8, 10],
}

const specialOrdersData: Record<string, { name: string; type: string; effect: string }[]> = {
  agility: [
    { name: 'Strike First!', type: 'Passive', effect: '+1 Initiative and 2 Base Movement' },
    { name: 'Strike Fast!', type: 'Once Per Day / Complex', effect: 'Target\'s Dodge Pools halved for one attack (no Huge Power/Overkill)' },
    { name: 'Strike Last!', type: 'Once Per Day / Intercede', effect: 'Counter Blow on any attack, hit or miss (no Huge Power/Overkill)' },
  ],
  body: [
    { name: 'Energy Burst', type: 'Once Per Day / Complex', effect: 'Digimon recovers 5 wound boxes' },
    { name: 'Enduring Soul', type: 'Passive', effect: 'Survive one fatal blow with 1 Wound Box (once per battle)' },
    { name: 'Finishing Touch', type: 'Once Per Day / Simple', effect: '4s count as successes on Accuracy Roll (no Huge Power/Overkill)' },
  ],
  charisma: [
    { name: 'Swagger', type: 'Once Per Battle / Simple', effect: 'Taunt for 3 rounds, auto-aggro at CPUx2' },
    { name: 'Peak Performance', type: 'Once Per Day / Complex', effect: 'Bastion buff: +2 to all stats except health for 1 round' },
    { name: 'Guiding Light', type: 'Passive', effect: '+2 Accuracy to allies in burst radius, +1 Dodge per ally in radius' },
  ],
  intelligence: [
    { name: 'Quick Reaction', type: 'Once Per Day / Intercede', effect: 'Gain Stage Bonus+2 Dodge Dice for the round (diminishing)' },
    { name: 'Enemy Scan', type: 'Once Per Battle / Complex', effect: 'Debilitate: -2 to all stats except health for 1 round' },
    { name: 'Decimation', type: 'Once Per Day / Complex', effect: 'Use Signature Move on Round 2 instead of Round 3' },
  ],
  willpower: [
    { name: 'Tough it Out!', type: 'Once Per Battle / Complex', effect: 'Purify: cure one negative effect' },
    { name: 'Challenger', type: 'Passive', effect: 'Gain 2 + (enemy stage difference) temporary Wound Boxes (max 5)' },
    { name: 'Fateful Intervention', type: 'Free Action', effect: 'See Inspiration / Fateful Intervention mechanic' },
  ],
}

// Compute unlocked Special Orders based on attributes
const unlockedSpecialOrders = computed(() => {
  const thresholds = specialOrderThresholds[form.campaignLevel]
  const unlocked: { attribute: string; orders: { name: string; type: string; effect: string; tier: number }[] }[] = []

  for (const [attr, orders] of Object.entries(specialOrdersData)) {
    const attrValue = form.attributes[attr as keyof typeof form.attributes]
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

onMounted(async () => {
  const id = route.params.id as string
  const fetched = await fetchTamer(id)
  if (fetched) {
    tamer.value = fetched
    form.name = fetched.name
    form.age = fetched.age
    form.campaignLevel = fetched.campaignLevel
    Object.assign(form.attributes, fetched.attributes)
    Object.assign(form.skills, fetched.skills)
    // Load aspects
    const majorAspect = fetched.aspects?.find(a => a.type === 'major')
    const minorAspect = fetched.aspects?.find(a => a.type === 'minor')
    if (majorAspect) {
      form.majorAspect.name = majorAspect.name
      form.majorAspect.description = majorAspect.description
    }
    if (minorAspect) {
      form.minorAspect.name = minorAspect.name
      form.minorAspect.description = minorAspect.description
    }
    form.notes = fetched.notes || ''
  }
  initialLoading.value = false
})

async function handleSubmit() {
  if (!tamer.value) return
  // Build aspects array
  const aspects: Array<{ id: string; name: string; description: string; type: 'major' | 'minor'; usesRemaining: number }> = []
  if (form.majorAspect.name) {
    const existingMajor = tamer.value.aspects?.find(a => a.type === 'major')
    aspects.push({
      id: existingMajor?.id || crypto.randomUUID(),
      name: form.majorAspect.name,
      description: form.majorAspect.description,
      type: 'major',
      usesRemaining: existingMajor?.usesRemaining ?? 1,
    })
  }
  if (form.minorAspect.name) {
    const existingMinor = tamer.value.aspects?.find(a => a.type === 'minor')
    aspects.push({
      id: existingMinor?.id || crypto.randomUUID(),
      name: form.minorAspect.name,
      description: form.minorAspect.description,
      type: 'minor',
      usesRemaining: existingMinor?.usesRemaining ?? 2,
    })
  }
  const updated = await updateTamer(tamer.value.id, {
    name: form.name,
    age: form.age,
    campaignLevel: form.campaignLevel,
    attributes: { ...form.attributes },
    skills: { ...form.skills },
    aspects,
    notes: form.notes,
  })
  if (updated) {
    router.push('/library/tamers')
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/tamers" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Tamers
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Edit Tamer</h1>
    </div>

    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading tamer...</div>
    </div>

    <div v-else-if="!tamer" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Tamer Not Found</h2>
      <NuxtLink
        to="/library/tamers"
        class="text-digimon-orange-400 hover:text-digimon-orange-300"
      >
        Return to Tamers list
      </NuxtLink>
    </div>

    <form v-else class="space-y-8" @submit.prevent="handleSubmit">
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
                  v-model="form.majorAspect.name"
                  type="text"
                  placeholder="e.g., Track Star, Thuggish Looks"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Description</label>
                <textarea
                  v-model="form.majorAspect.description"
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
                  v-model="form.minorAspect.name"
                  type="text"
                  placeholder="e.g., Smarter Than They Act, Single-Minded Focus"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-1">Description</label>
                <textarea
                  v-model="form.minorAspect.description"
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
          {{ loading ? 'Saving...' : 'Save Changes' }}
        </button>
        <NuxtLink
          to="/library/tamers"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
