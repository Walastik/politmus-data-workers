import type { Official } from './types'

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
  return points > 0
    ? 'border-emerald-700/70 bg-emerald-950/80 text-emerald-300'
    : 'border-rose-700/70 bg-rose-950/80 text-rose-300'
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
