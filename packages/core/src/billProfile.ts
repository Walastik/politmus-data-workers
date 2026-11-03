// What the bill profile shows, shared by the web drawer and the native screen.

import { BROAD_BILL_MIN_EFFECTS } from './accountability'
import {
  bipartisanTypeFromParties,
  bipartisanTypeLabel,
  formatBillDate,
  formatCosponsorBreakdown,
  formatVoteVelocity,
  involvedParties,
  partyBadgeClass,
  partyShort,
  type Bill,
  type BillAmendment,
  type BillRollCall,
  type ChamberVoteSummary,
  type ClassificationIntent,
} from './types'

export const VOTE_KIND_CHIPS: Record<string, string> = {
  passage: 'Passage',
  procedural: 'Procedural',
  amendment: 'Amendment',
}

// Chip labels for provisions that do not change the law on their own.
export const LEGAL_FORCE_LABELS: Record<string, string> = {
  conditional: 'Conditional',
  advisory: 'Advisory',
  expresses_view: 'Sense of Congress',
}

export function rollCallMeta(rollCall: BillRollCall): string {
  const when = formatBillDate(rollCall.date)
  const threshold = rollCall.requires ? `${rollCall.requires} required` : null
  return [rollCall.chamber, when, threshold].filter(Boolean).join(' · ')
}

export function voteKindChipClass(kind: string) {
  return kind === 'passage' ? 'border-slate-600 bg-slate-800 text-slate-300' : 'border-sky-600/50 bg-sky-950/40 text-sky-300'
}

// "Bipartisan", "Tripartisan" or the one party, with its colour.
export function bipartisanTag(bill: Bill): { label: string; className: string } | null {
  const parties = involvedParties(bill.sponsor_party, bill.cosponsor_party_breakdown)
  const type = bipartisanTypeFromParties(parties) ?? bill.bipartisan_type
  const label = bipartisanTypeLabel(type, parties)
  if (!label) return null
  const className =
    type === 'tripartisan'
      ? 'bg-emerald-900/50 text-emerald-300'
      : type === 'bipartisan'
        ? 'bg-violet-900/50 text-violet-300'
        : parties[0]
          ? partyBadgeClass(parties[0])
          : 'bg-slate-700/80 text-slate-300'
  return { label, className }
}

// "Sponsor Republican · Cosponsors 6 D, 5 R"
export function cosponsorLine(bill: Bill): string | null {
  const hasBreakdown = bill.cosponsor_party_breakdown != null
  if (!bill.sponsor_party && !hasBreakdown) return null
  const breakdown = formatCosponsorBreakdown(bill.cosponsor_party_breakdown)
  const cosponsorText = hasBreakdown ? (breakdown === 'No cosponsors' ? 'No cosponsors' : `Cosponsors ${breakdown}`) : null
  return [bill.sponsor_party ? `Sponsor ${bill.sponsor_party}` : null, cosponsorText].filter(Boolean).join(' · ')
}

export function sponsorText(bill: Bill): { name: string | null; notInRoster: boolean } {
  return {
    name: bill.sponsor_name || bill.sponsor_bioguide_id || null,
    notInRoster: !bill.sponsor_id && Boolean(bill.sponsor_bioguide_id),
  }
}

// Introduced / Voted / velocity / Latest action, each present only when known.
export function billDates(bill: Bill) {
  const velocity = formatVoteVelocity(bill.days_to_vote, bill.velocity_bucket)
  const latest = formatBillDate(bill.latest_action_date ?? null)
  return {
    introduced: formatBillDate(bill.introduced_date),
    voted: formatBillDate(bill.voted_date),
    velocity: velocity
      ? {
          text: velocity.text,
          description: `${velocity.label}: ${velocity.days} ${
            velocity.days === 1 || velocity.days === -1 ? 'day' : 'days'
          } from introduction to vote`,
        }
      : null,
    latestAction: bill.latest_action_text ? `${latest ? `${latest}: ` : ''}${bill.latest_action_text}` : null,
  }
}

// Flags omnibus-style bills: many effects, or add-ons unrelated to the
// bill's stated purpose (intent relation "secondary").
export function breadthNote(
  intents: ClassificationIntent[],
): { broad: string | null; unrelatedLabel: string | null; unrelatedList: string | null } | null {
  const unrelated = intents.filter((intent) => intent.relation === 'secondary')
  const broad = intents.length >= BROAD_BILL_MIN_EFFECTS
  if (!broad && unrelated.length === 0) return null
  return {
    broad: broad
      ? `${intents.length} separate policy effects. A single yes or no vote on it says little about any one of them.`
      : null,
    unrelatedLabel:
      unrelated.length > 0
        ? `Includes ${unrelated.length} provision${unrelated.length === 1 ? '' : 's'} unrelated to its main purpose:`
        : null,
    unrelatedList:
      unrelated.length > 0 ? `${unrelated.map((intent) => `${intent.target} (${intent.mechanism})`).join(', ')}.` : null,
  }
}

