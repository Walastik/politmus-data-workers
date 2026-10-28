import { formatRelativeTime, type OfficialStance, type PositionsSync } from './types'

export const INITIAL_ISSUES_SHOWN = 10
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
    case 'thin_site':
      return 'Site has almost no readable content'
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

// Positions in one area that cite the same passage. `positions` has one entry
// unless the source page and quote are shared, in which case the quote and
// source render once above all of them.
export type EvidenceBlock = { positions: OfficialStance[] }

// One policy area: its positions grouped by shared evidence, plus the counts it
// ranks by.
export type PositionGroup = {
  area: string
  count: number
  highCount: number
  blocks: EvidenceBlock[]
}

// Case, whitespace and surrounding quote marks don't make a passage distinct.
function normalizeQuote(quote: string | null) {
  return (quote ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
    .toLowerCase()
}

function evidenceBlocks(positions: OfficialStance[]): EvidenceBlock[] {
  const blocks: EvidenceBlock[] = []
  const byEvidence = new Map<string, EvidenceBlock>()
  for (const position of positions) {
    const quote = normalizeQuote(position.evidence_quote)
    if (!quote) {
      blocks.push({ positions: [position] })
      continue
    }
    const key = `${position.source_url ?? ''}\n${quote}`
    const block = byEvidence.get(key)
    if (block) {
      block.positions.push(position)
    } else {
      const next = { positions: [position] }
      byEvidence.set(key, next)
      blocks.push(next)
    }
  }
  return blocks
}

// Groups by policy area, then by shared evidence within an area. Areas rank by
// how many positions the official states in them (what they talk about most),
// then by how many of those state the change directly, then the API's order.
// Within an area positions sort by emphasis, so a shared quote sits where its
// most emphasized position would.
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
    count: items.length,
    highCount: items.filter((item) => item.emphasis === 'high').length,
    blocks: evidenceBlocks(
      [...items].sort(
        (a, b) => (EMPHASIS_RANK[a.emphasis ?? ''] ?? 3) - (EMPHASIS_RANK[b.emphasis ?? ''] ?? 3),
      ),
    ),
  })).sort((a, b) => b.count - a.count || b.highCount - a.highCount)
}

// "Medicaid, Medicare, VA care +4 more": what the area's positions are about.
export function targetPreview(group: PositionGroup, shown = 3) {
  const names = Array.from(
    new Set(
      group.blocks.flatMap((block) =>
        block.positions.map((position) => position.target_name).filter(Boolean),
      ),
    ),
  ) as string[]
  const rest = names.length - shown
  return names.slice(0, shown).join(', ') + (rest > 0 ? ` +${rest} more` : '')
}
