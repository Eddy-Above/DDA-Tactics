import type { TamerAttributes, TamerSkills } from '../types'

export const SKILL_ORDER_SKILL_THRESHOLD = {
  standard: 4,
  enhanced: 5,
  extreme: 6,
} as const

export const SKILL_ATTRIBUTE_MAP: Record<keyof TamerSkills, keyof TamerAttributes> = {
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

export const skillOrdersData: Record<keyof TamerSkills, { name: string; type: string; effect: string }> = {
  dodge: {
    name: 'Quickening',
    type: 'Once Per Day / Intercede Action',
    effect: 'On Tamer Declaration, human or partner dodges an incoming attack. Counterattack, Counterblow, and Crosscounter cannot trigger.',
  },
  fight: {
    name: 'Ignited Soul',
    type: 'Passive',
    effect: "When this human attacks a Digimon, the target's Damage Reduction loses its x3 multiplier — only Stage Bonus applies.",
  },
  stealth: {
    name: 'Last Surprise',
    type: 'Once Per Day',
    effect: 'Partner gains an additional use of Sneak Attack.',
  },
  athletics: {
    name: "Runner's High",
    type: 'Passive',
    effect: "Human's movement speed is doubled.",
  },
  endurance: {
    name: 'No Pain, No Gain',
    type: 'Once Per Day',
    effect: 'On a failed Skill Check (not Torment), reroll using Endurance modifier + Relevant Attribute. May not make another skill check until resting.',
  },
  featsOfStrength: {
    name: 'Adrenaline Junkie',
    type: 'Once Per Day / Simple Action',
    effect: 'Make a flat Body Roll vs TN 12/15/18 (Std/En/Ex). On success, use an object as a Digimon attack dealing Stage Bonus+2 unalterable damage. Retry each round until success.',
  },
  manipulate: {
    name: 'Bravado',
    type: 'Complex Action',
    effect: "Negative Direct on a target: suffers Stage Bonus penalty to Accuracy or Dodge (your choice) until the target attacks or rolls dodge.",
  },
  perform: {
    name: 'Endless Dream',
    type: 'Once Per Day',
    effect: 'Flat Charisma Check vs TN 12/15/18. On success, give a temporary Inspiration point to another Player Character (expires end of session).',
  },
  persuasion: {
    name: 'Next Order',
    type: 'Passive',
    effect: "When directing other people's Digimon, no -2 demerit.",
  },
  computer: {
    name: 'Decode Level',
    type: 'Passive',
    effect: 'Passively understands the most common form of Digimoji.',
  },
  survival: {
    name: 'Glorious World',
    type: 'Passive',
    effect: 'Can cook delicious food without rolling. When scavenging, keen to traps and sneak attacks; on a failed Perception Check may make a Survival Roll to avoid harm.',
  },
  knowledge: {
    name: "Hacker's Memory",
    type: 'Passive',
    effect: 'Against an enemy the party has fought before, partner gains Stage Bonus in bonus damage.',
  },
  perception: {
    name: 'Realization',
    type: 'Passive',
    effect: 'Can make a Perception Check in combat as a Simple Action.',
  },
  decipherIntent: {
    name: 'Cyber Sleuth',
    type: 'Passive',
    effect: 'Can discern when actively being lied to. Skilled at puzzling the use of machines or the intentions of individuals.',
  },
  bravery: {
    name: 'Break the Chain',
    type: 'Once Per Day',
    effect: 'On a failed Torment Check, reroll the result without using a point of Inspiration.',
  },
}
