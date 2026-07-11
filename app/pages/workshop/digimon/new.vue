<script setup lang="ts">
import { defaultCreationRules } from '~/utils/creationRules'

definePageMeta({ title: 'Workshop — New Digimon' })

const rules = ref(defaultCreationRules())
provideCreationRules(rules)
</script>

<template>
  <div>
    <div class="container mx-auto px-4 pt-8 max-w-4xl">
      <CreationRulesPicker v-model="rules" />
    </div>
    <DigimonFormPage source="workshop" mode="create" />
  </div>
</template>
