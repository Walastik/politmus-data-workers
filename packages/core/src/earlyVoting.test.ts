import { describe, expect, it } from 'vitest'
import { STATE_VOTER_RESOURCES } from './types'
import { parseIsoDate } from './calendar'
import {
  earlyVotingPhase,
  getEarlyVotingWindow,
  localToday,
  nextCalendarElection,
  statesWithEarlyVotingOpen,
} from './earlyVoting'

describe('early voting calendar', () => {
  it('has a valid 2026 general window for all 50 states plus DC', () => {
    for (const code of Object.keys(STATE_VOTER_RESOURCES)) {
      const w = getEarlyVotingWindow(code, '2026-11-03')
      expect(w, code).not.toBeNull()
      expect(parseIsoDate(w!.start), `${code} start`).not.toBeNull()
      expect(parseIsoDate(w!.end), `${code} end`).not.toBeNull()
      expect(w!.start <= w!.end, `${code} start before end`).toBe(true)
      expect(w!.end <= '2026-11-03', `${code} ends by Election Day`).toBe(true)
    }
  })

  it('matches the published Texas and Utah windows', () => {
    expect(getEarlyVotingWindow('tx', '2026-11-03')).toMatchObject({ start: '2026-10-19', end: '2026-10-30' })
    expect(getEarlyVotingWindow('UT', '2026-11-03')).toMatchObject({ start: '2026-10-20', end: '2026-10-30' })
  })

  it('returns null for unknown elections or states', () => {
    expect(getEarlyVotingWindow('TX', '2028-11-07')).toBeNull()
    expect(getEarlyVotingWindow('ZZ', '2026-11-03')).toBeNull()
    expect(getEarlyVotingWindow(null, '2026-11-03')).toBeNull()
    expect(getEarlyVotingWindow('TX', null)).toBeNull()
  })

  it('computes the phase on calendar days, inclusive of both ends', () => {
    const w = { start: '2026-10-19', end: '2026-10-30' }
    expect(earlyVotingPhase(w, '2026-10-15')).toEqual({ phase: 'upcoming', daysUntil: 4 })
    expect(earlyVotingPhase(w, '2026-10-18')).toEqual({ phase: 'upcoming', daysUntil: 1 })
    expect(earlyVotingPhase(w, '2026-10-19')).toEqual({ phase: 'open' })
    expect(earlyVotingPhase(w, '2026-10-30')).toEqual({ phase: 'open' })
    expect(earlyVotingPhase(w, '2026-10-31')).toEqual({ phase: 'ended' })
    // Crosses the Nov 1 DST change without an off-by-one.
    expect(earlyVotingPhase({ start: '2026-11-02', end: '2026-11-03' }, '2026-10-31')).toEqual({
      phase: 'upcoming',
      daysUntil: 2,
    })
  })

  it('formats local today as YYYY-MM-DD', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('election-wide early voting', () => {
  it('picks the next calendar election', () => {
    expect(nextCalendarElection('2026-10-25')).toBe('2026-11-03')
    expect(nextCalendarElection('2026-11-04')).toBeNull()
  })

  it('lists the states with early voting open today', () => {
    const open = statesWithEarlyVotingOpen('2026-11-03', '2026-10-25')
    expect(open).toContain('TX')
    expect(open).not.toContain('KY') // opens Oct 29
    expect(statesWithEarlyVotingOpen('1999-11-02', '2026-10-25')).toEqual([])
  })
})
