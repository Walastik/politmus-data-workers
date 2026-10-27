import type { Official, VoteAlignment } from './types'

// Below this many scored matches the percentage is too noisy to headline.
export const MIN_MATCHES_FOR_PCT = 5
export const INITIAL_ALIGNMENTS_SHOWN = 10

export function formatPoints(points: number) {
  if (points > 0) return `+${points}`
  if (points < 0) return `−${Math.abs(points)}`
  return '0'
}

export function formatPct(pct: number | null | undefined) {
  return pct == null ? '—' : `${Math.round(pct)}%`
}

export function hasReliablePct(matches: number | null | undefined, pct: number | null | undefined) {
  return pct != null && (matches ?? 0) >= MIN_MATCHES_FOR_PCT
}

// Text color for a percentage: consistent, mixed, or contradicting.
export function pctToneClass(pct: number | null | undefined) {
  if (pct == null) return 'text-slate-400'
  if (pct >= 75) return 'text-emerald-300'
  if (pct >= 50) return 'text-amber-300'
  return 'text-rose-300'
}

export function pointsToneClass(points: number) {
  if (points > 0) return 'text-emerald-300'
  if (points < 0) return 'text-rose-300'
  return 'text-slate-300'
}

export function pointsBadgeClass(points: number) {
  if (points > 0) return 'border-emerald-700/70 bg-emerald-950/80 text-emerald-300'
  if (points < 0) return 'border-rose-700/70 bg-rose-950/80 text-rose-300'
  return 'border-slate-700 bg-slate-800 text-slate-300'
}

// Same threshold as BROAD_BILL_MIN_EFFECTS in backend services/accountability.py.
export const BROAD_BILL_MIN_EFFECTS = 10

// Why a match is kept out of the score (VoteAlignment.reason).
export const NOT_COUNTED_REASONS: Record<string, string> = {
  non_binding_provision:
    'this provision only asks for a change to be considered, or states a view, without making it',
  low_emphasis: 'the position is only implied by a general statement',
  local_on_broad_bill: 'a local position does not say much about a vote on a broad bill',
  unrelated_provision:
    'this is an unrelated add-on to the bill; only positions they state directly count here',
  minor_provision: 'a minor part of a broad bill; only positions they state directly count here',
  later_vote: 'a later vote on the same policy counts instead',
}

export function notCountedReason(reason: string | null | undefined) {
  return NOT_COUNTED_REASONS[reason ?? ''] ?? 'kept out of the score'
}

export interface VoteGroup {
  key: string
  matches: VoteAlignment[]
  // Net of the counted matches (+1, -1, 0), or null when none count.
  result: number | null
}

// One entry per vote, in the order the API returns them (newest first). The
// vote scores once: its counted matches net to +1, -1, or 0.
export function groupByVote(alignments: VoteAlignment[]): VoteGroup[] {
  const groups = new Map<string, VoteAlignment[]>()
  for (const alignment of alignments) {
    const key = `${alignment.bill_id}-${alignment.roll_call_id}`
    groups.set(key, [...(groups.get(key) ?? []), alignment])
  }
  return [...groups].map(([key, matches]) => {
    const counted = matches.filter((m) => m.counted !== false)
    const net = counted.reduce((sum, m) => sum + m.points, 0)
    return { key, matches, result: counted.length ? Math.sign(net) : null }
  })
}

export function isScored(official: Pick<Official, 'score_matches'>) {
  return official.score_matches != null
}

const EFFECT_VERBS: Record<string, string> = {
  increase: 'increases',
  decrease: 'cuts',
  maintain: 'maintains',
  mixed: 'changes',
}

// "increases Medicaid funding", "cuts Border Patrol regulation"
export function effectPhrase(direction: string, target: string | null, mechanism: string) {
  const verb = EFFECT_VERBS[direction] ?? direction
  return `${verb} ${target || 'an unnamed target'} ${mechanism}`
}

// "wants it increased" / "wants it cut"
export function wantsPhrase(direction: string) {
  if (direction === 'increase') return 'wants it increased'
  if (direction === 'decrease') return 'wants it cut'
  return `wants ${direction}`
}

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
