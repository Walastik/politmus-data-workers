import { describe, expect, it } from 'vitest'
import { buildElectionIcs, formatElectionDate, googleCalendarUrl, parseIsoDate } from './calendar'

const election = { id: '12000', name: '2026 General Midterm Election', date: '2026-11-03' }
const now = new Date(Date.UTC(2026, 9, 12, 18, 30, 0))

describe('calendar export', () => {
  it('formats the election date without shifting it a day', () => {
    expect(formatElectionDate('2026-11-03')).toBe('Tuesday, November 3, 2026')
  })

  it('rejects malformed or impossible dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('Nov 3')).toBeNull()
    expect(buildElectionIcs({ ...election, date: '' })).toBeNull()
    expect(formatElectionDate('soon')).toBe('soon')
  })

  it('builds an all-day event with day-before and morning-of reminders', () => {
    const ics = buildElectionIcs(election, { infoUrl: 'https://vote.example.gov/where', now })!
    const lines = ics.split('\r\n')

    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/) // CRLF only
    expect(lines).toContain('DTSTART;VALUE=DATE:20261103')
    expect(lines).toContain('DTEND;VALUE=DATE:20261104')
    expect(lines).toContain('DTSTAMP:20261012T183000Z')
    expect(lines).toContain('UID:election-12000-20261103@politmus.com')
    expect(lines).toContain('SUMMARY:Vote: 2026 General Midterm Election')
    expect(lines).toContain('URL:https://vote.example.gov/where')
    expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(2)
    expect(lines).toContain('TRIGGER:-PT15H') // 9 am the day before
    expect(lines).toContain('TRIGGER:PT8H') // 8 am on Election Day
  })

  it('escapes text and folds long lines to 75 octets', () => {
    const ics = buildElectionIcs(
      { id: '1', name: 'City of Austin, Prop A; Bonds \\ Special Élection'.repeat(3), date: '2026-12-31' },
      { now },
    )!
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    // Unfolding restores the escaped summary (commas, semicolons, backslashes)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Vote: City of Austin\\, Prop A\\; Bonds \\\\ Special Élection')
  })

  it('builds a Google Calendar link for the all-day event', () => {
    const url = new URL(googleCalendarUrl(election)!)
    expect(url.hostname).toBe('calendar.google.com')
    expect(url.searchParams.get('dates')).toBe('20261103/20261104')
    expect(url.searchParams.get('text')).toBe('Vote: 2026 General Midterm Election')
  })
})