// Flags provisions that only ask for a change to be considered, or state a
// view, so a summary like "states must..." is not read as a mandate.
export function legalForceNote(intents: ClassificationIntent[]): { label: string; text: string } | null {
  const nonBinding = intents.filter((intent) => intent.legal_force === 'advisory' || intent.legal_force === 'expresses_view')
  if (nonBinding.length === 0) return null
  const all = nonBinding.length === intents.length
  return {
    label: all ? 'Non-binding:' : `${nonBinding.length} of ${intents.length} provisions are non-binding:`,
    text: `${all ? 'the bill' : 'they'} ask${all ? 's' : ''} for changes to be considered, studied, or stated as a view, but ${
      all ? 'does' : 'do'
    } not require them.`,
  }
}

// "3 D, 2 R" for amendment sponsors or floor speakers.
export function partyCounts(parties: (string | null)[]) {
  const counts = new Map<string, number>()
  for (const party of parties) {
    const key = party || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([party, n]) => `${n} ${partyShort(party)}`).join(', ')
}

export function amendmentLabel(amendment: BillAmendment) {
  return `${amendment.chamber === 'House' ? 'H.Amdt.' : 'S.Amdt.'} ${amendment.number}`
}

// "R-TX", or just one of the two.
export function partyStateLabel(party?: string | null, state?: string | null) {
  return [party ? partyShort(party) : null, state].filter(Boolean).join('-')
}

// -- vote tally ----------------------------------------------------------------

export const PARTY_PIES = ['Democratic', 'Republican', 'Independent'] as const
export const YES_FILL = '#10b981'
export const NO_FILL = '#ef4444'
export const EMPTY_FILL = '#334155'

export function chamberTotal(summary: ChamberVoteSummary | undefined) {
  if (!summary) return 0
  return Object.values(summary).reduce((sum: number, count) => sum + (count ?? 0), 0)
}

export function voteTotal(summary: Bill['votes_summary'] | undefined) {
  if (!summary) return 0
  return chamberTotal(summary.house) + chamberTotal(summary.senate)
}

export function chamberCounts(summary: ChamberVoteSummary | undefined) {
  const yes = summary?.Yes ?? 0
  const no = summary?.No ?? 0
  const present = summary?.Present ?? 0
  const notVoting = summary?.['Not Voting'] ?? 0
  const recorded = yes + no
  return {
    yes,
    no,
    present,
    notVoting,
    total: recorded + present + notVoting,
    yesPct: recorded === 0 ? 0 : (yes / recorded) * 100,
    noPct: recorded === 0 ? 0 : (no / recorded) * 100,
  }
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function pieSlicePath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, startDeg)
  const end = polar(cx, cy, r, endDeg)
  const delta = (((endDeg - startDeg) % 360) + 360) % 360
  const largeArc = delta > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

export interface PieSlice {
  d?: string
  fill: string
  circle?: boolean
}

// Yes/no pie in a 36×36 viewBox (circle at 18,18 radius 16), from 12 o'clock.
export function votePieSlices(yes: number, no: number): PieSlice[] {
  const recorded = yes + no
  const cx = 18
  const cy = 18
  const r = 16
  const start = -90
  if (recorded === 0) return [{ fill: EMPTY_FILL, circle: true }]
  if (yes === 0) return [{ fill: NO_FILL, circle: true }]
  if (no === 0) return [{ fill: YES_FILL, circle: true }]
  const yesSweep = (yes / recorded) * 360
  return [
    { d: pieSlicePath(cx, cy, r, start, start + yesSweep), fill: YES_FILL },
    { d: pieSlicePath(cx, cy, r, start + yesSweep, start + 360), fill: NO_FILL },
  ]
}

export function votePieDescription(label: string, yes: number, no: number) {
  return yes + no === 0 ? `${label}: no recorded yes or no votes` : `${label}: ${yes} yes, ${no} no`
}

// -- CRS summary ---------------------------------------------------------------

export interface SummaryBlock {
  kind: 'paragraph' | 'item'
  // Runs of text; `strong` ones are bold.
  runs: { text: string; strong: boolean }[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
}

// CRS summaries are simple HTML (p, ul/li, strong). Native has no HTML view,
// so split them into paragraphs and list items with bold runs.
export function crsSummaryBlocks(text: string): SummaryBlock[] {
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({ kind: 'paragraph', runs: [{ text: part, strong: false }] }))
  }
  const blocks: SummaryBlock[] = []
  const pattern = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const runs: { text: string; strong: boolean }[] = []
    const inner = match[2]
    const strongPattern = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi
    let last = 0
    let strong: RegExpExecArray | null
    const push = (raw: string, isStrong: boolean) => {
      const clean = decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ')
      if (clean.trim()) runs.push({ text: clean, strong: isStrong })
    }
    while ((strong = strongPattern.exec(inner))) {
      push(inner.slice(last, strong.index), false)
      push(strong[2], true)
      last = strong.index + strong[0].length
    }
    push(inner.slice(last), false)
    if (runs.length) {
      runs[0].text = runs[0].text.trimStart()
      runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd()
      blocks.push({ kind: match[1].toLowerCase() === 'li' ? 'item' : 'paragraph', runs })
    }
  }
  if (blocks.length === 0) {
    const plain = decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (plain) blocks.push({ kind: 'paragraph', runs: [{ text: plain, strong: false }] })
  }
  return blocks
}
