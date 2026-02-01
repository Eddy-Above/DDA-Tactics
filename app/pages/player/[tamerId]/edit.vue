<script setup lang="ts">
import type { Tamer } from '../../../server/db/schema'
import { useTamerForm } from '../../../composables/useTamerForm'

definePageMeta({
  layout: 'player',
  title: 'Edit Tamer',
})

const route = useRoute()
const router = useRouter()
const tamerId = computed(() => route.params.tamerId as string)
const { fetchTamer, updateTamer, loading, error } = useTamers()

const tamer = ref<Tamer | null>(null)
const initialLoading = ref(true)

// Collapsible section state (start collapsed, except XP & Inspiration which is expanded)
const sectionsCollapsed = reactive({
  basicInfo: true,
  attributes: true,
  skills: true,
  aspects: true,
  torments: true,
  xp: false, // XP & Inspiration section expanded by default in edit
})

// Initialize form composable (will be populated when tamer loads)
const {
  form,
  xpBonuses,
  torments,
  showAddTorment,
  newTormentSeverity,
  spriteError,
  skillLabels,
  skillsByAttribute,
  getTotalAttribute,
  getTotalSkill,
  handleSpriteError,
  getNextAttributeCost,
  getNextSkillCost,
  getNextInspirationCost,
  spendXPOnAttribute,
  refundXPFromAttribute,
  spendXPOnSkill,
  refundXPFromSkill,
  spendXPOnInspiration,
  refundXPFromInspiration,
  addTorment,
  removeTorment,
  updateTormentSeverity,
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
  getTormentBoxCost,
  unlockedSpecialOrders,
} = useTamerForm()


onMounted(async () => {
  const fetched = await fetchTamer(tamerId.value)
  if (fetched) {
    tamer.value = fetched
    form.name = fetched.name
    form.age = fetched.age
    form.campaignLevel = fetched.campaignLevel
    Object.assign(form.attributes, fetched.attributes)
    Object.assign(form.skills, fetched.skills)
    // Load aspects
    if (fetched.aspects && fetched.aspects.length > 0) {
      form.aspects = fetched.aspects
      const majorAspect = fetched.aspects.find(a => a.type === 'major')
      const minorAspect = fetched.aspects.find(a => a.type === 'minor')
      if (majorAspect) {
        form.majorAspect.name = majorAspect.name
        form.majorAspect.description = majorAspect.description
      }
      if (minorAspect) {
        form.minorAspect.name = minorAspect.name
        form.minorAspect.description = minorAspect.description
      }
    }
    form.notes = fetched.notes || ''
    form.spriteUrl = fetched.spriteUrl || ''
    form.xp = fetched.xp || 0
    form.inspiration = fetched.inspiration ?? 1
    // Load torments
    if (fetched.torments && fetched.torments.length > 0) {
      torments.value = fetched.torments.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        severity: t.severity,
        totalBoxes: t.totalBoxes,
        markedBoxes: t.markedBoxes,
        cpMarkedBoxes: (t as any).cpMarkedBoxes ?? 0, // Persisted CP-spent boxes
        originalMarkedBoxes: (t as any).cpMarkedBoxes ?? 0, // Use for locking logic
      }))
    }
    // Load xpBonuses from database (persisted separately from base values)
    if (fetched.xpBonuses) {
      Object.assign(xpBonuses.attributes, fetched.xpBonuses.attributes)
      Object.assign(xpBonuses.skills, fetched.xpBonuses.skills)
      xpBonuses.inspiration = fetched.xpBonuses.inspiration
    }
  }
  initialLoading.value = false
})

