<script setup lang="ts">
import { ATTACK_DATABASE, getAttacksForStage, type AttackTemplate } from '../data/attacks'
import type { DigimonStage } from '../types'

// DDA 1.4 Attack structure
interface Attack {
  id: string
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect?: string
  description: string
}

interface Quality {
  id: string
  name: string
  ranks?: number
  choiceId?: string
}

interface BaseStats {
  accuracy: number
  damage: number
  dodge: number
  armor: number
  health: number
}

interface Props {
  stage: DigimonStage
  maxAttacks: number
  currentAttacks: Attack[]
  currentQualities?: Quality[]
  baseStats?: BaseStats
  bonusStats?: BaseStats
  dataOptimization?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'add', attack: Attack): void
  (e: 'remove', index: number): void
  (e: 'edit', index: number): void
}>()

const showSelector = ref(false)
const searchQuery = ref('')
const filterStage = ref<'all' | DigimonStage>('all')

// Map tag prefixes to quality IDs
const TAG_TO_QUALITY: Record<string, string> = {
  'Weapon': 'weapon',
  'Armor Piercing': 'armor-piercing',
  'Certain Strike': 'certain-strike',
  'Charge Attack': 'charge-attack',
  'Mighty Blow': 'mighty-blow',
  'Signature Move': 'signature-move',
  'Ammo': 'ammo',
  'Area Attack': 'area-attack',
}

// Get tags already used by existing attacks
const usedTags = computed(() => {
  const used = new Set<string>()
  for (const attack of props.currentAttacks) {
    for (const tag of attack.tags) {
      // Normalize to quality ID
      const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '').split('-')[0]
      // Find matching quality
      for (const [prefix, qualityId] of Object.entries(TAG_TO_QUALITY)) {
        if (tag.startsWith(prefix)) {
          used.add(qualityId)
          break
        }
      }
    }
  }
  return used
})

// Get effects already used by existing attacks
const usedEffects = computed(() => {
  const used = new Set<string>()
  for (const attack of props.currentAttacks) {
    if (attack.effect) {
      used.add(attack.effect.toLowerCase())
    }
  }
  return used
})

// Check if a tag's required quality is owned
function hasQualityForTag(tag: string): { has: boolean; qualityId: string | null; requiredRanks?: number } {
  for (const [prefix, qualityId] of Object.entries(TAG_TO_QUALITY)) {
    if (tag.startsWith(prefix)) {
      // Extract rank if present (e.g., "Weapon III" -> 3)
      const rankMatch = tag.match(/\s+([IVX]+|\d+)$/)
      let requiredRanks = 1
      if (rankMatch) {
        const rankStr = rankMatch[1]
        // Convert Roman numerals
        const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10, 'XI': 11, 'XII': 12 }
        requiredRanks = romanMap[rankStr] || parseInt(rankStr) || 1
      }

      const quality = props.currentQualities?.find(q => q.id === qualityId)
      if (quality) {
        const hasEnoughRanks = !requiredRanks || (quality.ranks || 1) >= requiredRanks
        return { has: hasEnoughRanks, qualityId, requiredRanks: hasEnoughRanks ? undefined : requiredRanks }
      }
      return { has: false, qualityId, requiredRanks }
    }
  }
  // No quality required for this tag
  return { has: true, qualityId: null }
}

// Check if effect's required quality is owned
function hasQualityForEffect(effect: string): boolean {
  const effectQualityId = `effect-${effect.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-')}`
  return props.currentQualities?.some(q => q.id === effectQualityId) ?? false
}

// Check attack requirements and return status
function getAttackStatus(attack: AttackTemplate): { canSelect: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Check each tag
  for (const tag of attack.tags) {
    const { has, qualityId, requiredRanks } = hasQualityForTag(tag)
    if (!has && qualityId) {
      if (requiredRanks) {
        reasons.push(`Needs ${tag} quality (rank ${requiredRanks})`)
      } else {
        reasons.push(`Needs ${qualityId.replace(/-/g, ' ')} quality`)
      }
    }
    // Check if quality already used on another attack
    if (qualityId && usedTags.value.has(qualityId)) {
      reasons.push(`${qualityId.replace(/-/g, ' ')} already used on another attack`)
    }
  }

  // Check effect
  if (attack.effect) {
    if (!hasQualityForEffect(attack.effect)) {
      reasons.push(`Needs ${attack.effect} effect quality`)
    }
    if (usedEffects.value.has(attack.effect.toLowerCase())) {
      reasons.push(`${attack.effect} effect already used on another attack`)
    }
  }

  return { canSelect: reasons.length === 0, reasons }
}

