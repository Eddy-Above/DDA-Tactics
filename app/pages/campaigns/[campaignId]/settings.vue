<script setup lang="ts">
import { skillsByAttribute, skillLabels, attributes } from '~/constants/tamer-skills'

definePageMeta({
  title: 'Campaign Settings',
  middleware: ['campaign-access', 'settings-access'],
})

const { campaignId, campaign, loadCampaign } = useCampaignContext()
const { updateCampaign, deleteCampaign, verifyDmPassword } = useCampaigns()
const { tamers: campaignTamers, fetchTamers } = useTamers()

// === DM Access (co-dm / co-owner grants) ===

interface DmGrantView {
  id: string
  userId: string
  username: string
  dmRole: 'co-dm' | 'co-owner' | null
}

const dmGrants = ref<DmGrantView[]>([])
const ownerUsername = ref<string | null>(null)
const dmGrantsLoading = ref(false)
const dmGrantSaving = ref(false)
const dmGrantError = ref('')

const showAddDmGrant = ref(false)
const addDmUser = ref<{ id: string; username: string } | null>(null)
const addDmRole = ref<'co-dm' | 'co-owner'>('co-dm')

function dmRoleValue(g: DmGrantView) { return g.dmRole ?? 'none' }

async function loadDmGrants() {
  if (!campaign.value?.ownerId) return
  dmGrantsLoading.value = true
  try {
    const result = await $fetch<{ grants: DmGrantView[]; ownerUsername: string | null }>(
      `/api/campaigns/${campaignId.value}/grants`,
    )
    dmGrants.value = result.grants
    ownerUsername.value = result.ownerUsername
  } catch (e) {
    console.error('Failed to load DM access grants:', e)
  } finally {
    dmGrantsLoading.value = false
  }
}

function resetAddDmGrantForm() {
  showAddDmGrant.value = false
  addDmUser.value = null
  addDmRole.value = 'co-dm'
  dmGrantError.value = ''
}

async function submitAddDmGrant() {
  if (!addDmUser.value) return
  dmGrantSaving.value = true
  dmGrantError.value = ''
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/grants`, {
      method: 'POST',
      body: { userId: addDmUser.value.id, dmRole: addDmRole.value },
    })
    resetAddDmGrantForm()
    await loadDmGrants()
  } catch (e: any) {
    dmGrantError.value = e?.data?.message || e?.message || 'Failed to grant access'
  } finally {
    dmGrantSaving.value = false
  }
}

async function updateDmGrant(g: DmGrantView, dmRole: string) {
  dmGrantSaving.value = true
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/grants/${g.id}`, {
      method: 'PUT',
      body: { dmRole: dmRole === 'none' ? null : dmRole },
    })
    await loadDmGrants()
  } catch (e) {
    console.error('Failed to update DM grant:', e)
  } finally {
    dmGrantSaving.value = false
  }
}

async function removeDmGrant(g: DmGrantView) {
  if (!confirm(`Remove ${g.username}'s DM access?`)) return
  dmGrantSaving.value = true
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/grants/${g.id}`, { method: 'DELETE' })
    await loadDmGrants()
  } finally {
    dmGrantSaving.value = false
  }
}

// === Character Access (per-tamer grants + public-access flag) ===

interface TamerGrantView {
  id: string
  tamerId: string
  tamerName: string
  userId: string
  username: string
}

const tamerGrants = ref<TamerGrantView[]>([])
const tamerGrantsLoading = ref(false)
const tamerGrantSaving = ref<string | null>(null) // tamerId currently being mutated, for per-row spinners

const grantsByTamer = computed(() => {
  const map = new Map<string, TamerGrantView[]>()
  for (const g of tamerGrants.value) {
    if (!map.has(g.tamerId)) map.set(g.tamerId, [])
    map.get(g.tamerId)!.push(g)
  }
  return map
})

const openAddTamerGrant = ref<string | null>(null) // tamerId whose add-account form is expanded
const addTamerUser = ref<{ id: string; username: string } | null>(null)
const tamerGrantError = ref('')

async function loadTamerGrants() {
  if (!campaign.value?.ownerId) return
  tamerGrantsLoading.value = true
  try {
    const result = await $fetch<{ grants: TamerGrantView[] }>(`/api/campaigns/${campaignId.value}/tamer-grants`)
    tamerGrants.value = result.grants
  } catch (e) {
    console.error('Failed to load character access grants:', e)
  } finally {
    tamerGrantsLoading.value = false
  }
}

function openAddTamerGrantForm(tamerId: string) {
  openAddTamerGrant.value = tamerId
  addTamerUser.value = null
  tamerGrantError.value = ''
}

function closeAddTamerGrantForm() {
  openAddTamerGrant.value = null
  addTamerUser.value = null
  tamerGrantError.value = ''
}

async function submitAddTamerGrant(tamerId: string) {
  if (!addTamerUser.value) return
  tamerGrantSaving.value = tamerId
  tamerGrantError.value = ''
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/tamer-grants`, {
      method: 'POST',
      body: { tamerId, userId: addTamerUser.value.id },
    })
    closeAddTamerGrantForm()
    await loadTamerGrants()
  } catch (e: any) {
    tamerGrantError.value = e?.data?.message || e?.message || 'Failed to grant access'
  } finally {
    tamerGrantSaving.value = null
  }
}

