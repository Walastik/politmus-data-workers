// How a feed card reads: its label, icon and colour by kind of news, and the
// party tally of a vote. Web and native map `icon` to their own icon set.

import type { ChamberVoteSummary, FeedItem } from './types'

export type FeedIcon = 'bill' | 'law' | 'failed' | 'progress' | 'vote' | 'seated' | 'departed'

export interface FeedKindStyle {
  label: string
  icon: FeedIcon
  // Icon and label colour; one hue per kind of news.
  tone: string
}

export function feedKindStyle(item: FeedItem, voteCount: number): FeedKindStyle {
  switch (item.kind) {
    case 'bill_introduced':
      return { label: 'New bill', icon: 'bill', tone: 'text-blue-400' }
    case 'bill_status_changed': {
      const status = item.payload?.status ?? 'Bill moved'
      if (status === 'Became Law') {
        return { label: 'Became law', icon: 'law', tone: 'text-emerald-400' }
      }
      if (status === 'Vetoed' || status === 'Failed') {
        return { label: status, icon: 'failed', tone: 'text-red-400' }
      }
      return { label: status, icon: 'progress', tone: 'text-sky-400' }
    }
    case 'vote_held': {
      const chamber = item.roll_call?.chamber ?? item.payload?.chamber ?? 'Floor'
      const result = item.roll_call?.result ?? item.payload?.result
      const votes = voteCount > 1 ? `${chamber} · ${voteCount} votes` : `${chamber} vote`
      return {
        label: result ? `${votes} · ${result}` : votes,
        icon: 'vote',
        tone: 'text-slate-300',
      }
    }
    case 'official_seated':
      return { label: 'New in office', icon: 'seated', tone: 'text-amber-400' }
    case 'official_departed':
      return { label: 'Left office', icon: 'departed', tone: 'text-slate-400' }
  }
}

// VoteTallyBar reads bill-shaped summaries; put this one roll call's party
// tally under its chamber so the feed draws the same bar as the bills list.
export function tallyAsBillSummary(item: FeedItem) {
  const byParty = item.tally_by_party
  const chamber = item.roll_call?.chamber === 'House' ? 'house' : 'senate'
  if (!byParty) return null
  const totals: ChamberVoteSummary = {}
  for (const positions of Object.values(byParty)) {
    for (const [position, count] of Object.entries(positions)) {
      totals[position] = (totals[position] ?? 0) + (count ?? 0)
    }
  }
  return {
    summary: { house: {}, senate: {}, [chamber]: totals },
    byParty: { house: {}, senate: {}, [chamber]: byParty },
  }
}
