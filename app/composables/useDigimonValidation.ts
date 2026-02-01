/**
 * Digimon Validation Composable
 * Extracted validation logic for digimon creation/editing
 */

export interface DigimonFormData {
  name?: string
  attacks?: Array<{ id: string; name: string; tags: string[] }>
  qualities?: Array<{ id: string; ranks?: number }>
  baseStats?: Record<string, number>
  bonusStats?: Record<string, number>
  bonusDP?: number
  bonusDPForQualities?: number
}

export function useDigimonValidation(form: Ref<DigimonFormData>) {
  // Check if basic info is valid
  const basicInfoValid = computed(() => {
    return !!(form.value.name && form.value.name.trim().length > 0)
  })

  // Check if at least one attack is defined
  const hasAttacks = computed(() => {
    return (form.value.attacks || []).length > 0
  })

  // Check if at least one quality is defined
  const hasQualities = computed(() => {
    return (form.value.qualities || []).length > 0
  })

  // Validate stat allocation
  const statsValid = computed(() => {
    const baseStats = form.value.baseStats || {}
    const allValuesValid = Object.values(baseStats).every((v) => typeof v === 'number' && v >= 0)
    return allValuesValid
  })

  // Validate bonus DP allocation
  const bonusDPValid = computed(() => {
    const bonusDP = form.value.bonusDP || 0
    const bonusDPForQualities = form.value.bonusDPForQualities || 0

    if (bonusDP < 0) return false
    if (bonusDPForQualities < 0) return false
    if (bonusDPForQualities > bonusDP) return false

    return true
  })

  // Check for duplicate attack names
  const noDuplicateAttacks = computed(() => {
    const attacks = form.value.attacks || []
    const names = attacks.map((a) => a.name.toLowerCase().trim())
    const uniqueNames = new Set(names)
    return uniqueNames.size === names.length
  })

  // Overall form validity
  const isFormValid = computed(() => {
    return basicInfoValid.value && statsValid.value && bonusDPValid.value && noDuplicateAttacks.value
  })

  return {
    basicInfoValid,
    hasAttacks,
    hasQualities,
    statsValid,
    bonusDPValid,
    noDuplicateAttacks,
    isFormValid,
  }
}
