// What the member profile shows, shared by the web drawer and the native screen.

import { formatCompactMoney } from './campaignFinance'
import {
  billStub,
  formatBillDate,
  incumbencyLabel,
  stateNameFromAbbr,
  type Bill,
  type Candidacy,
  type OfficialBio,
  type OfficialVote,
  type VoteAlignment,
} from './types'

export function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : undefined
}

// This cycle's races (and any later ones); past candidacies are in the finance section.
export function activeCandidacies(candidacies: Candidacy[], now: Date = new Date()): Candidacy[] {
  const thisYear = now.getFullYear()
  return candidacies.filter((candidacy) => candidacy.election_year >= thisYear)
}

export function candidacyLines(candidacy: Candidacy) {
  return {
    title: `Running for ${candidacy.race_label} · ${stateNameFromAbbr(candidacy.state)}`,
    status: [
      candidacy.election_date
        ? `General election ${formatBillDate(candidacy.election_date)}`
        : `${candidacy.election_year} election`,
      incumbencyLabel(candidacy.incumbent_challenge),
      candidacy.in_general_election ? 'On the November ballot' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    money: `Raised ${formatCompactMoney(candidacy.receipts)} · Cash on hand ${formatCompactMoney(candidacy.cash_on_hand)}${
      candidacy.coverage_end_date ? ` · FEC filings through ${formatBillDate(candidacy.coverage_end_date)}` : ''
    }`,
  }
}

// Label/value rows for the Background section; empty when there's nothing to show.
export function bioRows(bio: OfficialBio): [string, string][] {
  const born = bio.birth_date ? formatBillDate(bio.birth_date) : null
  const rows: [string, string][] = [
    ['Offices held', bio.positions_held.join('; ')],
    ['Education', bio.education.join('; ')],
    ['Occupation', bio.occupations.join(', ')],
    ['Born', born ?? ''],
  ]
  return rows.filter(([, value]) => value)
}

// One line of a recorded vote: chamber, result and question.
export function voteMeta(vote: OfficialVote): string | null {
  if (!vote.question && !vote.result) return null
  return [vote.chamber, vote.result, vote.question].filter(Boolean).join(' · ')
}

export function voteKey(vote: OfficialVote) {
  return vote.roll_call_id ?? `${vote.bill_id}-${vote.position}`
}

// -- recorded vote search ------------------------------------------------------

function compactAlphanumeric(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isVotePositionQuery(query: string) {
  return query === 'yes' || query === 'no'
}

function billIdMatches(billId: string, query: string) {
  const id = billId.toLowerCase()
  const q = query.toLowerCase()
  if (id === q) {
    return true
  }
  const compactId = compactAlphanumeric(billId)
  const compactQuery = compactAlphanumeric(query)
  if (!compactQuery) {
    return false
  }
  if (compactId === compactQuery) {
    return true
  }
  return /\d/.test(compactQuery) && compactId.includes(compactQuery)
}

function searchableText(value: string | null) {
  if (!value) {
    return ''
  }
  return value.replace(/<[^>]+>/g, ' ')
}

function looksLikeBillIdQuery(query: string) {
  return /^\d+[a-z]+\d+$/.test(compactAlphanumeric(query))
}

function fuzzyTextMatch(value: string | null, query: string) {
  const haystack = normalizeSearchText(searchableText(value))
  if (!haystack) {
    return false
  }
  const needle = normalizeSearchText(query)
  if (!needle) {
    return true
  }
  if (haystack.includes(needle)) {
    return true
  }
  const tokens = needle.split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
}

// Search box over recorded votes: "yes"/"no", a bill ID, or words in the
// title, CRS summary, question or result.
export function voteMatchesSearch(vote: OfficialVote, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return true
  }
  if (isVotePositionQuery(query)) {
    return (vote.position ?? '').toLowerCase() === query
  }
  if (billIdMatches(vote.bill_id, query)) {
    return true
  }
  if (looksLikeBillIdQuery(query)) {
    return false
  }
  return (
    fuzzyTextMatch(vote.bill_title, query) ||
    fuzzyTextMatch(vote.bill_summary, query) ||
    fuzzyTextMatch(vote.question ?? null, query) ||
    fuzzyTextMatch(vote.result ?? null, query)
  )
}

// -- opening a bill from the profile ----------------------------------------------

export function billFromVote(vote: OfficialVote): Bill {
  return {
    ...billStub(vote.bill_id),
    title: vote.bill_title,
    sponsor_name: vote.sponsor_name,
    summary: vote.bill_summary,
  }
}

export function billFromAlignment(alignment: VoteAlignment, votes: OfficialVote[]): Bill {
  const vote = votes.find((v) => v.roll_call_id === alignment.roll_call_id)
  if (vote) {
    return billFromVote(vote)
  }
  return billFromVote({
    bill_id: alignment.bill_id,
    bill_title: alignment.bill_title,
    bill_summary: null,
    position: alignment.vote_position,
    sponsor_name: null,
  })
}

// How one scored vote came out, for screen readers.
export function alignmentResultLabel(result: number | null) {
  if (result === null) return 'Not scored'
  if (result > 0) return 'Consistent, plus one'
  if (result < 0) return 'Contradicts, minus one'
  return 'Mixed, no points'
}
