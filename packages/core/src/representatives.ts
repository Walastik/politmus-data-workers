// How a looked-up representative reads on My Reps, shared by web and native.

import { groupCivicRepresentatives, stateNameFromAbbr, type CivicLookup, type CivicRepresentative } from './types'

function isDistrictDivision(representative: CivicRepresentative) {
  const id = representative.division_id
  return Boolean(id?.includes('/cd:') || id?.includes('/sldu:') || id?.includes('/sldl:'))
}

// The district name ("Texas's 7th congressional district") for seats elected by district.
export function representativeDistrict(representative: CivicRepresentative): string | null {
  return representative.division_name && isDistrictDivision(representative) ? representative.division_name : null
}

// The state (or other statewide division) a representative serves.
export function representativeState(representative: CivicRepresentative, fallbackState: string): string {
  if (representative.division_name && !isDistrictDivision(representative)) {
    return representative.division_name
  }
  return fallbackState
}

export function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Congress first, then the state, then anything else the lookup found.
export function lookupSections(lookup: CivicLookup) {
  const grouped = groupCivicRepresentatives(lookup.representatives)
  return {
    fallbackState: stateNameFromAbbr(lookup.normalized_input?.state),
    federal: [...grouped.senators, ...grouped.house],
    state: [...grouped.governors, ...grouped.stateSenators, ...grouped.stateHouse],
    other: grouped.other,
  }
}

export function representativeKey(representative: CivicRepresentative) {
  return `${representative.id ?? representative.name}-${representative.office}`
}