async function removeTamerGrant(g: TamerGrantView) {
  if (!confirm(`Remove ${g.username}'s access to ${g.tamerName}?`)) return
  tamerGrantSaving.value = g.tamerId
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/tamer-grants/${g.id}`, { method: 'DELETE' })
    await loadTamerGrants()
  } finally {
    tamerGrantSaving.value = null
  }
}

async function toggleTamerPublicAccess(tamer: { id: string; publicAccess?: boolean }, value: boolean) {
  tamerGrantSaving.value = tamer.id
  try {
    await $fetch(`/api/campaigns/${campaignId.value}/tamers/${tamer.id}/public-access`, {
      method: 'PUT',
      body: { publicAccess: value },
    })
    tamer.publicAccess = value
  } catch (e) {
    console.error('Failed to update public access:', e)
  } finally {
    tamerGrantSaving.value = null
  }
}

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

const showDeleteModal = ref(false)
const deleteConfirmText = ref('')
const deleteDmPassword = ref('')
const deleteError = ref('')
const deleting = ref(false)

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
  houseRules: {
    stunMaxDuration1: false,
    maxTempWoundsRule: false,
    signatureMoveBattery: false,
    newDayHealsAllWounds: false,
    allowDuplicateStatValues: false,
    allowFlexCPSplits: false,
    giganticMaxSize: { x: null as number | null, y: null as number | null, z: null as number | null },
    skillOrders: false,
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
    agilityRank2RequiresUltimate: false,
    combatMonsterAreaAttackRequiresComplex: false,
    chromeWeaponNoWeaponRankRequired: false,
    digizoidArmourRequiresInstinct: false,
    buffingContested: false,
    digivolutionLimit5PerDay: false,
    warpEvolution: false,
    bonusDPMinPerCategory: false,
    enemyDoubleWounds: false,
    modeChangeFreeSwapsPerCombat: false,
    directRangeOverrides: { direct: null as number | null, bolsterDirect: null as number | null, digivolve: null as number | null },
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

    // Load house rules
    const houseRules = campaign.value.rulesSettings?.houseRules
    if (houseRules) {
      form.houseRules.stunMaxDuration1 = houseRules.stunMaxDuration1 ?? false
      form.houseRules.maxTempWoundsRule = houseRules.maxTempWoundsRule ?? false
      form.houseRules.signatureMoveBattery = houseRules.signatureMoveBattery ?? false
      form.houseRules.newDayHealsAllWounds = houseRules.newDayHealsAllWounds ?? false
      form.houseRules.allowDuplicateStatValues = houseRules.allowDuplicateStatValues ?? false
      form.houseRules.allowFlexCPSplits = houseRules.allowFlexCPSplits ?? false
      const gms = houseRules.giganticMaxSize as any
      form.houseRules.giganticMaxSize = { x: gms?.x ?? null, y: gms?.y ?? null, z: gms?.z ?? null }
      form.houseRules.skillOrders = houseRules.skillOrders ?? false
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
      form.eddySoulRules.agilityRank2RequiresUltimate = eddySoul.agilityRank2RequiresUltimate ?? false
      form.eddySoulRules.combatMonsterAreaAttackRequiresComplex = eddySoul.combatMonsterAreaAttackRequiresComplex ?? false
      form.eddySoulRules.chromeWeaponNoWeaponRankRequired = eddySoul.chromeWeaponNoWeaponRankRequired ?? false
      form.eddySoulRules.digizoidArmourRequiresInstinct = eddySoul.digizoidArmourRequiresInstinct ?? false
      form.eddySoulRules.buffingContested = eddySoul.buffingContested ?? false
      form.eddySoulRules.digivolutionLimit5PerDay = eddySoul.digivolutionLimit5PerDay ?? false
      form.eddySoulRules.warpEvolution = eddySoul.warpEvolution ?? false
      form.eddySoulRules.bonusDPMinPerCategory = eddySoul.bonusDPMinPerCategory ?? false
      form.eddySoulRules.enemyDoubleWounds = eddySoul.enemyDoubleWounds ?? false
      form.eddySoulRules.modeChangeFreeSwapsPerCombat = eddySoul.modeChangeFreeSwapsPerCombat ?? false
      form.eddySoulRules.directRangeOverrides = {
        direct: eddySoul.directRangeOverrides?.direct ?? null,
        bolsterDirect: eddySoul.directRangeOverrides?.bolsterDirect ?? null,
        digivolve: eddySoul.directRangeOverrides?.digivolve ?? null,
      }
    }

  }

  if (campaign.value?.ownerId) {
    await Promise.all([loadDmGrants(), fetchTamers(campaignId.value), loadTamerGrants()])
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
    ...((form.houseRules.stunMaxDuration1 || form.houseRules.maxTempWoundsRule || form.houseRules.signatureMoveBattery || form.houseRules.newDayHealsAllWounds || form.houseRules.allowDuplicateStatValues || form.houseRules.allowFlexCPSplits || form.houseRules.giganticMaxSize.x || form.houseRules.giganticMaxSize.y || form.houseRules.giganticMaxSize.z || form.houseRules.skillOrders) && {
      houseRules: {
        ...(form.houseRules.stunMaxDuration1 && { stunMaxDuration1: true }),
        ...(form.houseRules.maxTempWoundsRule && { maxTempWoundsRule: true }),
        ...(form.houseRules.signatureMoveBattery && { signatureMoveBattery: true }),
        ...(form.houseRules.newDayHealsAllWounds && { newDayHealsAllWounds: true }),
        ...(form.houseRules.allowDuplicateStatValues && { allowDuplicateStatValues: true }),
        ...(form.houseRules.allowFlexCPSplits && { allowFlexCPSplits: true }),
        ...((form.houseRules.giganticMaxSize.x || form.houseRules.giganticMaxSize.y || form.houseRules.giganticMaxSize.z) && {
          giganticMaxSize: {
            x: form.houseRules.giganticMaxSize.x ?? undefined,
            y: form.houseRules.giganticMaxSize.y ?? undefined,
            z: form.houseRules.giganticMaxSize.z ?? undefined,
          },
        }),
        ...(form.houseRules.skillOrders && { skillOrders: true }),
      },
    }),
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
    ...((form.eddySoulRules.accuracyIsAgilityAthletics || form.eddySoulRules.damageIsBodyFeatsOfStrength || form.eddySoulRules.armorIsWillpowerEndurance || form.eddySoulRules.baseStatRangesEnabled || form.eddySoulRules.chargeAttackCosts3DP || form.eddySoulRules.instinctBoostsDodgeArmorSpeed || form.eddySoulRules.hugeSizeRequiresMega || form.eddySoulRules.hugePowerOncePerTurn || form.eddySoulRules.agilityRank2RequiresUltimate || form.eddySoulRules.combatMonsterAreaAttackRequiresComplex || form.eddySoulRules.chromeWeaponNoWeaponRankRequired || form.eddySoulRules.digizoidArmourRequiresInstinct || form.eddySoulRules.buffingContested || form.eddySoulRules.digivolutionLimit5PerDay || form.eddySoulRules.warpEvolution || form.eddySoulRules.bonusDPMinPerCategory || form.eddySoulRules.enemyDoubleWounds || form.eddySoulRules.directRangeOverrides.direct || form.eddySoulRules.directRangeOverrides.bolsterDirect || form.eddySoulRules.directRangeOverrides.digivolve) && {
      eddySoulRules: {
        ...(form.eddySoulRules.accuracyIsAgilityAthletics && { accuracyIsAgilityAthletics: true }),
        ...(form.eddySoulRules.damageIsBodyFeatsOfStrength && { damageIsBodyFeatsOfStrength: true }),
        ...(form.eddySoulRules.armorIsWillpowerEndurance && { armorIsWillpowerEndurance: true }),
        ...(form.eddySoulRules.baseStatRangesEnabled && { baseStatRangesEnabled: true }),
        ...(form.eddySoulRules.chargeAttackCosts3DP && { chargeAttackCosts3DP: true }),
        ...(form.eddySoulRules.instinctBoostsDodgeArmorSpeed && { instinctBoostsDodgeArmorSpeed: true }),
        ...(form.eddySoulRules.hugeSizeRequiresMega && { hugeSizeRequiresMega: true }),
        ...(form.eddySoulRules.hugePowerOncePerTurn && { hugePowerOncePerTurn: true }),
        ...(form.eddySoulRules.agilityRank2RequiresUltimate && { agilityRank2RequiresUltimate: true }),
        ...(form.eddySoulRules.combatMonsterAreaAttackRequiresComplex && { combatMonsterAreaAttackRequiresComplex: true }),
        ...(form.eddySoulRules.chromeWeaponNoWeaponRankRequired && { chromeWeaponNoWeaponRankRequired: true }),
        ...(form.eddySoulRules.digizoidArmourRequiresInstinct && { digizoidArmourRequiresInstinct: true }),
        ...(form.eddySoulRules.buffingContested && { buffingContested: true }),
        ...(form.eddySoulRules.digivolutionLimit5PerDay && { digivolutionLimit5PerDay: true }),
        ...(form.eddySoulRules.warpEvolution && { warpEvolution: true }),
        ...(form.eddySoulRules.bonusDPMinPerCategory && { bonusDPMinPerCategory: true }),
        ...(form.eddySoulRules.enemyDoubleWounds && { enemyDoubleWounds: true }),
        ...(form.eddySoulRules.modeChangeFreeSwapsPerCombat && { modeChangeFreeSwapsPerCombat: true }),
        ...((form.eddySoulRules.directRangeOverrides.direct || form.eddySoulRules.directRangeOverrides.bolsterDirect || form.eddySoulRules.directRangeOverrides.digivolve) && {
          directRangeOverrides: {
            ...(form.eddySoulRules.directRangeOverrides.direct && { direct: form.eddySoulRules.directRangeOverrides.direct }),
            ...(form.eddySoulRules.directRangeOverrides.bolsterDirect && { bolsterDirect: form.eddySoulRules.directRangeOverrides.bolsterDirect }),
            ...(form.eddySoulRules.directRangeOverrides.digivolve && { digivolve: form.eddySoulRules.directRangeOverrides.digivolve }),
          },
        }),
      },
    }),
  }

  await updateCampaign(campaignId.value, data)
  await loadCampaign(true)
  saving.value = false
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

function openDeleteModal() {
  deleteConfirmText.value = ''
  deleteDmPassword.value = ''
  deleteError.value = ''
  showDeleteModal.value = true
}

async function handleDelete() {
  deleteError.value = ''
  deleting.value = true

  try {
    // Verify DM password if campaign has one
    if (campaign.value?.hasDmPassword) {
      const isValid = await verifyDmPassword(campaignId.value, deleteDmPassword.value)
      if (!isValid) {
        deleteError.value = 'Invalid DM password'
        deleting.value = false
        return
      }
    }

    // Check confirmation text
    if (deleteConfirmText.value !== 'DELETE') {
      deleteError.value = 'Please type "DELETE" to confirm'
      deleting.value = false
      return
    }

    // Delete the campaign
    await deleteCampaign(campaignId.value)
    navigateTo('/')
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : 'Failed to delete campaign'
    deleting.value = false
  }
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

    <!-- Account Access -->
    <div v-if="!loading" class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700 mb-6">
      <h3 class="font-semibold text-white mb-2">Account Access</h3>

      <div v-if="!campaign?.ownerId" class="text-sm text-digimon-dark-400">
        This campaign has no owner account — only a campaign's creator, while logged in, can enable account-based
        access. Password-based access is unaffected.
      </div>

      <div v-else class="space-y-8">
        <p class="text-sm text-digimon-dark-400">
          Owner: <span class="text-white">{{ ownerUsername ?? '—' }}</span>
        </p>

        <!-- DM Access -->
        <div class="space-y-4">
          <h4 class="text-sm font-semibold text-digimon-dark-200 uppercase tracking-wide">DM Access</h4>

          <div v-if="dmGrantsLoading" class="text-sm text-digimon-dark-500">Loading DM access grants...</div>

          <div v-else class="space-y-2">
            <div v-if="dmGrants.length === 0" class="text-sm text-digimon-dark-500">No accounts granted DM access yet.</div>
            <div
              v-for="g in dmGrants"
              :key="g.id"
              class="flex flex-wrap items-center gap-3 bg-digimon-dark-900 border border-digimon-dark-700 rounded-lg p-3"
            >
              <span class="text-white font-medium min-w-[120px]">{{ g.username }}</span>

              <select
                :value="dmRoleValue(g)"
                class="bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1 text-sm text-white"
                @change="updateDmGrant(g, ($event.target as HTMLSelectElement).value)"
              >
                <option value="none">No DM access</option>
                <option value="co-dm">Co-DM (all GM tools, no Settings)</option>
                <option value="co-owner">Co-Owner (full access)</option>
              </select>

              <button type="button" class="ml-auto text-red-400 hover:text-red-300 text-sm" @click="removeDmGrant(g)">
                Remove
              </button>
            </div>
          </div>

          <div v-if="!showAddDmGrant">
            <button
              type="button"
              class="text-sm text-digimon-orange-400 hover:text-digimon-orange-300"
              @click="showAddDmGrant = true"
            >
              + Add Account
            </button>
          </div>

          <div v-else class="bg-digimon-dark-900 border border-digimon-dark-700 rounded-lg p-4 space-y-3">
            <AccountSearchInput v-model="addDmUser" />

            <div v-if="addDmUser">
              <label class="block text-xs text-digimon-dark-400 mb-1">DM Role</label>
              <select
                v-model="addDmRole"
                class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="co-dm">Co-DM (all GM tools, no Settings)</option>
                <option value="co-owner">Co-Owner (full access)</option>
              </select>
            </div>

            <p v-if="dmGrantError" class="text-sm text-red-400">{{ dmGrantError }}</p>

            <div class="flex gap-2">
              <button
                type="button"
                :disabled="!addDmUser || dmGrantSaving"
                class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium"
                @click="submitAddDmGrant"
              >
                {{ dmGrantSaving ? 'Saving...' : 'Grant Access' }}
              </button>
              <button type="button" class="text-digimon-dark-400 hover:text-white text-sm" @click="resetAddDmGrantForm">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <!-- Character Access -->
        <div class="space-y-4 pt-6 border-t border-digimon-dark-700">
          <div>
            <h4 class="text-sm font-semibold text-digimon-dark-200 uppercase tracking-wide">Character Access</h4>
            <p class="text-xs text-digimon-dark-500 mt-1">
              A public tamer is open to anyone with campaign access, including players with no account. Otherwise
              only DM-tier accounts and accounts granted below can view/edit it.
            </p>
          </div>

          <div v-if="tamerGrantsLoading" class="text-sm text-digimon-dark-500">Loading character access...</div>

          <div v-else-if="campaignTamers.length === 0" class="text-sm text-digimon-dark-500">
            No tamers in this campaign yet.
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="t in campaignTamers"
              :key="t.id"
              class="bg-digimon-dark-900 border border-digimon-dark-700 rounded-lg p-3 space-y-3"
            >
              <div class="flex flex-wrap items-center gap-3">
                <span class="text-white font-medium">{{ t.name }}</span>
                <label class="flex items-center gap-2 text-sm text-digimon-dark-400 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="t.publicAccess"
                    :disabled="tamerGrantSaving === t.id"
                    class="rounded"
                    @change="toggleTamerPublicAccess(t, ($event.target as HTMLInputElement).checked)"
                  />
                  Public access
                </label>
              </div>

              <div v-if="(grantsByTamer.get(t.id) ?? []).length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="g in grantsByTamer.get(t.id)"
                  :key="g.id"
                  class="flex items-center gap-2 bg-digimon-dark-800 border border-digimon-dark-700 rounded px-2 py-1 text-sm text-white"
                >
                  {{ g.username }}
                  <button type="button" class="text-red-400 hover:text-red-300 text-xs" @click="removeTamerGrant(g)">✕</button>
                </span>
              </div>
              <p v-else class="text-xs text-digimon-dark-500">No accounts individually granted access.</p>

              <div v-if="openAddTamerGrant !== t.id">
                <button
                  type="button"
                  class="text-xs text-digimon-orange-400 hover:text-digimon-orange-300"
                  @click="openAddTamerGrantForm(t.id)"
                >
                  + Add account
                </button>
              </div>
              <div v-else class="bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-3 space-y-2">
                <AccountSearchInput v-model="addTamerUser" />
                <p v-if="tamerGrantError" class="text-sm text-red-400">{{ tamerGrantError }}</p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    :disabled="!addTamerUser || tamerGrantSaving === t.id"
                    class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium"
                    @click="submitAddTamerGrant(t.id)"
                  >
                    {{ tamerGrantSaving === t.id ? 'Saving...' : 'Grant Access' }}
                  </button>
                  <button type="button" class="text-digimon-dark-400 hover:text-white text-xs" @click="closeAddTamerGrantForm">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <form v-if="!loading" class="space-y-6" @submit.prevent="handleSave">
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

      <!-- House Rules -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h3 class="font-semibold text-white mb-4">House Rules</h3>
        <div class="space-y-3">
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.skillOrders"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Skill Orders</span>
              <p class="text-xs text-digimon-dark-500">Unlocks a Skill Option per skill. Each requires the skill at {{ form.level === 'extreme' ? 6 : form.level === 'enhanced' ? 5 : 4 }}+ and the first Special Order of its governing attribute. Show unlocked options on tamer sheets and offer active ones in combat.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.stunMaxDuration1"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Stun duration max 1 round</span>
              <p class="text-xs text-digimon-dark-500">Default: Stun duration equals leftover accuracy successes</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.maxTempWoundsRule"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Shield keeps higher temp wound value</span>
              <p class="text-xs text-digimon-dark-500">Default: Shield always overrides temp wounds with new potency value</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.signatureMoveBattery"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Signature Move Battery Rule</span>
              <p class="text-xs text-digimon-dark-500">Replaces round cooldown with Battery resource. Stage 2+ only. Gain 1 Battery/turn (cap = Stage); spend all on use for +Battery to Accuracy/Damage or SPEC. 0 DP cost.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.newDayHealsAllWounds"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">New Day Heals All Wounds</span>
              <p class="text-xs text-digimon-dark-500">Triggering a New Day also fully heals all tamers and digimon in the campaign.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.allowDuplicateStatValues"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Allow Duplicate Stat Max Values</span>
              <p class="text-xs text-digimon-dark-500">Tamers can have multiple Attributes or Skills tied at the same highest value during creation and editing.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.houseRules.allowFlexCPSplits"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Flexible CP Splits</span>
              <p class="text-xs text-digimon-dark-500">Tamers can distribute all CP freely across Attributes and Skills without enforced pool splits. (Standard: 30 total, Enhanced: 40, Extreme: 50)</p>
            </div>
          </label>
          <!-- Gigantic Max Size -->
          <div class="flex items-center gap-3 pt-2 border-t border-digimon-dark-700 mt-2">
            <div class="flex-1">
              <span class="text-digimon-dark-300 text-sm">Gigantic Max Dimensions</span>
              <p class="text-xs text-digimon-dark-500">Per-axis cap on Gigantic Digimon size (spaces). Leave an axis empty for no limit on that axis.</p>
            </div>
            <div class="flex gap-2">
              <div v-for="axis in (['x', 'y', 'z'] as const)" :key="axis" class="flex flex-col items-center gap-1">
                <label class="text-xs text-digimon-dark-500 uppercase font-semibold">{{ axis }}</label>
                <input
                  v-model.number="form.houseRules.giganticMaxSize[axis]"
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
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.agilityRank2RequiresUltimate"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Agility Rank 2 requires Ultimate+</span>
              <p class="text-xs text-digimon-dark-500">Default: Rank 2 available at any stage</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.combatMonsterAreaAttackRequiresComplex"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Combat Monster + Area Attack requires a Complex Action</span>
              <p class="text-xs text-digimon-dark-500">Default: Area attacks always cost 1 Simple Action. With rule: costs 2 (Complex) if Combat Monster bonus is non-zero</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.chromeWeaponNoWeaponRankRequired"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Chrome Weapon available without Weapon Rank 1</span>
              <p class="text-xs text-digimon-dark-500">Allows Chrome Digizoid Weaponry to be taken without Weapon Rank 1. Without Weapon ranks, bonus applies to one designated attack only.</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.digizoidArmourRequiresInstinct"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Non-Chrome Digizoid Armour requires Instinct Rank 1</span>
              <p class="text-xs text-digimon-dark-500">All non-Chrome Digizoid Armour choices require Instinct Rank 1. Chrome remains freely available.</p>
            </div>
          </label>

          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.buffingContested"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Buffing effects contested by health roll</span>
              <p class="text-xs text-digimon-dark-500">Default: buff duration uses health-first formula. With this rule: Duration = Accuracy successes − target Health successes, min 1. Applies to Vigor, Fury, Strengthen, Vigilance, Swiftness, Regenerate, and AOE versions of Shield/Haste/Revitalize.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.digivolutionLimit5PerDay"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Digivolution Limit (5/day)</span>
              <p class="text-xs text-digimon-dark-500">Tamers may only digivolve their partner 5 times per day. Count resets on New Day. DMs can manually adjust a tamer's count on the tamer page.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              v-model="form.eddySoulRules.warpEvolution"
              type="checkbox"
              class="w-4 h-4 rounded mt-1 shrink-0"
            />
            <div>
              <span class="text-digimon-dark-300">Warp Evolution</span>
              <p class="text-xs text-digimon-dark-500">Allows skipping a stage when digivolving. Each extra stage requires +5 to the Willpower DC (e.g. In-Training → Champion at standard DC+5). If used with the digivolution limit, warp counts as only 1 toward the daily limit.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="form.eddySoulRules.bonusDPMinPerCategory" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Bonus DP Minimum Per Category</span>
              <p class="text-xs text-digimon-dark-500">A minimum of 10% of total Bonus DP (rounded down) must be spent in each stat and on qualities. 40% remains free to allocate.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="form.eddySoulRules.enemyDoubleWounds" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Enemy Digimon Double Wounds</span>
              <p class="text-xs text-digimon-dark-500">Enemy digimon added to encounters have twice their normal wound boxes. Applies at the moment they join — existing participants are unaffected.</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input v-model="form.eddySoulRules.modeChangeFreeSwapsPerCombat" type="checkbox" class="w-4 h-4 rounded mt-1 shrink-0" />
            <div>
              <span class="text-digimon-dark-300">Mode Change X.0 Rank 2: 3 Free Swaps Per Combat</span>
              <p class="text-xs text-digimon-dark-500">Default: every Mode Change use costs 1 Simple Action. With this rule, digimon with Mode Change X.0 Rank 2 get their first 3 swaps each combat for free (no action cost).</p>
            </div>
          </label>
          <!-- Direct / Bolster Direct / Digivolve Range Overrides -->
          <div class="flex items-center gap-3 pt-2 border-t border-digimon-dark-700 mt-2">
            <div class="flex-1">
              <span class="text-digimon-dark-300 text-sm">Direct / Digivolve Range Overrides</span>
              <p class="text-xs text-digimon-dark-500">Map-view range (in spaces) a tamer must be within to Direct, Bolster Direct, or Digivolve a partner digimon. Leave empty for defaults (Direct: 15, Bolster Direct: 10, Digivolve: 15).</p>
            </div>
            <div class="flex gap-2">
              <div class="flex flex-col items-center gap-1">
                <label class="text-xs text-digimon-dark-500 uppercase font-semibold">Direct</label>
                <input
                  v-model.number="form.eddySoulRules.directRangeOverrides.direct"
                  type="number"
                  min="1"
                  placeholder="15"
                  class="w-16 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1 text-white text-sm text-center"
                />
              </div>
              <div class="flex flex-col items-center gap-1">
                <label class="text-xs text-digimon-dark-500 uppercase font-semibold">Bolster</label>
                <input
                  v-model.number="form.eddySoulRules.directRangeOverrides.bolsterDirect"
                  type="number"
                  min="1"
                  placeholder="10"
                  class="w-16 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1 text-white text-sm text-center"
                />
              </div>
              <div class="flex flex-col items-center gap-1">
                <label class="text-xs text-digimon-dark-500 uppercase font-semibold">Digivolve</label>
                <input
                  v-model.number="form.eddySoulRules.directRangeOverrides.digivolve"
                  type="number"
                  min="1"
                  placeholder="15"
                  class="w-16 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1 text-white text-sm text-center"
                />
              </div>
            </div>
          </div>
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

    <!-- Danger Zone -->
    <div v-if="!loading" class="mt-12 pt-8 border-t border-digimon-dark-700">
      <div class="bg-red-900/20 border border-red-900/50 rounded-xl p-6">
        <h3 class="font-semibold text-red-400 mb-2">Danger Zone</h3>
        <p class="text-sm text-digimon-dark-300 mb-4">
          Permanently delete this campaign and all associated data. This action cannot be undone.
        </p>
        <button
          type="button"
          @click="openDeleteModal"
          class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Delete Campaign
        </button>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Modal -->
  <Teleport to="body">
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showDeleteModal = false"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-8 border border-digimon-dark-700 max-w-md w-full mx-4">
        <h2 class="text-xl font-bold text-white mb-4">Delete Campaign?</h2>
        <p class="text-digimon-dark-300 mb-6">
          This will permanently delete the campaign and all associated tamers, digimon, evolution lines, and encounters.
        </p>

        <!-- DM Password Field (if campaign has one) -->
        <div v-if="campaign?.hasDmPassword" class="mb-6">
          <label class="block text-sm font-medium text-digimon-dark-300 mb-2">DM Password</label>
          <input
            v-model="deleteDmPassword"
            type="password"
            placeholder="Enter DM password"
            :disabled="deleting"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none disabled:opacity-50"
          />
        </div>

        <!-- Confirmation Text Field -->
        <div class="mb-6">
          <label class="block text-sm font-medium text-digimon-dark-300 mb-2">
            Type "DELETE" to confirm
          </label>
          <input
            v-model="deleteConfirmText"
            type="text"
            placeholder="DELETE"
            :disabled="deleting"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none disabled:opacity-50"
          />
        </div>

        <!-- Error Message -->
        <div v-if="deleteError" class="mb-6 p-3 bg-red-900/30 border border-red-900/50 rounded-lg">
          <p class="text-red-400 text-sm">{{ deleteError }}</p>
        </div>

        <!-- Buttons -->
        <div class="flex items-center gap-3">
          <button
            type="button"
            @click="showDeleteModal = false"
            :disabled="deleting"
            class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50
                   text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="handleDelete"
            :disabled="deleteConfirmText !== 'DELETE' || deleting"
            class="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50
                   text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {{ deleting ? 'Deleting...' : 'Delete Campaign' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
