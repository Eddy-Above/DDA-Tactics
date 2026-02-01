<!--
  Sprite Preview Component
  Reusable sprite preview with error handling
  Extracted from duplicated form pages
-->

<template>
  <div v-if="modelValue && !spriteError" class="sprite-preview">
    <img :src="modelValue" @error="handleSpriteError" :alt="alt" class="sprite-image" />
  </div>
  <div v-else-if="spriteError" class="sprite-error">
    <p class="text-sm text-red-400">Failed to load sprite image</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue?: string
  alt?: string
}>()

const emit = defineEmits<{
  error: []
}>()

const spriteError = ref(false)

function handleSpriteError() {
  spriteError.value = true
  emit('error')
}

watch(
  () => props.modelValue,
  () => {
    spriteError.value = false
  }
)
</script>

<style scoped>
.sprite-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 0.5rem;
  padding: 0.5rem;
  margin: 0.5rem 0;
}

.sprite-image {
  max-height: 120px;
  max-width: 100%;
  object-fit: contain;
}

.sprite-error {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
  margin: 0.5rem 0;
}
</style>