const availableAttacks = computed(() => {
  let attacks: AttackTemplate[]

  if (filterStage.value === 'all') {
    attacks = getAttacksForStage(props.stage)
  } else {
    attacks = ATTACK_DATABASE.filter((a) => a.stage === filterStage.value || a.stage === 'any')
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    attacks = attacks.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.tags.some((t) => t.toLowerCase().includes(query))
    )
  }

  // Exclude already added attacks
  const currentIds = props.currentAttacks.map((a) => a.id)
  attacks = attacks.filter((a) => !currentIds.includes(a.id))

  // Add status to each attack
  return attacks.map(attack => ({
    ...attack,
    ...getAttackStatus(attack)
  }))
})

function selectAttack(template: AttackTemplate & { canSelect: boolean }) {
  if (!template.canSelect) return

  const attack: Attack = {
    id: template.id,
    name: template.name,
    range: template.range,
    type: template.type,
    tags: [...template.tags],
    effect: template.effect,
    description: template.description,
  }
  emit('add', attack)

  if (props.currentAttacks.length + 1 >= props.maxAttacks) {
    showSelector.value = false
  }
}

function getRangeColor(range: 'melee' | 'ranged') {
  return range === 'melee' ? 'bg-red-900/30 text-red-400' : 'bg-blue-900/30 text-blue-400'
}

function getTypeColor(type: 'damage' | 'support') {
  return type === 'damage' ? 'bg-orange-900/30 text-orange-400' : 'bg-green-900/30 text-green-400'
}

