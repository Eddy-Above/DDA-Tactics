import type {
  Campaign,
  CampaignLevel,
  CampaignRulesSettings,
  CreationRules,
  TormentRequirements,
} from '../types'

// One entry per compared rule: which flat field it is, the label shown in the
// parity-diff UI, and how to render each side's value.
export interface CreationRulesDiffEntry {
  field: string
  label: string
  a: string
  b: string
}

const LEVEL_LABELS: Record<CampaignLevel, string> = {
  standard: 'Standard',
  enhanced: 'Enhanced',
  extreme: 'Extreme',
}

const EDDY_SOUL_CREATION_FIELDS = [
  ['accuracyIsAgilityAthletics', 'Accuracy Pool = Agility + Athletics'],
  ['damageIsBodyFeatsOfStrength', 'Damage Pool = Body + Feats of Strength'],
  ['armorIsWillpowerEndurance', 'Armor = Willpower + Endurance'],
  ['baseStatRangesEnabled', 'Base Stat Ranges per Stage'],
  ['chargeAttackCosts3DP', 'Charge Attack Costs 3 DP'],
  ['instinctBoostsDodgeArmorSpeed', 'Instinct Boosts Dodge/Armor/Speed'],
  ['hugeSizeRequiresMega', 'Huge Size Requires Ultimate+/Mega+'],
  ['bonusDPMinPerCategory', 'Minimum Bonus DP per Category'],
] as const

const HOUSE_RULE_CREATION_FIELDS = [
  ['allowDuplicateStatValues', 'Allow Duplicate Stat Max Values'],
  ['allowFlexCPSplits', 'Flexible CP Splits'],
  ['skillOrders', 'Skill Orders'],
] as const

export function defaultCreationRules(): CreationRules {
  return {
    level: 'standard',
    eddySoulRules: {},
    houseRules: {},
    tormentRequirements: { mode: 'default' },
  }
}

export function extractCreationRules(
  campaign: Pick<Campaign, 'level' | 'rulesSettings'>,
): CreationRules {
  const settings = (campaign.rulesSettings ?? {}) as CampaignRulesSettings
  const eddy = settings.eddySoulRules ?? {}
  const house = settings.houseRules ?? {}
  return {
    level: campaign.level || 'standard',
    eddySoulRules: {
      accuracyIsAgilityAthletics: eddy.accuracyIsAgilityAthletics,
      damageIsBodyFeatsOfStrength: eddy.damageIsBodyFeatsOfStrength,
      armorIsWillpowerEndurance: eddy.armorIsWillpowerEndurance,
      baseStatRangesEnabled: eddy.baseStatRangesEnabled,
      chargeAttackCosts3DP: eddy.chargeAttackCosts3DP,
      instinctBoostsDodgeArmorSpeed: eddy.instinctBoostsDodgeArmorSpeed,
      hugeSizeRequiresMega: eddy.hugeSizeRequiresMega,
      bonusDPMinPerCategory: eddy.bonusDPMinPerCategory,
    },
    houseRules: {
      allowDuplicateStatValues: house.allowDuplicateStatValues,
      allowFlexCPSplits: house.allowFlexCPSplits,
      giganticMaxSize: house.giganticMaxSize,
      skillOrders: house.skillOrders,
    },
    tormentRequirements: settings.tormentRequirements,
    skillRenames: settings.skillRenames,
  }
}

function onOff(value: boolean | undefined): string {
  return value ? 'On' : 'Off'
}

function normalizeGiganticMaxSize(
  size: { x: number; y: number; z: number } | null | undefined,
): { x: number; y: number; z: number } | null {
  if (!size) return null
  return { x: size.x ?? 0, y: size.y ?? 0, z: size.z ?? 0 }
}

function giganticMaxSizeLabel(size: { x: number; y: number; z: number } | null): string {
  return size ? `${size.x} × ${size.y} × ${size.z}` : 'No limit'
}

function normalizeTorments(rules: TormentRequirements | undefined): {
  mode: 'default' | 'custom'
  minor: number
  major: number
  terrible: number
} {
  if (!rules || rules.mode !== 'custom') {
    return { mode: 'default', minor: 0, major: 0, terrible: 0 }
  }
  return {
    mode: 'custom',
    minor: rules.minCounts?.minor ?? 0,
    major: rules.minCounts?.major ?? 0,
    terrible: rules.minCounts?.terrible ?? 0,
  }
}

function tormentsLabel(t: ReturnType<typeof normalizeTorments>): string {
  if (t.mode === 'default') return 'Default (2 Minor, 1 Major, or 1 Terrible)'
  const parts: string[] = []
  if (t.minor > 0) parts.push(`${t.minor}+ Minor`)
  if (t.major > 0) parts.push(`${t.major}+ Major`)
  if (t.terrible > 0) parts.push(`${t.terrible}+ Terrible`)
  return `Custom: ${parts.length > 0 ? parts.join(', ') : 'no minimums'}`
}

// Compares only creation-relevant rules. Sparsely stored settings are
// normalized first (missing boolean = false, missing torments = default mode),
// so a freshly created campaign and an all-defaults picker never diff.
// skillRenames is intentionally ignored (cosmetic labels).
export function diffCreationRules(a: CreationRules, b: CreationRules): CreationRulesDiffEntry[] {
  const diff: CreationRulesDiffEntry[] = []

  const levelA = a.level || 'standard'
  const levelB = b.level || 'standard'
  if (levelA !== levelB) {
    diff.push({
      field: 'level',
      label: 'Campaign Level',
      a: LEVEL_LABELS[levelA] ?? levelA,
      b: LEVEL_LABELS[levelB] ?? levelB,
    })
  }

  for (const [field, label] of EDDY_SOUL_CREATION_FIELDS) {
    const valA = !!a.eddySoulRules?.[field]
    const valB = !!b.eddySoulRules?.[field]
    if (valA !== valB) {
      diff.push({ field: `eddySoulRules.${field}`, label, a: onOff(valA), b: onOff(valB) })
    }
  }

  for (const [field, label] of HOUSE_RULE_CREATION_FIELDS) {
    const valA = !!a.houseRules?.[field]
    const valB = !!b.houseRules?.[field]
    if (valA !== valB) {
      diff.push({ field: `houseRules.${field}`, label, a: onOff(valA), b: onOff(valB) })
    }
  }

  const gmsA = normalizeGiganticMaxSize(a.houseRules?.giganticMaxSize)
  const gmsB = normalizeGiganticMaxSize(b.houseRules?.giganticMaxSize)
  if (JSON.stringify(gmsA) !== JSON.stringify(gmsB)) {
    diff.push({
      field: 'houseRules.giganticMaxSize',
      label: 'Gigantic Max Size',
      a: giganticMaxSizeLabel(gmsA),
      b: giganticMaxSizeLabel(gmsB),
    })
  }

  const tormentsA = normalizeTorments(a.tormentRequirements)
  const tormentsB = normalizeTorments(b.tormentRequirements)
  if (JSON.stringify(tormentsA) !== JSON.stringify(tormentsB)) {
    diff.push({
      field: 'tormentRequirements',
      label: 'Torment Requirements',
      a: tormentsLabel(tormentsA),
      b: tormentsLabel(tormentsB),
    })
  }

  return diff
}
