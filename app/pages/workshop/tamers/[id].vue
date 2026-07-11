<script setup lang="ts">
import { defaultCreationRules } from '~/utils/creationRules'

definePageMeta({ title: 'Workshop — Edit Tamer' })

const route = useRoute()
const { fetchTamer } = useTamers()

const rules = ref(defaultCreationRules())
provideCreationRules(rules)

// Load the rules snapshot this sandbox tamer was built under; the form
// fetches the record separately for its own fields and reacts when the
// rules ref updates.
onMounted(async () => {
  const tamer = await fetchTamer(route.params.id as string)
  if (tamer?.creationRules) rules.value = tamer.creationRules
})
</script>

<template>
  <div>
    <div class="container mx-auto px-4 pt-8 max-w-4xl">
      <CreationRulesPicker v-model="rules" start-collapsed />
    </div>
    <TamerFormPage source="workshop" mode="edit" />
  </div>
</template>