// Calculate attack stats based on base stats, bonus stats, data optimization, qualities, and tags
function getAttackStats(attack: Attack) {
  const baseAccuracy = (props.baseStats?.accuracy ?? 0) + (props.bonusStats?.accuracy ?? 0)
  const baseDamage = (props.baseStats?.damage ?? 0) + (props.bonusStats?.damage ?? 0)

  let damageBonus = 0
  let accuracyBonus = 0
  let notes: string[] = []

  // Helper to check if Digimon has a quality and get its ranks
  const hasQuality = (id: string) => props.currentQualities?.some(q => q.id === id)
  const getQualityRanks = (id: string) => props.currentQualities?.find(q => q.id === id)?.ranks ?? 1

  // Check if attack has a specific tag
  const hasTag = (pattern: string) => attack.tags.some(t => t.toLowerCase().includes(pattern.toLowerCase()))
  const hasWeaponTag = attack.tags.some(t => /^Weapon\s+/i.test(t))
  const hasSignatureTag = attack.tags.some(t => t.toLowerCase().includes('signature'))

  // === GLOBAL QUALITY BONUSES (apply to all attacks) ===

  // True Guardian: -2 Accuracy (global penalty)
  if (hasQuality('true-guardian')) {
    accuracyBonus -= 2
  }

  // Huge Power: Reroll 1s on Accuracy
  if (hasQuality('huge-power')) {
    if (attack.range === 'melee') {
      notes.push('Reroll 1s')
    } else {
      notes.push('Reroll 1s (1/round)')
    }
  }

  // Overkill: Reroll 2s on Accuracy (once per round)
  if (hasQuality('overkill')) {
    notes.push('Reroll 2s (1/round)')
  }

  // Aggressive Flank: +RAM to Accuracy when near allies
  if (hasQuality('aggressive-flank')) {
    notes.push('+RAM ACC (near ally)')
  }

  // === DATA OPTIMIZATION BONUSES ===
  // Check both the prop (legacy) and the quality's choiceId
  const dataOptQuality = props.currentQualities?.find(q => q.id === 'data-optimization')
  const dataOpt = dataOptQuality?.choiceId || props.dataOptimization

  if (dataOpt === 'close-combat') {
    if (attack.range === 'melee') {
      accuracyBonus += 2
    } else if (attack.range === 'ranged') {
      accuracyBonus -= 1
    }
  } else if (dataOpt === 'ranged-striker') {
    if (attack.range === 'ranged') {
      accuracyBonus += 2
    }
  }

  // === DATA SPECIALIZATION BONUSES ===

  // Mobile Artillery: Add CPU to [Area] attack damage
  if (hasQuality('mobile-artillery') && hasTag('area')) {
    notes.push('+CPU DMG (Area)')
  }

  // Hit and Run: [Charge] attacks add RAM to Damage
  if (hasQuality('hit-and-run') && hasTag('charge')) {
    notes.push('+RAM DMG (Charge)')
  }

  // === WEAPON-TAGGED ATTACK BONUSES ===
  if (hasWeaponTag) {
    // Digizoid Weapon: Chrome - +2 ACC, +1 DMG
    if (hasQuality('digizoid-weapon-chrome')) {
      accuracyBonus += 2
      damageBonus += 1
    }
    // Digizoid Weapon: Black - +2 ACC + random bonus
    if (hasQuality('digizoid-weapon-black')) {
      accuracyBonus += 2
      notes.push('+random (d6)')
    }
    // Digizoid Weapon: Brown - +2 Dodge, +2 DMG
    if (hasQuality('digizoid-weapon-brown')) {
      damageBonus += 2
    }
    // Digizoid Weapon: Blue - +2 ACC, +2 DMG, auto success
    if (hasQuality('digizoid-weapon-blue')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 auto success')
    }
    // Digizoid Weapon: Gold - +4 ACC, +1 DMG
    if (hasQuality('digizoid-weapon-gold')) {
      accuracyBonus += 4
      damageBonus += 1
    }
    // Digizoid Weapon: Obsidian - +2 ACC, +2 DMG, +1 AP
    if (hasQuality('digizoid-weapon-obsidian')) {
      accuracyBonus += 2
      damageBonus += 2
      notes.push('+1 Armor Piercing')
    }
    // Digizoid Weapon: Red - +6 DMG
    if (hasQuality('digizoid-weapon-red')) {
      damageBonus += 6
    }
  }

  // === SIGNATURE MOVE BONUSES ===
  if (hasSignatureTag) {
    // Signature Move: +Attacks to Accuracy and Damage (round 3+)
    notes.push('+Attacks ACC/DMG (R3+)')
  }

  // === TAG-BASED BONUSES ===
  for (const tag of attack.tags) {
    // Weapon I/II/III adds +Rank to Accuracy AND Damage
    const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
    if (weaponMatch) {
      const rankStr = weaponMatch[1]
      const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
      const rank = romanMap[rankStr.toUpperCase()] || parseInt(rankStr) || 1
      damageBonus += rank
      accuracyBonus += rank
    }

    // Certain Strike adds +2 accuracy
    if (tag.startsWith('Certain Strike')) {
      accuracyBonus += 2
    }

    // Note: Tags like Armor Piercing, Charge Attack, Mighty Blow are visible
    // in the tags section below, so we don't duplicate them as notes
  }

  return {
    accuracy: baseAccuracy + accuracyBonus,
    damage: baseDamage + damageBonus,
    damageBonus,
    accuracyBonus,
    notes,
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Current attacks -->
    <div v-if="currentAttacks.length > 0" class="space-y-2">
      <div
        v-for="(attack, index) in currentAttacks"
        :key="attack.id"
        class="bg-digimon-dark-700 rounded-lg p-3 flex justify-between items-start"
      >
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-white">{{ attack.name }}</span>
            <span :class="['text-xs px-2 py-0.5 rounded', getRangeColor(attack.range)]">
              [{{ attack.range === 'melee' ? 'Melee' : 'Ranged' }}]
            </span>
            <span :class="['text-xs px-2 py-0.5 rounded', getTypeColor(attack.type)]">
              [{{ attack.type === 'damage' ? 'Damage' : 'Support' }}]
            </span>
          </div>
          <!-- Accuracy & Damage stats -->
          <div v-if="baseStats" class="flex items-center gap-3 mt-2">
            <span class="text-sm text-yellow-400">
              <span class="text-digimon-dark-400">ACC:</span> {{ getAttackStats(attack).accuracy }}d6
              <span v-if="getAttackStats(attack).accuracyBonus > 0" class="text-green-400">(+{{ getAttackStats(attack).accuracyBonus }})</span>
            </span>
            <span v-if="attack.type === 'damage'" class="text-sm text-red-400">
              <span class="text-digimon-dark-400">DMG:</span> {{ getAttackStats(attack).damage }}
              <span v-if="getAttackStats(attack).damageBonus > 0" class="text-green-400">(+{{ getAttackStats(attack).damageBonus }})</span>
            </span>
            <span v-for="note in getAttackStats(attack).notes" :key="note" class="text-xs text-cyan-400">
              {{ note }}
            </span>
          </div>
          <div v-if="attack.tags.length > 0" class="flex gap-1 mt-2 flex-wrap">
            <span
              v-for="tag in attack.tags"
              :key="tag"
              class="text-xs bg-digimon-dark-600 text-digimon-dark-300 px-2 py-0.5 rounded"
            >
              {{ tag }}
            </span>
          </div>
          <div v-if="attack.effect" class="mt-1">
            <span class="text-xs bg-purple-900/30 text-purple-400 px-2 py-0.5 rounded">
              Effect: {{ attack.effect }}
            </span>
          </div>
          <p v-if="attack.description" class="text-sm text-digimon-dark-400 mt-2 italic">
            {{ attack.description }}
          </p>
        </div>
        <div class="flex gap-2 ml-2">
          <button
            type="button"
            class="text-blue-400 hover:text-blue-300 text-sm"
            @click="emit('edit', index)"
          >
            Edit
          </button>
          <button
            type="button"
            class="text-red-400 hover:text-red-300 text-sm"
            @click="emit('remove', index)"
          >
            Remove
          </button>
        </div>
      </div>
    </div>

    <!-- Add attack button -->
    <div v-if="currentAttacks.length < maxAttacks">
      <button
        v-if="!showSelector"
        type="button"
        class="text-sm text-digimon-orange-400 hover:text-digimon-orange-300 transition-colors"
        @click="showSelector = true"
      >
        + Add Attack from Database
      </button>

      <!-- Attack selector -->
      <div v-else class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
        <div class="flex justify-between items-center mb-4">
          <h4 class="font-semibold text-white">Select Attack</h4>
          <button
            type="button"
            class="text-digimon-dark-400 hover:text-white"
            @click="showSelector = false"
          >
            ✕
          </button>
        </div>

        <!-- Search and filter -->
        <div class="flex gap-2 mb-4">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search attacks..."
            class="flex-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                   text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          />
          <select
            v-model="filterStage"
            class="bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                   text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          >
            <option value="all">Current Stage</option>
            <option value="fresh">Fresh</option>
            <option value="in-training">In-Training</option>
            <option value="rookie">Rookie</option>
            <option value="champion">Champion</option>
            <option value="ultimate">Ultimate</option>
            <option value="mega">Mega</option>
            <option value="ultra">Ultra</option>
          </select>
        </div>

        <!-- Attack list -->
        <div class="max-h-64 overflow-y-auto space-y-2">
          <button
            v-for="attack in availableAttacks"
            :key="attack.id"
            type="button"
            :disabled="!attack.canSelect"
            :class="[
              'w-full text-left rounded-lg p-3 transition-colors relative group',
              attack.canSelect
                ? 'bg-digimon-dark-700 hover:bg-digimon-dark-600'
                : 'bg-digimon-dark-800 opacity-60 cursor-not-allowed'
            ]"
            @click="selectAttack(attack)"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span :class="['font-semibold', attack.canSelect ? 'text-white' : 'text-digimon-dark-400']">
                {{ attack.name }}
              </span>
              <span :class="['text-xs px-2 py-0.5 rounded', getRangeColor(attack.range)]">
                [{{ attack.range === 'melee' ? 'Melee' : 'Ranged' }}]
              </span>
              <span :class="['text-xs px-2 py-0.5 rounded', getTypeColor(attack.type)]">
                [{{ attack.type === 'damage' ? 'Damage' : 'Support' }}]
              </span>
              <span class="text-xs text-digimon-dark-500 capitalize">({{ attack.stage }})</span>
            </div>
            <div v-if="attack.tags.length > 0" class="flex gap-1 mt-1 flex-wrap">
              <span
                v-for="tag in attack.tags"
                :key="tag"
                :class="[
                  'text-xs px-1 py-0.5 rounded',
                  attack.canSelect ? 'bg-digimon-dark-600 text-digimon-dark-300' : 'bg-red-900/20 text-red-400'
                ]"
              >
                {{ tag }}
              </span>
            </div>
            <div v-if="attack.effect" class="mt-1">
              <span :class="[
                'text-xs px-1 py-0.5 rounded',
                attack.canSelect ? 'bg-purple-900/30 text-purple-400' : 'bg-red-900/20 text-red-400'
              ]">
                {{ attack.effect }}
              </span>
            </div>
            <p class="text-xs text-digimon-dark-400 mt-1 line-clamp-2 italic">{{ attack.description }}</p>

            <!-- Requirements tooltip -->
            <div
              v-if="!attack.canSelect && attack.reasons.length > 0"
              class="mt-2 text-xs text-red-400 bg-red-900/20 rounded p-2"
            >
              <div v-for="reason in attack.reasons" :key="reason">• {{ reason }}</div>
            </div>
          </button>

          <div v-if="availableAttacks.length === 0" class="text-center py-4 text-digimon-dark-400">
            No attacks found
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
