import type { FinanceElection, OfficialFinance, PeerComparison, PeerMetric } from './types'

// Dark-surface categorical slots in fixed order (validated against slate-900).
export const FUNDING_MIX_COLORS: Record<string, string> = {
  small_donors: '#3987e5',
  large_donors: '#d95926',
  joint_fundraising: '#199e70',
  pacs: '#c98500',
  party: '#d55181',
  candidate: '#008300',
  other: '#9085e9',
}
// PAC categories use the same slots, in the order the API returns them.
export const PAC_CATEGORY_COLORS: Record<string, string> = {
  corporate: '#3987e5',
  labor: '#d95926',
  trade: '#199e70',
  membership: '#c98500',
  cooperative: '#d55181',
  ideological: '#008300',
  politicians: '#9085e9',
  other: '#e66767',
}
export const HOME_STATE_COLOR = '#3987e5'
export const OUT_OF_STATE_COLOR = '#d95926'

export const EXPLAINERS = {
  fundingMix:
    '"Small donors" is money from people whose gifts added up to $200 or less; campaigns report it as a lump sum, without names. ' +
    'Joint fundraising transfers come from committees that raise money for several candidates or a party at once, and are mostly individual donors\' money. ' +
    'PACs are political committees run by companies\' employees, unions, trade groups or causes; companies themselves cannot give directly.',
  homeState:
    'Where individual donors live, based on the address the campaign reports. A high out-of-state share means the campaign leans on national donors ' +
    'rather than constituents. It covers itemized gifts only: donors who gave over $200, plus small online gifts processed by platforms like ActBlue or WinRed. ' +
    'Other small gifts are reported without an address.',
  outsideSpending:
    'Money that independent groups (super PACs, advocacy groups, unions, party committees) spent on their own to help or hurt this candidate, mostly on ads and mailers. ' +
    "The campaign doesn't control it and it isn't part of what they raised. Large amounts usually mean a competitive race or a group with a strong interest in the outcome. " +
    'It only counts spending reported to the FEC as independent expenditures; ads that avoid explicitly backing or opposing a candidate are not included.',
  pacs:
    'Every gift from a PAC or other political committee, as itemized in the campaign\'s FEC reports. ' +
    'Corporate, labor, trade, membership and cooperative PACs are funded by the employees or members of their sponsoring organization; ' +
    'the organization itself cannot give from its treasury. Ideological / issue PACs have no sponsor and raise money around a cause. ' +
    "Politicians' PACs are leadership PACs run by other members of Congress, plus other candidates' campaigns. " +
    '"Other / unclassified" covers committees whose FEC filings don\'t say what kind of organization sponsors them.',
  peers:
    "Compared with current members of the same chamber, using each member's most recent finished election. " +
    'Senate totals cover six years and House totals two, so the chambers are never mixed.',
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const compactMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatMoney(value: number | null | undefined) {
  return value == null ? '—' : money.format(value)
}

export function formatCompactMoney(value: number | null | undefined) {
  return value == null ? '—' : compactMoney.format(value)
}

export function formatShare(value: number | null | undefined) {
  if (value == null) {
    return '—'
  }
  const percent = value * 100
  if (percent > 0 && percent < 1) {
    return '<1%'
  }
  return `${Math.round(percent)}%`
}

const PARTY_ADJECTIVES: Record<string, string> = {
  democratic: 'Democratic',
  democrat: 'Democratic',
  republican: 'Republican',
  independent: 'independent',
}

export function partyAdjective(party: string | null | undefined) {
  if (!party) {
    return null
  }
  return PARTY_ADJECTIVES[party.trim().toLowerCase()] ?? party.trim()
}

// "More than 82% of senators" style phrasing for one comparison group.
export function peerPhrase(
  percentile: number | null | undefined,
  count: number,
  groupLabel: string,
) {
  if (percentile == null || count === 0) {
    return null
  }
  if (percentile >= 1) {
    return `Highest of ${count + 1} ${groupLabel}`
  }
  if (percentile <= 0) {
    return `Lowest of ${count + 1} ${groupLabel}`
  }
  return `More than ${Math.round(percentile * 100)}% of ${groupLabel}`
}

export function peerLines(metric: PeerMetric | undefined, comparison: PeerComparison) {
  if (!metric) {
    return []
  }
  const party = partyAdjective(comparison.party)
  return [
    peerPhrase(metric.chamber_percentile, metric.chamber_count, comparison.chamber_label),
    party
      ? peerPhrase(
          metric.party_percentile,
          metric.party_count,
          `${party} ${comparison.chamber_label}`,
        )
      : null,
  ].filter((line): line is string => Boolean(line))
}

export function electionKey(election: FinanceElection) {
  return `${election.fec_candidate_id}-${election.election_year}`
}

// The compared election when there is one, otherwise the newest with money raised.
export function defaultElection(finance: OfficialFinance) {
  const comparison = finance.peer_comparison
  if (comparison) {
    const compared = finance.elections.find(
      (election) =>
        election.election_year === comparison.election_year &&
        election.fec_candidate_id === comparison.fec_candidate_id,
    )
    if (compared) {
      return compared
    }
  }
  return finance.elections.find((election) => election.receipts) ?? finance.elections[0] ?? null
}

// The gap between the itemized PAC sum and FEC's reported total, when it is
// big enough to mention (amended or late filings not yet loaded).
export function pacTotalGap(total: number, reported: number | null | undefined) {
  if (reported == null || reported <= 0) {
    return null
  }
  const gap = Math.abs(total - reported) / reported
  return gap >= 0.01 ? gap : null
}

export function pacParams(election: FinanceElection) {
  return new URLSearchParams({
    fec_candidate_id: election.fec_candidate_id,
    election_year: String(election.election_year),
  })
}

export function formatDateRange(first: string | null | undefined, last: string | null | undefined) {
  if (!first && !last) {
    return ''
  }
  if (!first || first === last) {
    return last ?? first ?? ''
  }
  return `${first} → ${last}`
}
