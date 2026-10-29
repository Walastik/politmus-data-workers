// Split Civic API pollingHours text into upcoming and passed days.
//
// Google sends hours as free text, one line per day with no year, e.g.
//   "Fri, Sep 18: 8:00 am - 4:30 pm\nMon, Sep 21: 8:00 am - 4:30 pm"
// Lines that do not start with a recognizable date are always kept as upcoming.

import { parseIsoDate } from './calendar'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const LINE_DATE = /^\s*(?:([a-z]{3})[a-z]*\.?,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/i

export interface SplitHours {
  upcoming: string[]
  passed: string[]
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// No year in the text: pick the year near the election (or today) whose
// weekday matches the line, falling back to the closest candidate.
function resolveDate(
  month: number,
  day: number,
  weekday: number | null,
  anchor: Date,
): Date | null {
  const candidates = [-1, 0, 1]
    .map((offset) => new Date(anchor.getFullYear() + offset, month, day))
    .filter((d) => d.getMonth() === month && d.getDate() === day)
  if (candidates.length === 0) return null
  const byDistance = (a: Date, b: Date) =>
    Math.abs(a.getTime() - anchor.getTime()) - Math.abs(b.getTime() - anchor.getTime())
  const matching = weekday === null ? [] : candidates.filter((d) => d.getDay() === weekday)
  return (matching.length > 0 ? matching : candidates).sort(byDistance)[0]
}

export function splitPollingHours(
  hours: string,
  options: { today?: Date; electionDate?: string | null } = {},
): SplitHours {
  const today = startOfDay(options.today ?? new Date())
  const election = parseIsoDate(options.electionDate)
  const anchor = election
    ? new Date(election.year, election.month - 1, election.day)
    : new Date(today)

  const result: SplitHours = { upcoming: [], passed: [] }
  for (const line of hours.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = LINE_DATE.exec(line)
    const month = match ? MONTHS.indexOf(match[2].toLowerCase()) : -1
    const weekdayIndex = match?.[1] ? WEEKDAYS.indexOf(match[1].toLowerCase()) : -1
    const date =
      match && month >= 0
        ? resolveDate(month, Number(match[3]), weekdayIndex >= 0 ? weekdayIndex : null, anchor)
        : null

    if (date && date.getTime() < today) {
      result.passed.push(line.trim())
    } else {
      result.upcoming.push(line.trim())
    }
  }
  return result
}
