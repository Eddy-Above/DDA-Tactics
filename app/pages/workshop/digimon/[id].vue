<script setup lang="ts">
import { defaultCreationRules } from '~/utils/creationRules'

definePageMeta({ title: 'Workshop — Edit Digimon' })

const route = useRoute()
const { fetchDigimonById } = useDigimon()

const rules = ref(defaultCreationRules())
provideCreationRules(rules)

// Load the rules snapshot this sandbox digimon was built under; the form
// fetches the record separately for its own fields and reacts when the
// rules ref updates.
onMounted(async () => {
  const digimon = await fetchDigimonById(route.params.id as string)
  if (digimon?.creationRules) rules.value = digimon.creationRules
})
</script>

<template>
  <div>
    <div class="container mx-auto px-4 pt-8 max-w-4xl">
      <CreationRulesPicker v-model="rules" start-collapsed />
    </div>
    <DigimonFormPage source="workshop" mode="edit" />
  </div>
</template>
