// Statewide early in-person voting windows, shown when the Civic API has no
// early-voting sites for an address (e.g. Texas before counties publish sites
// to the Voting Information Project).
//
// Source: Center for Election Innovation & Research, "Dates for 2026 Early
// In-Person and Mail Voting" (spreadsheet dated Sept. 2026, built from state
// election calendars and statutes):
// https://electioninnovation.org/research/dates-for-2026-early-in-person-and-mail-voting/
// start/end are the statewide required window; notes cover counties that may
// open earlier or close later, and states where it is in-person absentee
// voting. Add a new entry to EARLY_VOTING_CALENDARS for each election.

import { parseIsoDate } from './calendar'

export interface EarlyVotingWindow {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD; equal to the election date when sites stay open on Election Day
  note?: string
}

interface EarlyVotingCalendar {
  electionDate: string
  sourceName: string
  sourceUrl: string
  states: Record<string, EarlyVotingWindow>
}

const GENERAL_2026: EarlyVotingCalendar = {
  electionDate: '2026-11-03',
  sourceName: 'Center for Election Innovation & Research',
  sourceUrl: 'https://electioninnovation.org/research/dates-for-2026-early-in-person-and-mail-voting/',
  states: {
    AL: { start: '2026-09-09', end: '2026-10-29', note: 'In-person absentee voting at your county absentee election manager. An excuse is required.' },
    AK: { start: '2026-10-19', end: '2026-11-03' },
    AZ: { start: '2026-10-07', end: '2026-10-30' },
    AR: { start: '2026-10-19', end: '2026-11-02' },
    CA: { start: '2026-10-05', end: '2026-11-03' },
    CO: { start: '2026-10-19', end: '2026-11-03' },
    CT: { start: '2026-10-19', end: '2026-11-01' },
    DE: { start: '2026-10-22', end: '2026-11-01' },
    DC: { start: '2026-10-26', end: '2026-11-01' },
    FL: { start: '2026-10-24', end: '2026-10-31', note: 'Counties may also open as early as Oct 19 and stay open through Nov 1.' },
    GA: { start: '2026-10-13', end: '2026-10-30' },
    HI: { start: '2026-10-20', end: '2026-11-03', note: 'Some voter service centers keep different days or hours.' },
    ID: { start: '2026-09-18', end: '2026-10-30', note: 'In-person absentee voting starts Sept 18. Some counties also run early voting from Oct 13.' },
    IL: { start: '2026-09-24', end: '2026-11-02' },
    IN: { start: '2026-10-06', end: '2026-11-02' },
    IA: { start: '2026-10-14', end: '2026-11-02' },
    KS: { start: '2026-10-27', end: '2026-11-02', note: 'Counties may open as early as Oct 14.' },
    KY: { start: '2026-10-29', end: '2026-10-31' },
    LA: { start: '2026-10-20', end: '2026-10-27' },
    ME: { start: '2026-10-05', end: '2026-10-29' },
    MD: { start: '2026-10-22', end: '2026-10-29' },
    MA: { start: '2026-10-17', end: '2026-10-30' },
    MI: { start: '2026-10-24', end: '2026-11-01', note: 'Some communities run early voting from Oct 5 through Nov 2. In-person absentee voting at your clerk’s office starts Sept 24.' },
    MN: { start: '2026-09-18', end: '2026-11-02', note: 'In-person absentee voting.' },
    MS: { start: '2026-09-21', end: '2026-10-31', note: 'In-person absentee voting at your circuit clerk’s office. An excuse is required.' },
    MO: { start: '2026-10-20', end: '2026-11-02' },
    MT: { start: '2026-10-05', end: '2026-11-03' },
    NE: { start: '2026-10-05', end: '2026-11-02' },
    NV: { start: '2026-10-17', end: '2026-10-30' },
    NH: { start: '2026-09-29', end: '2026-11-02', note: 'In-person absentee voting at your town or city clerk. An excuse is required.' },
    NJ: { start: '2026-10-24', end: '2026-11-01' },
    NM: { start: '2026-10-06', end: '2026-10-31' },
    NY: { start: '2026-10-24', end: '2026-11-01' },
    NC: { start: '2026-10-15', end: '2026-10-31' },
    ND: { start: '2026-09-24', end: '2026-11-02', note: 'In-person absentee voting starts Sept 24. Some counties also run early voting from Oct 19.' },
    OH: { start: '2026-10-06', end: '2026-11-01' },
    OK: { start: '2026-10-28', end: '2026-10-31' },
    OR: { start: '2026-10-20', end: '2026-11-03', note: 'Oregon votes by mail; you can also vote at your county elections office, some as early as Oct 14.' },
    PA: { start: '2026-10-20', end: '2026-10-27', note: 'Request, fill out and return a mail ballot in one visit to your county election office. Some counties start earlier.' },
    RI: { start: '2026-10-14', end: '2026-11-02' },
    SC: { start: '2026-10-19', end: '2026-10-31' },
    SD: { start: '2026-09-18', end: '2026-11-02' },
    TN: { start: '2026-10-14', end: '2026-10-29' },
    TX: { start: '2026-10-19', end: '2026-10-30' },
    UT: { start: '2026-10-20', end: '2026-10-30', note: 'Utah votes by mail. Each county sets its own early voting days, and some stay open through Nov 2.' },
    VT: { start: '2026-09-21', end: '2026-11-02' },
    VA: { start: '2026-09-18', end: '2026-10-31' },
    WA: { start: '2026-10-16', end: '2026-11-03' },
    WV: { start: '2026-10-21', end: '2026-10-31' },
    WI: { start: '2026-10-20', end: '2026-11-01', note: 'In-person absentee voting. Each municipality sets its own days and hours in this window.' },
    WY: { start: '2026-10-06', end: '2026-11-02' },
  },
}

