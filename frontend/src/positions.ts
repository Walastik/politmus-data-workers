import { formatRelativeTime, type OfficialStance, type PositionsSync } from './types'

export const INITIAL_POSITIONS_SHOWN = 10
const ERROR_PREVIEW_LENGTH = 140

const EMPHASIS_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export const DIRECTION_LABELS: Record<string, string> = {
  increase: '↑ increase',
  decrease: '↓ decrease',
  maintain: '= maintain',
  mixed: '± mixed',
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function positionsStatusMessage(sync: PositionsSync | null | undefined, now?: Date) {
  if (!sync) {
    return 'Not processed yet'
  }
  switch (sync.status) {
    case 'ok': {
      const when = formatRelativeTime(sync.last_success_at ?? sync.last_attempt_at, now)
      const counts = `${plural(sync.stances_saved ?? 0, 'position')} from ${plural(
        sync.pages_found ?? 0,
        'page',
      )}`
      return when ? `Processed ${when} · ${counts}` : `Processed · ${counts}`
    }
    case 'no_positions':
    case 'no_issue_pages':
      return 'Site processed; no stated positions found'
    case 'blocked':
      return 'Site blocked our crawler'
    case 'needs_js':
      return 'Site needs JavaScript; not readable yet'
    case 'no_website':
      return 'No official website on file'
    case 'failed': {
      const error = sync.last_error?.trim() || 'unknown error'
      const preview =
        error.length > ERROR_PREVIEW_LENGTH ? `${error.slice(0, ERROR_PREVIEW_LENGTH)}…` : error
      return `Last attempt failed: ${preview}`
    }
    default:
      return `Status: ${sync.status}`
  }
}

// "opposes a funding decrease", "supports maintaining oversight"
export function stanceLine(position: OfficialStance) {
  const { stance, policy_direction: policyDirection, mechanism } = position
  if (!stance || !policyDirection) {
    return null
  }
  let action: string
  switch (policyDirection) {
    case 'increase':
    case 'decrease': {
      const article = /^[aeiou]/i.test(mechanism) ? 'an' : 'a'
      action = `${article} ${mechanism} ${policyDirection}`
      break
    }
    case 'maintain':
      action = `maintaining ${mechanism}`
      break
    case 'mixed':
      action = `mixed ${mechanism} changes`
      break
    default:
      action = `${mechanism} ${policyDirection}`
  }
  return `${stance} ${action}`
}

export function sourceLabel(url: string) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/$/, '')
    return `${parsed.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

type PositionGroup = { area: string; positions: OfficialStance[] }

// Groups by policy area. Groups keep the API's order (emphasis first), so the
// area holding the most emphasized position comes first.
export function groupPositions(positions: OfficialStance[]): PositionGroup[] {
  const groups = new Map<string, OfficialStance[]>()
  for (const position of positions) {
    const area = position.policy_area || 'Other'
    const list = groups.get(area)
    if (list) {
      list.push(position)
    } else {
      groups.set(area, [position])
    }
  }
  return Array.from(groups, ([area, items]) => ({
    area,
    positions: [...items].sort(
      (a, b) => (EMPHASIS_RANK[a.emphasis ?? ''] ?? 3) - (EMPHASIS_RANK[b.emphasis ?? ''] ?? 3),
    ),
  }))
}