async function handleSubmit() {
  if (!tamer.value) return
  // Build aspects array from major/minor aspects
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
  // Build torments array
  const tormentData = torments.value.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    severity: t.severity,
    totalBoxes: t.totalBoxes,
    markedBoxes: t.markedBoxes,
    cpMarkedBoxes: t.cpMarkedBoxes, // Preserve CP-locked boxes
  }))

  // Save base values and xpBonuses separately - do NOT combine them
  // This allows users to reallocate XP at any time
  const updated = await updateTamer(tamer.value.id, {
    name: form.name,
    age: form.age,
    campaignLevel: form.campaignLevel,
    attributes: form.attributes,
    skills: form.skills,
    aspects,
    torments: tormentData,
    xp: form.xp,
    inspiration: form.inspiration,
    xpBonuses: {
      attributes: { ...xpBonuses.attributes },
      skills: { ...xpBonuses.skills },
      inspiration: xpBonuses.inspiration,
    },
    notes: form.notes,
    spriteUrl: form.spriteUrl || undefined,
  })
  if (updated) {
    router.push(`/player/${tamerId.value}`)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink :to="`/player/${tamerId}`" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Dashboard
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
        :to="`/player/${tamerId}`"
        class="text-digimon-orange-400 hover:text-digimon-orange-300"
      >
        Return to Dashboard
      </NuxtLink>
    </div>

    <form v-else class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.basicInfo }"
          @click="sectionsCollapsed.basicInfo = !sectionsCollapsed.basicInfo"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': sectionsCollapsed.basicInfo }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 class="font-display text-xl font-semibold text-white">Basic Information</h2>
          </div>
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
        <div v-show="!sectionsCollapsed.basicInfo">
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
        </div>
      </div>

      <!-- Attributes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.attributes }"
          @click="sectionsCollapsed.attributes = !sectionsCollapsed.attributes"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': sectionsCollapsed.attributes }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 class="font-display text-xl font-semibold text-white">Attributes</h2>
          </div>
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
        <div v-show="!sectionsCollapsed.attributes">
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
              <span v-if="form.attributes[attr] < campaignConfig.startingCap"
                    class="text-xs mt-1 block"
                    :class="canAffordAttributeIncrease(attr) ? 'text-digimon-orange-400' : 'text-red-400'">
                +1: {{ getNextAttributeCost(form.attributes[attr]) }} XP
              </span>
            </div>
          </div>
          <p class="text-xs text-digimon-dark-500 mt-2">Max per attribute: {{ campaignConfig.startingCap }} (only 1 can be at max). Cost: new rating × 2 XP</p>
          <p v-if="cappedAttributes > 1" class="text-xs text-red-400 mt-1">
            Only 1 attribute can be at the highest value. You have {{ cappedAttributes }} tied for highest.
          </p>
        </div>
      </div>

      <!-- Skills -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.skills }"
          @click="sectionsCollapsed.skills = !sectionsCollapsed.skills"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': sectionsCollapsed.skills }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 class="font-display text-xl font-semibold text-white">Skills</h2>
          </div>
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
        <div v-show="!sectionsCollapsed.skills">
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
                  <span v-if="form.skills[skill as keyof typeof form.skills] < campaignConfig.startingCap"
                        class="text-xs w-12"
                        :class="canAffordSkillIncrease(skill as keyof typeof form.skills) ? 'text-digimon-orange-400' : 'text-red-400'">
                    {{ getNextSkillCost(form.skills[skill as keyof typeof form.skills]) }} XP
                  </span>
                </div>
              </div>
            </div>
          </div>
          <p class="text-xs text-digimon-dark-500 mt-2">Max per skill: {{ campaignConfig.startingCap }} (only 1 can be at max). Cost: new rating XP</p>
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
      </div>

      <!-- Aspects -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex items-center gap-2 cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.aspects }"
          @click="sectionsCollapsed.aspects = !sectionsCollapsed.aspects"
        >
          <svg
            class="w-5 h-5 text-digimon-dark-400 transition-transform"
            :class="{ '-rotate-90': sectionsCollapsed.aspects }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
          <h2 class="font-display text-xl font-semibold text-white">Aspects</h2>
        </div>

        <div v-show="!sectionsCollapsed.aspects">
          <p class="text-xs text-digimon-dark-500 mb-4">
            Personality traits that can help or hinder you. Major (+/-4, 1/day), Minor (+/-2, 2/day).
          </p>

          <div class="space-y-6">
          <!-- Major Aspect -->
          <div>
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3">
              Major Aspect (+/-4)
            </h3>
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
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3">
              Minor Aspect (+/-2)
            </h3>
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
      </div>

      <!-- Torments -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.torments }"
          @click="sectionsCollapsed.torments = !sectionsCollapsed.torments"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': sectionsCollapsed.torments }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 class="font-display text-xl font-semibold text-white">Torments</h2>
          </div>
          <span class="text-sm text-digimon-dark-400">{{ torments.length }} torment(s)</span>
        </div>

        <div v-show="!sectionsCollapsed.torments">
          <div class="flex justify-between items-center mb-4">
            <p class="text-xs text-digimon-dark-500">
              Character flaws or traumas to overcome. Roll: 3d6 + Willpower - unmarked boxes vs TN 12.
            </p>
            <button
              type="button"
              class="text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-3 py-1.5 rounded-lg transition-colors"
              @click="showAddTorment = !showAddTorment"
            >
              + Add Torment
            </button>
          </div>

          <!-- Add torment dialog -->
          <div v-if="showAddTorment" class="bg-digimon-dark-700 rounded-lg p-4 mb-4">
            <div class="flex items-center gap-4">
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
            No torments added yet.
          </div>

          <div v-else class="space-y-4">
            <div
              v-for="torment in torments"
              :key="torment.id"
              class="bg-digimon-dark-700 rounded-lg p-4"
            >
              <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex-1 space-y-2">
                  <div class="flex items-center gap-3">
                    <input
                      v-model="torment.name"
                      type="text"
                      placeholder="Torment name..."
                      class="flex-1 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-3 py-1.5
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
                        ? i <= torment.originalMarkedBoxes
                          ? 'bg-green-600 border-green-500 cursor-not-allowed' // Locked (CP-spent)
                          : 'bg-green-500 border-green-400 cursor-pointer'
                        : 'bg-digimon-dark-600 border-digimon-dark-500 hover:border-digimon-dark-400 cursor-pointer'
                    ]"
                    :title="i <= torment.originalMarkedBoxes ? 'CP-spent box (cannot be removed)' : ''"
                    @click="torment.markedBoxes = torment.markedBoxes >= i
                      ? Math.max(i - 1, torment.originalMarkedBoxes)
                      : i"
                  />
                </div>
                <span class="text-xs text-digimon-dark-400">
                  {{ torment.markedBoxes }}/{{ torment.totalBoxes }}
                  <span v-if="torment.markedBoxes < torment.totalBoxes" class="text-yellow-400 ml-1">
                    (Roll: -{{ torment.totalBoxes - torment.markedBoxes }})
                  </span>
                  <span v-else class="text-green-400 ml-1">(Overcome!)</span>
                </span>
                <!-- XP cost for next box -->
                <span v-if="torment.markedBoxes < torment.totalBoxes"
                      class="text-xs"
                      :class="canAffordTormentBox(torment) ? 'text-digimon-orange-400' : 'text-red-400'">
                  Next: {{ getTormentBoxCost(torment) }} XP
                </span>
              </div>
              <p v-if="torment.originalMarkedBoxes > 0" class="text-xs text-digimon-dark-500 mt-2">
                {{ torment.originalMarkedBoxes }} box(es) marked with CP at creation (cannot be removed)
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- XP & Inspiration -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div
          class="flex justify-between items-center cursor-pointer select-none"
          :class="{ 'mb-4': !sectionsCollapsed.xp }"
          @click="sectionsCollapsed.xp = !sectionsCollapsed.xp"
        >
          <div class="flex items-center gap-2">
            <svg
              class="w-5 h-5 text-digimon-dark-400 transition-transform"
              :class="{ '-rotate-90': sectionsCollapsed.xp }"
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

        <div v-show="!sectionsCollapsed.xp">
          <!-- XP Display and Edit -->
          <div class="flex items-center gap-4 mb-4">
            <div class="bg-digimon-dark-700 rounded-lg p-4 flex-1">
              <div class="text-2xl font-bold text-white">{{ form.xp }}</div>
              <div class="text-sm text-digimon-dark-400">Available XP</div>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-sm text-digimon-dark-400">Set XP:</label>
              <input
                v-model.number="form.xp"
                type="number"
                min="0"
                class="w-24 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <!-- Spend XP Section -->
          <div class="border-t border-digimon-dark-600 pt-4 space-y-4">
            <h3 class="text-sm font-semibold text-digimon-dark-300">Spend XP</h3>

            <!-- Attributes -->
            <div class="bg-digimon-dark-700/50 rounded-lg p-3">
              <div class="text-xs text-digimon-dark-400 mb-2">Attributes <span class="text-digimon-dark-500">(Cost: new rating × 2, Refund: current rating × 2)</span></div>
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
              <div class="text-xs text-digimon-dark-400 mb-2">Skills <span class="text-digimon-dark-500">(Cost: new rating, Refund: current rating)</span></div>
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
                  @click="refundXPFromInspiration"
                >-</button>
                <span class="text-white">{{ totalInspiration }} / {{ maxInspiration }}</span>
                <button
                  type="button"
                  class="w-6 h-6 rounded text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="canAffordInspiration ? 'bg-digimon-orange-500 hover:bg-digimon-orange-600' : 'bg-digimon-dark-600'"
                  :disabled="!canAffordInspiration"
                  @click="spendXPOnInspiration"
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
          {{ loading ? 'Saving...' : 'Save Changes' }}
        </button>
        <NuxtLink
          :to="`/player/${tamerId}`"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