const EARLY_VOTING_CALENDARS: EarlyVotingCalendar[] = [GENERAL_2026]

export interface EarlyVotingInfo extends EarlyVotingWindow {
  electionDate: string
  sourceName: string
  sourceUrl: string
}

export function getEarlyVotingWindow(
  stateCode: string | null | undefined,
  electionDate: string | null | undefined,
): EarlyVotingInfo | null {
  if (!stateCode || !electionDate) return null
  const calendar = EARLY_VOTING_CALENDARS.find((c) => c.electionDate === electionDate)
  const window = calendar?.states[stateCode.trim().toUpperCase()]
  if (!calendar || !window) return null
  return {
    ...window,
    electionDate: calendar.electionDate,
    sourceName: calendar.sourceName,
    sourceUrl: calendar.sourceUrl,
  }
}

// The next election we have a calendar for, still on or after `today`.
export function nextCalendarElection(today: string): string | null {
  const upcoming = EARLY_VOTING_CALENDARS.map((c) => c.electionDate)
    .filter((date) => date >= today)
    .sort()
  return upcoming[0] ?? null
}

// Postal codes of the states whose early voting window includes `today`.
export function statesWithEarlyVotingOpen(electionDate: string, today: string): string[] {
  const calendar = EARLY_VOTING_CALENDARS.find((c) => c.electionDate === electionDate)
  if (!calendar) return []
  return Object.entries(calendar.states)
    .filter(([, window]) => earlyVotingPhase(window, today)?.phase === 'open')
    .map(([code]) => code)
}

export type EarlyVotingPhase =
  | { phase: 'upcoming'; daysUntil: number }
  | { phase: 'open' }
  | { phase: 'ended' }

function dayNumber(value: string): number | null {
  const d = parseIsoDate(value)
  return d ? Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000) : null
}

// `today` is a local calendar date (YYYY-MM-DD), so the phase flips at the
// viewer's midnight rather than UTC's.
export function earlyVotingPhase(window: EarlyVotingWindow, today: string): EarlyVotingPhase | null {
  const [start, end, now] = [dayNumber(window.start), dayNumber(window.end), dayNumber(today)]
  if (start === null || end === null || now === null) return null
  if (now < start) return { phase: 'upcoming', daysUntil: start - now }
  if (now <= end) return { phase: 'open' }
  return { phase: 'ended' }
}

export function localToday(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

// "Mon, Oct 19"
export function formatShortDate(value: string): string {
  const d = parseIsoDate(value)
  if (!d) return value
  return new Date(d.year, d.month - 1, d.day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
