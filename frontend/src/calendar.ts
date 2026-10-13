// Calendar export for election dates.
//
// Reminders only travel in an .ics file (VALARM); "add event" URLs such as
// Google Calendar's cannot carry them, so the .ics download is the primary
// action and the Google link is a fallback that uses the user's defaults.

export interface CalendarElection {
  id: string
  name: string
  date: string // YYYY-MM-DD, a local calendar date
}

interface LocalDate {
  year: number
  month: number // 1-12
  day: number
}

export function parseIsoDate(value: string | null | undefined): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const check = new Date(year, month - 1, day)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

// Build from parts: new Date('2026-11-03') is UTC midnight and would render as
// Nov 2 anywhere in the US.
export function formatElectionDate(value: string): string {
  const d = parseIsoDate(value)
  if (!d) return value
  return new Date(d.year, d.month - 1, d.day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function compact(d: LocalDate): string {
  return `${d.year}${String(d.month).padStart(2, '0')}${String(d.day).padStart(2, '0')}`
}

function nextDay(d: LocalDate): LocalDate {
  const next = new Date(d.year, d.month - 1, d.day + 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() }
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// RFC 5545: lines longer than 75 octets are folded with CRLF + space.
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function buildElectionIcs(
  election: CalendarElection,
  options: { infoUrl?: string; now?: Date } = {},
): string | null {
  const day = parseIsoDate(election.date)
  if (!day) return null

  const description = [
    'Election Day. Polling places and hours can change; confirm with your local election office before you go.',
    options.infoUrl ? `Find your polling place: ${options.infoUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Politmus//Voter Info//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable UID: downloading again updates the event instead of duplicating it.
    `UID:election-${election.id}-${compact(day)}@politmus.com`,
    `DTSTAMP:${utcStamp(options.now ?? new Date())}`,
    `DTSTART;VALUE=DATE:${compact(day)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(day))}`,
    `SUMMARY:${escapeText(`Vote: ${election.name}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(options.infoUrl ? [`URL:${options.infoUrl}`] : []),
    'TRANSP:TRANSPARENT',
    // All-day events start at local midnight: -15h is 9 am the day before,
    // +8h is 8 am on Election Day.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`Tomorrow: ${election.name}`)}`,
    'TRIGGER:-PT15H',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`Today: ${election.name}. Remember to vote!`)}`,
    'TRIGGER:PT8H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(
  election: CalendarElection,
  options: { infoUrl?: string } = {},
): string | null {
  const day = parseIsoDate(election.date)
  if (!day) return null
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Vote: ${election.name}`,
    dates: `${compact(day)}/${compact(nextDay(day))}`,
    details: options.infoUrl
      ? `Find your polling place: ${options.infoUrl}`
      : 'Confirm your polling place with your local election office.',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function downloadIcs(filename: string, ics: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
