/**
 * Tamer Validation Composable
 * Extracted validation logic for tamer character creation
 */

import { skillsByAttribute } from '../constants/tamer-skills'

export interface TamerFormData {
  attributes: Record<string, number>
  skills: Record<string, number>
  torments?: Array<{ name: string }>
}

export function useTamerValidation(
  form: Ref<TamerFormData>,
  campaignConfig: ComputedRef<{ finalCap: number }>
) {
  // Check how many attributes are at max value
  const cappedAttributes = computed(() => {
    const values = Object.values(form.value.attributes)
    const maxValue = Math.max(...values)
    return values.filter((v) => v === maxValue).length
  })

  // Check for capped skill groups (no more than 1 skill at max per attribute)
  const cappedSkillGroups = computed(() => {
    const violations: string[] = []
    for (const [attr, skills] of Object.entries(skillsByAttribute)) {
      const values = skills.map((s) => form.value.skills[s as keyof typeof form.value.skills])
      const maxValue = Math.max(...values)
      const countAtMax = values.filter((v) => v === maxValue).length
      if (countAtMax > 1) {
        violations.push(attr)
      }
    }
    return violations
  })

  // Check for skills with zero value
  const zeroSkills = computed(() => {
    return Object.values(form.value.skills).filter((v) => v === 0).length
  })

  // Check if any skill exceeds its attribute
  const skillsExceedingAttribute = computed(() => {
    const violations: string[] = []
    const skillToAttr: Record<string, keyof typeof form.value.attributes> = {
      dodge: 'agility',
      fight: 'agility',
      stealth: 'agility',
      athletics: 'body',
      endurance: 'body',
      featsOfStrength: 'body',
      manipulate: 'charisma',
      perform: 'charisma',
      persuasion: 'charisma',
      computer: 'intelligence',
      survival: 'intelligence',
      knowledge: 'intelligence',
      perception: 'willpower',
      decipherIntent: 'willpower',
      bravery: 'willpower',
    }

    for (const [skill, attr] of Object.entries(skillToAttr)) {
      const skillVal = form.value.skills[skill as keyof typeof form.value.skills]
      const attrVal = form.value.attributes[attr]
      if (skillVal > attrVal) {
        violations.push(`${skill} (${skillVal}) > ${attr} (${attrVal})`)
      }
    }
    return violations
  })

  // Validate torment requirements
  const tormentValidation = computed(() => {
    if (!form.value.torments) {
      return { isValid: false, message: 'Torments are required' }
    }

    const minorCount = form.value.torments.filter((t) => t.severity === 'minor').length
    const majorCount = form.value.torments.filter((t) => t.severity === 'major').length
    const terribleCount = form.value.torments.filter((t) => t.severity === 'terrible').length

    const isValid = minorCount >= 2 || majorCount >= 1 || terribleCount >= 1

    let message = ''
    if (!isValid) {
      message = 'You need at least 2 Minor Torments OR 1 Major/Terrible Torment'
    }

    const allNamed = form.value.torments.every((t) => t.name.trim() !== '')
    if (!allNamed && form.value.torments.length > 0) {
      message = 'All torments must have a name'
    }

    return { isValid: isValid && allNamed, message }
  })

  return {
    cappedAttributes,
    cappedSkillGroups,
    zeroSkills,
    skillsExceedingAttribute,
    tormentValidation,
  }
}
