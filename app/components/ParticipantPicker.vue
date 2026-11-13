<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

interface Option { value: string; label: string; searchText?: string }
const props = withDefaults(defineProps<{
  modelValue: string[]
  options: Option[]
  multiple?: boolean
  disabled?: boolean
  label: string
}>(), { multiple: false, disabled: false })
const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>()
const listId = useId()
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const open = ref(false), query = ref(''), active = ref(0)
const selected = computed(() => props.options.filter(option => props.modelValue.includes(option.value)))
const selectedLabel = computed(() => props.multiple ? '' : selected.value[0]?.label ?? '')
const filtered = computed(() => {
  const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return props.options.filter(option => {
    const text = `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
})
watch(filtered, () => { active.value = 0 })

function choose(option: Option) {
  if (props.disabled) return
  if (props.multiple) {
    emit('update:modelValue', props.modelValue.includes(option.value)
      ? props.modelValue.filter(value => value !== option.value) : [...props.modelValue, option.value])
  } else {
    emit('update:modelValue', [option.value])
    close()
  }
}
function close() { open.value = false; query.value = '' }
function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
  if (!props.multiple && props.modelValue.length) emit('update:modelValue', [])
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) { open.value = true; active.value = event.key === 'ArrowUp' ? Math.max(0, filtered.value.length - 1) : 0 }
    else if (filtered.value.length) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + filtered.value.length) % filtered.value.length
    root.value?.querySelector(`[data-option-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault(); event.stopPropagation()
    const option = filtered.value[active.value]
    if (option) choose(option)
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault(); event.stopPropagation(); close()
  } else if (event.key === 'Tab') close()
}
function onFocusout(event: FocusEvent) { if (!root.value?.contains(event.relatedTarget as Node | null)) close() }
</script>

<template>
  <div ref="root" class="participant-picker relative" @focusout="onFocusout">
    <div class="relative">
      <input ref="input" type="text" role="combobox" autocomplete="off"
        :aria-label="label" :aria-controls="listId" :aria-expanded="open" aria-autocomplete="list"
        :aria-activedescendant="open && filtered[active] ? `${listId}-${active}` : undefined"
        :value="open ? query : selectedLabel" :placeholder="multiple && modelValue.length ? `${modelValue.length} selected — type to search…` : 'Type to search…'"
        :disabled="disabled" class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg pl-3 pr-9 py-2 text-white focus:border-digimon-orange-500 focus:outline-none"
        @focus="open = true" @click="open = true" @input="onInput" @keydown="onKeydown" />
      <button type="button" :disabled="disabled" :aria-label="`Open ${label}`" tabindex="-1"
        class="absolute right-3 top-2 text-digimon-dark-400" @click="input?.focus(); open = true">▾</button>
    </div>
    <ul v-if="open" :id="listId" role="listbox" :aria-label="label" :aria-multiselectable="multiple || undefined"
      class="absolute z-20 w-full max-h-60 overflow-y-auto mt-1 p-1 bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg shadow-xl">
      <li v-for="(option, index) in filtered" :id="`${listId}-${index}`" :key="option.value" role="option"
        :aria-selected="modelValue.includes(option.value)" :data-option-index="index"
        class="px-3 py-2 text-sm text-white rounded cursor-pointer flex items-center gap-2"
        :class="index === active ? 'bg-digimon-dark-600' : 'hover:bg-digimon-dark-700'"
        @pointerdown.prevent="choose(option)" @mousemove="active = index">
        <span v-if="multiple" aria-hidden="true">{{ modelValue.includes(option.value) ? '☑' : '☐' }}</span>
        {{ option.label }}
      </li>
      <li v-if="!filtered.length" class="px-3 py-2 text-sm text-digimon-dark-400" role="status">{{ options.length ? 'No matches found.' : 'No participants available.' }}</li>
    </ul>
    <div v-if="multiple && selected.length" class="flex flex-wrap gap-1 mt-2">
      <button v-for="option in selected" :key="option.value" type="button" :disabled="disabled"
        class="bg-digimon-dark-700 rounded px-2 py-1 text-sm text-white" :aria-label="`Remove ${option.label}`" @click="choose(option)">
        {{ option.label }} <span aria-hidden="true">×</span>
      </button>
    </div>
  </div>
</template>
