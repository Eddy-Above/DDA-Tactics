<script setup lang="ts">
import { defaultCreationRules } from '~/utils/creationRules'

definePageMeta({ title: 'Workshop — New Tamer' })

const rules = ref(defaultCreationRules())
provideCreationRules(rules)
</script>

<template>
  <div>
    <div class="container mx-auto px-4 pt-8 max-w-4xl">
      <CreationRulesPicker v-model="rules" />
    </div>
    <TamerFormPage source="workshop" mode="create" />
  </div>
</template>
