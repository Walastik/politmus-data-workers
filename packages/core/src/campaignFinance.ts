import type { FinanceElection, OfficialFinance, PeerComparison, PeerMetric, Race, RaceCandidate } from './types'

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
  race:
    "Everyone in this race, from each campaign's latest FEC report. Raised counts the whole election period, primary included. " +
    'Small donors is the share of individual money from people who gave $200 or less in total. ' +
    'Outside money is what independent groups spent for (+) or against (−) the candidate; it is not part of what they raised.',
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// "$14.3M", like Intl's compact notation, which Hermes (React Native) lacks.
const COMPACT_UNITS = ['', 'K', 'M', 'B', 'T']

function compactDollars(value: number) {
  const sign = value < 0 ? '-' : ''
  let unit = 0
  let scaled = Math.abs(value)
  while (scaled >= 1000 && unit < COMPACT_UNITS.length - 1) {
    scaled /= 1000
    unit += 1
  }
  let rounded = Math.round(scaled * 10) / 10
  // 999,960 rounds to 1000K; Intl calls that $1M.
  if (rounded >= 1000 && unit > 0 && unit < COMPACT_UNITS.length - 1) {
    rounded = Math.round((rounded / 1000) * 10) / 10
    unit += 1
  }
  return `${sign}$${rounded}${COMPACT_UNITS[unit]}`
}

// Bar fill for a candidate's share of a race.
export function partyBarClass(party: string | null | undefined) {
  if (party === 'Democratic') return 'bg-blue-500'
  if (party === 'Republican') return 'bg-red-500'
  return 'bg-emerald-500'
}

export function formatMoney(value: number | null | undefined) {
  return value == null ? '—' : money.format(value)
}

export function formatCompactMoney(value: number | null | undefined) {
  return value == null ? '—' : compactDollars(value)
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

export const SIZE_LABELS: Record<number, string> = {
  0: '$200 and under',
  200: '$200–499',
  500: '$500–999',
  1000: '$1,000–1,999',
  2000: '$2,000+',
}

// The election picked in the finance section (or the default), with the peer
// and race comparisons that belong to that election only.
export function financeSelection(finance: OfficialFinance | null, selectedKey: string | null) {
  const elections = finance?.elections ?? []
  const selected =
    elections.find((election) => electionKey(election) === selectedKey) ?? (finance ? defaultElection(finance) : null)
  const comparison = finance?.peer_comparison ?? null
  const compared =
    selected &&
    comparison &&
    comparison.election_year === selected.election_year &&
    comparison.fec_candidate_id === selected.fec_candidate_id
      ? comparison
      : null
  const race = finance?.race_comparison ?? null
  const raced = selected && race && race.election_year === selected.election_year ? race : null
  return { elections, selected, compared, race, raced }
}

// "2026", or "2026 · H6TX07123" when one year has two candidacies.
export function electionChipLabel(election: FinanceElection, elections: FinanceElection[]) {
  const shared = elections.filter((e) => e.election_year === election.election_year).length > 1
  return `${election.election_year}${shared ? ` · ${election.fec_candidate_id}` : ''}`
}

// Why a member with finance data has no totals to show yet.
export function noTotalsMessage(finance: OfficialFinance, officialId: string, race: Race | null) {
  return finance.fec_candidate_ids.length === 0
    ? 'No FEC candidate ID. Run fec_client.py crosswalk.'
    : race
      ? 'No totals loaded yet. Run fec_client.py totals --candidates.'
      : `No totals loaded yet. Run fec_client.py totals --official-id ${officialId}.`
}

export function noComparisonNote(election: FinanceElection, now: Date = new Date()) {
  return election.election_year >= now.getFullYear()
    ? 'Comparisons with other members use finished elections; pick an earlier year to see them.'
    : 'Comparisons with other members are shown for the most recent finished election.'
}

// The small line under a candidate in the race comparison.
export function raceCandidateDetail(candidate: RaceCandidate) {
  const outside =
    candidate.outside_support || candidate.outside_oppose
      ? `Outside +${formatCompactMoney(candidate.outside_support ?? 0)} / −${formatCompactMoney(candidate.outside_oppose ?? 0)}`
      : null
  return [
    `Cash ${formatCompactMoney(candidate.cash_on_hand)}`,
    candidate.small_donor_share != null ? `Small donors ${formatShare(candidate.small_donor_share)}` : null,
    outside,
  ]
    .filter(Boolean)
    .join(' · ')
}

