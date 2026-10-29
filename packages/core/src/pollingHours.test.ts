import { describe, expect, it } from 'vitest'
import { splitPollingHours } from './pollingHours'

// Burnsville City Hall early voting hours as returned by the Civic API (MN, 2026 midterm)
const BURNSVILLE = [
  'Fri, Sep 18: 8:00 am - 4:30 pm', 'Mon, Sep 21: 8:00 am - 4:30 pm', 'Tue, Sep 22: 8:00 am - 4:30 pm',
  'Wed, Sep 23: 8:00 am - 4:30 pm', 'Thu, Sep 24: 8:00 am - 4:30 pm', 'Fri, Sep 25: 8:00 am - 4:30 pm',
  'Mon, Sep 28: 8:00 am - 4:30 pm', 'Tue, Sep 29: 8:00 am - 4:30 pm', 'Wed, Sep 30: 8:00 am - 4:30 pm',
  'Thu, Oct 1: 8:00 am - 4:30 pm', 'Fri, Oct 2: 8:00 am - 4:30 pm', 'Mon, Oct 5: 8:00 am - 4:30 pm',
  'Tue, Oct 6: 8:00 am - 4:30 pm', 'Wed, Oct 7: 8:00 am - 4:30 pm', 'Thu, Oct 8: 8:00 am - 4:30 pm',
  'Fri, Oct 9: 8:00 am - 4:30 pm', 'Tue, Oct 13: 8:00 am - 4:30 pm', 'Wed, Oct 14: 8:00 am - 4:30 pm',
  'Sat, Oct 31: 9 am - 3 pm', 'Sun, Nov 1: 9 am - 3 pm', 'Mon, Nov 2: 8 am - 5 pm',
].join('\n')

describe('splitPollingHours', () => {
  it('moves days before today into passed, keeping order', () => {
    const { upcoming, passed } = splitPollingHours(BURNSVILLE, {
      today: new Date(2026, 9, 12, 15, 0),
      electionDate: '2026-11-03',
    })
    expect(passed).toHaveLength(16)
    expect(passed[0]).toBe('Fri, Sep 18: 8:00 am - 4:30 pm')
    expect(passed.at(-1)).toBe('Fri, Oct 9: 8:00 am - 4:30 pm')
    expect(upcoming[0]).toBe('Tue, Oct 13: 8:00 am - 4:30 pm')
    expect(upcoming.at(-1)).toBe('Mon, Nov 2: 8 am - 5 pm')
  })

  it('keeps today in upcoming even after closing time', () => {
    const { upcoming, passed } = splitPollingHours('Tue, Oct 13: 8:00 am - 4:30 pm', {
      today: new Date(2026, 9, 13, 23, 0),
      electionDate: '2026-11-03',
    })
    expect(upcoming).toHaveLength(1)
    expect(passed).toHaveLength(0)
  })

  it('infers the year across New Year from the weekday and election date', () => {
    // Early voting in Dec 2027 for a Jan 2028 election; Dec 31, 2027 is a Friday
    const hours = 'Thu, Dec 30: 8 am - 5 pm\nFri, Dec 31: 8 am - 5 pm\nMon, Jan 3: 8 am - 5 pm'
    const { upcoming, passed } = splitPollingHours(hours, {
      today: new Date(2027, 11, 31),
      electionDate: '2028-01-11',
    })
    expect(passed).toEqual(['Thu, Dec 30: 8 am - 5 pm'])
    expect(upcoming).toEqual(['Fri, Dec 31: 8 am - 5 pm', 'Mon, Jan 3: 8 am - 5 pm'])
  })

  it('handles lines without a weekday and keeps unrecognized text visible', () => {
    const hours = 'Oct 5: 8 am - 4 pm\nCall ahead for accessible entrance\nNov 3: 7 am - 8 pm'
    const { upcoming, passed } = splitPollingHours(hours, {
      today: new Date(2026, 9, 12),
      electionDate: '2026-11-03',
    })
    expect(passed).toEqual(['Oct 5: 8 am - 4 pm'])
    expect(upcoming).toEqual(['Call ahead for accessible entrance', 'Nov 3: 7 am - 8 pm'])
  })

  it('falls back to the current year without an election date', () => {
    const { passed } = splitPollingHours('Fri, Sep 18: 8 am - 4 pm', { today: new Date(2026, 9, 12) })
    expect(passed).toHaveLength(1)
  })
})
