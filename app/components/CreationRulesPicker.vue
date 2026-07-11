<script setup lang="ts">
import type { CreationRules } from '~/types'

// Sandbox rules picker: exposes only the campaign settings that affect
// character creation (see app/utils/creationRules.ts). Mirrors the section
// grouping of the campaign settings page.
const props = defineProps<{
  modelValue: CreationRules
  startCollapsed?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: CreationRules): void
}>()

const expanded = ref(!props.startCollapsed)

interface LocalRules {
  level: CreationRules['level']
  accuracyIsAgilityAthletics: boolean
  damageIsBodyFeatsOfStrength: boolean
  armorIsWillpowerEndurance: boolean
  baseStatRangesEnabled: boolean
  chargeAttackCosts3DP: boolean
  instinctBoostsDodgeArmorSpeed: boolean
  hugeSizeRequiresMega: boolean
  bonusDPMinPerCategory: boolean
  allowDuplicateStatValues: boolean
  allowFlexCPSplits: boolean
  skillOrders: boolean
  giganticMaxSize: { x: number | null; y: number | null; z: number | null }
  tormentMode: 'default' | 'custom'
  tormentMinimums: { minor: number; major: number; terrible: number }
}

function toLocal(rules: CreationRules): LocalRules {
  return {
    level: rules.level || 'standard',
    accuracyIsAgilityAthletics: !!rules.eddySoulRules?.accuracyIsAgilityAthletics,
    damageIsBodyFeatsOfStrength: !!rules.eddySoulRules?.damageIsBodyFeatsOfStrength,
    armorIsWillpowerEndurance: !!rules.eddySoulRules?.armorIsWillpowerEndurance,
    baseStatRangesEnabled: !!rules.eddySoulRules?.baseStatRangesEnabled,
    chargeAttackCosts3DP: !!rules.eddySoulRules?.chargeAttackCosts3DP,
    instinctBoostsDodgeArmorSpeed: !!rules.eddySoulRules?.instinctBoostsDodgeArmorSpeed,
    hugeSizeRequiresMega: !!rules.eddySoulRules?.hugeSizeRequiresMega,
    bonusDPMinPerCategory: !!rules.eddySoulRules?.bonusDPMinPerCategory,
    allowDuplicateStatValues: !!rules.houseRules?.allowDuplicateStatValues,
    allowFlexCPSplits: !!rules.houseRules?.allowFlexCPSplits,
    skillOrders: !!rules.houseRules?.skillOrders,
    giganticMaxSize: {
      x: rules.houseRules?.giganticMaxSize?.x ?? null,
      y: rules.houseRules?.giganticMaxSize?.y ?? null,
      z: rules.houseRules?.giganticMaxSize?.z ?? null,
    },
    tormentMode: rules.tormentRequirements?.mode === 'custom' ? 'custom' : 'default',
    tormentMinimums: {
      minor: rules.tormentRequirements?.minCounts?.minor ?? 0,
      major: rules.tormentRequirements?.minCounts?.major ?? 0,
      terrible: rules.tormentRequirements?.minCounts?.terrible ?? 0,
    },
  }
}

function fromLocal(l: LocalRules): CreationRules {
  const hasGiganticCap = !!(l.giganticMaxSize.x || l.giganticMaxSize.y || l.giganticMaxSize.z)
  return {
    level: l.level,
    eddySoulRules: {
      accuracyIsAgilityAthletics: l.accuracyIsAgilityAthletics,
      damageIsBodyFeatsOfStrength: l.damageIsBodyFeatsOfStrength,
      armorIsWillpowerEndurance: l.armorIsWillpowerEndurance,
      baseStatRangesEnabled: l.baseStatRangesEnabled,
      chargeAttackCosts3DP: l.chargeAttackCosts3DP,
      instinctBoostsDodgeArmorSpeed: l.instinctBoostsDodgeArmorSpeed,
      hugeSizeRequiresMega: l.hugeSizeRequiresMega,
      bonusDPMinPerCategory: l.bonusDPMinPerCategory,
    },
    houseRules: {
      allowDuplicateStatValues: l.allowDuplicateStatValues,
      allowFlexCPSplits: l.allowFlexCPSplits,
      skillOrders: l.skillOrders,
      giganticMaxSize: hasGiganticCap
        ? { x: l.giganticMaxSize.x || 0, y: l.giganticMaxSize.y || 0, z: l.giganticMaxSize.z || 0 }
        : null,
    },
    tormentRequirements: l.tormentMode === 'custom'
      ? { mode: 'custom', minCounts: { ...l.tormentMinimums } }
      : { mode: 'default' },
  }
}

const local = reactive<LocalRules>(toLocal(props.modelValue))

let syncingFromProp = false
watch(() => props.modelValue, (value) => {
  syncingFromProp = true
  Object.assign(local, toLocal(value))
  nextTick(() => { syncingFromProp = false })
})

watch(local, () => {
  if (syncingFromProp) return
  emit('update:modelValue', fromLocal(local))
}, { deep: true })

const activeRuleCount = computed(() => {
  const toggles = [
    local.accuracyIsAgilityAthletics, local.damageIsBodyFeatsOfStrength, local.armorIsWillpowerEndurance,
    local.baseStatRangesEnabled, local.chargeAttackCosts3DP, local.instinctBoostsDodgeArmorSpeed,
    local.hugeSizeRequiresMega, local.bonusDPMinPerCategory,
    local.allowDuplicateStatValues, local.allowFlexCPSplits, local.skillOrders,
  ]
  return toggles.filter(Boolean).length
    + (local.tormentMode === 'custom' ? 1 : 0)
    + ((local.giganticMaxSize.x || local.giganticMaxSize.y || local.giganticMaxSize.z) ? 1 : 0)
})

