<script setup lang="ts">
import { skillsByAttribute, skillLabels, attributes } from '~/constants/tamer-skills'

definePageMeta({
  title: 'Campaign Settings',
  middleware: ['campaign-access', 'dm-access'],
})

const { campaignId, campaign, loadCampaign } = useCampaignContext()
const { updateCampaign } = useCampaigns()

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

const form = reactive({
  name: '',
  description: '',
  level: 'standard' as 'standard' | 'enhanced' | 'extreme',
  password: '' as string,
  dmPassword: '' as string,
  tormentMode: 'default' as 'default' | 'custom',
  tormentMinimums: {
    minor: 0,
    major: 0,
    terrible: 0,
  },
  skillRenames: {} as Record<string, string>,
  eddySoulRules: {
    accuracyIsAgilityAthletics: false,
    damageIsBodyFeatsOfStrength: false,
    armorIsWillpowerEndurance: false,
    baseStatRangesEnabled: false,
    chargeAttackCosts3DP: false,
    instinctBoostsDodgeArmorSpeed: false,
    hugeSizeRequiresMega: false,
    hugePowerOncePerTurn: false,
  },
})

const changePassword = ref(false)
const changeDmPassword = ref(false)

onMounted(async () => {
  await loadCampaign()
  if (campaign.value) {
    form.name = campaign.value.name
    form.description = campaign.value.description
    form.level = campaign.value.level

    // Load torment rules
    const rules = campaign.value.rulesSettings?.tormentRequirements
    if (rules) {
      form.tormentMode = rules.mode
      if (rules.minCounts) {
        form.tormentMinimums.minor = rules.minCounts.minor ?? 0
        form.tormentMinimums.major = rules.minCounts.major ?? 0
        form.tormentMinimums.terrible = rules.minCounts.terrible ?? 0
      }
    }

    // Load skill renames
    const renames = campaign.value.rulesSettings?.skillRenames
    if (renames) {
      form.skillRenames = { ...renames }
    }

    // Load EddySoul rules
    const eddySoul = campaign.value.rulesSettings?.eddySoulRules
    if (eddySoul) {
      form.eddySoulRules.accuracyIsAgilityAthletics = eddySoul.accuracyIsAgilityAthletics ?? false
      form.eddySoulRules.damageIsBodyFeatsOfStrength = eddySoul.damageIsBodyFeatsOfStrength ?? false
      form.eddySoulRules.armorIsWillpowerEndurance = eddySoul.armorIsWillpowerEndurance ?? false
      form.eddySoulRules.baseStatRangesEnabled = eddySoul.baseStatRangesEnabled ?? false
      form.eddySoulRules.chargeAttackCosts3DP = eddySoul.chargeAttackCosts3DP ?? false
      form.eddySoulRules.instinctBoostsDodgeArmorSpeed = eddySoul.instinctBoostsDodgeArmorSpeed ?? false
      form.eddySoulRules.hugeSizeRequiresMega = eddySoul.hugeSizeRequiresMega ?? false
      form.eddySoulRules.hugePowerOncePerTurn = eddySoul.hugePowerOncePerTurn ?? false
    }
  }
  loading.value = false
})

async function handleSave() {
  saving.value = true
  saved.value = false

  const data: any = {
    name: form.name,
    description: form.description,
    level: form.level,
  }

  if (changePassword.value) {
    data.password = form.password || null
  }
  if (changeDmPassword.value) {
    data.dmPassword = form.dmPassword || null
  }

  // Build rulesSettings
  const activeRenames = Object.fromEntries(
    Object.entries(form.skillRenames).filter(([_, v]) => v && v.trim())
  )

  data.rulesSettings = {
    tormentRequirements: {
      mode: form.tormentMode,
      ...(form.tormentMode === 'custom' && {
        minCounts: {
          minor: form.tormentMinimums.minor,
          major: form.tormentMinimums.major,
          terrible: form.tormentMinimums.terrible,
        },
      }),
    },
    ...(Object.keys(activeRenames).length > 0 && {
      skillRenames: activeRenames,
    }),
    ...((form.eddySoulRules.accuracyIsAgilityAthletics || form.eddySoulRules.damageIsBodyFeatsOfStrength || form.eddySoulRules.armorIsWillpowerEndurance || form.eddySoulRules.baseStatRangesEnabled || form.eddySoulRules.chargeAttackCosts3DP || form.eddySoulRules.instinctBoostsDodgeArmorSpeed || form.eddySoulRules.hugeSizeRequiresMega || form.eddySoulRules.hugePowerOncePerTurn) && {
      eddySoulRules: {
        ...(form.eddySoulRules.accuracyIsAgilityAthletics && { accuracyIsAgilityAthletics: true }),
        ...(form.eddySoulRules.damageIsBodyFeatsOfStrength && { damageIsBodyFeatsOfStrength: true }),
        ...(form.eddySoulRules.armorIsWillpowerEndurance && { armorIsWillpowerEndurance: true }),
        ...(form.eddySoulRules.baseStatRangesEnabled && { baseStatRangesEnabled: true }),
        ...(form.eddySoulRules.chargeAttackCosts3DP && { chargeAttackCosts3DP: true }),
        ...(form.eddySoulRules.instinctBoostsDodgeArmorSpeed && { instinctBoostsDodgeArmorSpeed: true }),
        ...(form.eddySoulRules.hugeSizeRequiresMega && { hugeSizeRequiresMega: true }),
        ...(form.eddySoulRules.hugePowerOncePerTurn && { hugePowerOncePerTurn: true }),
      },
    }),
  }

  await updateCampaign(campaignId.value, data)
  await loadCampaign(true)
  saving.value = false
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-2xl">
    <div class="mb-8">
      <NuxtLink
        :to="`/campaigns/${campaignId}`"
        class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block"
      >
        ← Back to Campaign Hub
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Campaign Settings</h1>
    </div>

    <div v-if="loading" class="text-center py-16">
      <div class="text-digimon-dark-400">Loading...</div>
    </div>

    <form v-else class="space-y-6" @submit.prevent="handleSave">
      <!-- Name -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Name</label>
        <input
          v-model="form.name"
          type="text"
          required
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        />
      </div>

      <!-- Description -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Description</label>
        <textarea
          v-model="form.description"
          rows="3"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
      </div>

      <!-- Campaign Level -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Level</label>
        <select
          v-model="form.level"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        >
          <option value="standard">Standard (30 CP, caps at 5)</option>
          <option value="enhanced">Enhanced (40 CP, caps at 7)</option>
          <option value="extreme">Extreme (50 CP, caps at 10)</option>
        </select>
      </div>

      <!-- Passwords -->
      <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700 space-y-4">
        <h3 class="font-semibold text-white">Password Protection</h3>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm text-digimon-dark-400">Campaign Password</label>
            <label class="flex items-center gap-2 text-sm text-digimon-dark-400">
              <input v-model="changePassword" type="checkbox" class="rounded" />
              Change password
            </label>
          </div>
          <input
            v-if="changePassword"
            v-model="form.password"
            type="password"
            placeholder="New password (leave blank to remove)"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p v-else class="text-sm text-digimon-dark-500">
            {{ campaign?.hasPassword ? 'Password is set' : 'No password set' }}
          </p>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm text-digimon-dark-400">DM Password</label>
            <label class="flex items-center gap-2 text-sm text-digimon-dark-400">
              <input v-model="changeDmPassword" type="checkbox" class="rounded" />
              Change password
            </label>
          </div>
          <input
            v-if="changeDmPassword"
            v-model="form.dmPassword"
            type="password"
            placeholder="New DM password (leave blank to remove)"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p v-else class="text-sm text-digimon-dark-500">
            {{ campaign?.hasDmPassword ? 'DM password is set' : 'No DM password set' }}
          </p>
        </div>
      </div>

      <!-- Torment Rules Settings -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h3 class="font-semibold text-white mb-4">Torment Requirements</h3>

        <div class="space-y-4">
          <!-- Mode Toggle -->
          <div>
            <label class="block text-sm font-medium text-digimon-dark-300 mb-3">Torment Minimums</label>
            <div class="space-y-2">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="form.tormentMode"
                  type="radio"
                  value="default"
                  class="w-4 h-4 rounded"
                />
                <span class="text-digimon-dark-300">
                  Default (2 Minor OR 1 Major/Terrible)
                </span>
              </label>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="form.tormentMode"
                  type="radio"
                  value="custom"
                  class="w-4 h-4 rounded"
                />
                <span class="text-digimon-dark-300">
                  Custom minimums
                </span>
              </label>
            </div>
          </div>

          <!-- Custom Minimums (shown when custom mode is selected) -->
          <div v-if="form.tormentMode === 'custom'" class="space-y-3 pt-2 border-t border-digimon-dark-600">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Minor Torments</label>
                <input
                  v-model.number="form.tormentMinimums.minor"
                  type="number"
                  min="0"
                  class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                         focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Major Torments</label>
                <input
                  v-model.number="form.tormentMinimums.major"
                  type="number"
                  min="0"
                  class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                         focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Terrible Torments</label>
                <input
                  v-model.number="form.tormentMinimums.terrible"
                  type="number"
                  min="0"
                  class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                         focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>
            <p class="text-xs text-digimon-dark-400 pt-2">
              New tamers must meet ALL specified minimums. Leave at 0 to allow none of that severity.
            </p>
          </div>
        </div>
      </div>

      <!-- EddySoul Rules -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h3 class="font-semibold text-white mb-2">EddySoul Rules</h3>
        <p class="text-sm text-digimon-dark-400 mb-4">
          Alternative rules by EddySoul
        </p>

        <div class="space-y-3">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.accuracyIsAgilityAthletics"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Tamer Accuracy = Agility + Athletics</span>
              <p class="text-xs text-digimon-dark-500">Default: Agility + Fight</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.damageIsBodyFeatsOfStrength"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Tamer Damage = Body + Feats of Strength</span>
              <p class="text-xs text-digimon-dark-500">Default: Body + Fight</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.armorIsWillpowerEndurance"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Tamer Armour = Willpower + Endurance</span>
              <p class="text-xs text-digimon-dark-500">Default: Body + Endurance</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.baseStatRangesEnabled"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Enforce per-stat Base DP ranges</span>
              <p class="text-xs text-digimon-dark-500">
                Each base stat must fall within a min-max range per stage:
                In-Training 2-4, Rookie 3-7, Champion 4-9, Ultimate 5-11, Mega 6-13.
                Does not apply to Fresh or Ultra.
              </p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.chargeAttackCosts3DP"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Charge Attack costs 3 DP</span>
              <p class="text-xs text-digimon-dark-500">Default: 1 DP</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.instinctBoostsDodgeArmorSpeed"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Instinct boosts Dodge, Armour & Speed</span>
              <p class="text-xs text-digimon-dark-500">Default: +1 Dodge, Health, Base Movement per rank</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.hugeSizeRequiresMega"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Restrict large sizes by stage</span>
              <p class="text-xs text-digimon-dark-500">Default: No restriction</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.hugePowerOncePerTurn"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Huge Power once per turn & Rank 2 requires Ultimate+</span>
              <p class="text-xs text-digimon-dark-500">Default: Rank 1 unlimited for melee, 1/round for ranged. Rank 2 available at any stage</p>
            </div>
          </label>
        </div>
      </div>

      <!-- Skill Renames -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h3 class="font-semibold text-white mb-2">Skill Renames</h3>
        <p class="text-sm text-digimon-dark-400 mb-4">
          Override skill display names for this campaign. Leave blank to use the default name.
        </p>

        <div class="space-y-4">
          <div v-for="attr in attributes" :key="attr">
            <h4 class="text-sm font-medium text-digimon-dark-300 capitalize mb-2">{{ attr }}</h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div v-for="skill in skillsByAttribute[attr]" :key="skill">
                <label class="block text-xs text-digimon-dark-400 mb-1">{{ skillLabels[skill] }}</label>
                <input
                  v-model="form.skillRenames[skill]"
                  type="text"
                  :placeholder="skillLabels[skill]"
                  maxlength="30"
                  class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                         focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Submit -->
      <div class="flex items-center gap-4">
        <button
          type="submit"
          :disabled="saving"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
        <span v-if="saved" class="text-green-400 text-sm">Saved!</span>
      </div>
    </form>
  </div>
</template>