const levelLabel = computed(() =>
  local.level === 'extreme' ? 'Extreme' : local.level === 'enhanced' ? 'Enhanced' : 'Standard'
)
</script>

<template>
  <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
    <button
      type="button"
      class="w-full flex items-center justify-between px-6 py-4 text-left"
      @click="expanded = !expanded"
    >
      <div>
        <h3 class="font-semibold text-white">Creation Rules</h3>
        <p class="text-xs text-digimon-dark-400">
          {{ levelLabel }} level · {{ activeRuleCount }} optional rule{{ activeRuleCount === 1 ? '' : 's' }} on —
          this character is validated against these rules and they travel with it on export
        </p>
      </div>
      <span class="text-digimon-dark-400">{{ expanded ? '▼' : '▶' }}</span>
    </button>

    <div v-if="expanded" class="px-6 pb-6 space-y-6">
      <!-- Level -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Level</label>
        <select
          v-model="local.level"
          class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        >
          <option value="standard">Standard (30 CP, caps at 5)</option>
          <option value="enhanced">Enhanced (40 CP, caps at 7)</option>
          <option value="extreme">Extreme (50 CP, caps at 10)</option>
        </select>
      </div>

      <!-- Tamer rules -->
      <div>
        <h4 class="text-sm font-semibold text-digimon-orange-400 mb-3">Tamer Creation</h4>
        <div class="space-y-3">
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.allowDuplicateStatValues" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Allow Duplicate Stat Max Values</span>
              <p class="text-xs text-digimon-dark-500">Multiple Attributes or Skills can be tied at the same highest value.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.allowFlexCPSplits" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Flexible CP Splits</span>
              <p class="text-xs text-digimon-dark-500">Distribute all CP freely across Attributes and Skills without enforced pool splits.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.skillOrders" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Skill Orders</span>
              <p class="text-xs text-digimon-dark-500">Unlocks a Skill Option per skill (shown on the sheet once thresholds are met).</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.accuracyIsAgilityAthletics" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Accuracy Pool = Agility + Athletics</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — default is Agility + Fight.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.damageIsBodyFeatsOfStrength" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Damage Pool = Body + Feats of Strength</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — default is Body + Fight.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.armorIsWillpowerEndurance" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Armor = Willpower + Endurance</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — default is Body + Endurance.</p>
            </div>
          </label>
        </div>
      </div>

      <!-- Torment requirements -->
      <div>
        <h4 class="text-sm font-semibold text-digimon-orange-400 mb-3">Torment Requirements</h4>
        <div class="space-y-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <input v-model="local.tormentMode" type="radio" value="default" class="w-4 h-4 rounded" />
            <span class="text-digimon-dark-300">Default (2 Minor OR 1 Major/Terrible)</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input v-model="local.tormentMode" type="radio" value="custom" class="w-4 h-4 rounded" />
            <span class="text-digimon-dark-300">Custom minimums</span>
          </label>
        </div>
        <div v-if="local.tormentMode === 'custom'" class="grid grid-cols-3 gap-3 mt-3">
          <div>
            <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Minor Torments</label>
            <input
              v-model.number="local.tormentMinimums.minor"
              type="number"
              min="0"
              class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                     focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Major Torments</label>
            <input
              v-model.number="local.tormentMinimums.major"
              type="number"
              min="0"
              class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                     focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-digimon-dark-300 mb-1">Terrible Torments</label>
            <input
              v-model.number="local.tormentMinimums.terrible"
              type="number"
              min="0"
              class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
                     focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <!-- Digimon rules -->
      <div>
        <h4 class="text-sm font-semibold text-digimon-orange-400 mb-3">Digimon Creation</h4>
        <div class="space-y-3">
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.baseStatRangesEnabled" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Base Stat Ranges per Stage</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — enforce a min–max range on each base stat by stage (e.g. Rookie 3–7).</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.chargeAttackCosts3DP" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Charge Attack Costs 3 DP</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — default cost is 1 DP.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.instinctBoostsDodgeArmorSpeed" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Instinct Boosts Dodge/Armor/Speed</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — default is Dodge/Health/Speed.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.hugeSizeRequiresMega" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Huge Size Requires Ultimate+</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — Huge needs Ultimate+, Gigantic needs Mega+.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="local.bonusDPMinPerCategory" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Minimum Bonus DP per Category</span>
              <p class="text-xs text-digimon-dark-500">EddySoul — at least 10% of Bonus DP must go into each stat category and qualities.</p>
            </div>
          </label>
          <div class="flex items-center gap-3 pt-2 border-t border-digimon-dark-700 mt-2">
            <div class="flex-1">
              <span class="text-digimon-dark-300 text-sm">Gigantic Max Dimensions</span>
              <p class="text-xs text-digimon-dark-500">Per-axis cap on Gigantic Digimon size (spaces). Leave empty for no limit.</p>
            </div>
            <div class="flex gap-2">
              <div v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" class="flex flex-col items-center gap-1">
                <label class="text-xs text-digimon-dark-500 uppercase font-semibold">{{ axis }}</label>
                <input
                  v-model.number="local.giganticMaxSize[axis]"
                  type="number"
                  min="4"
                  max="50"
                  placeholder="—"
                  class="w-16 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1 text-white text-sm text-center"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
