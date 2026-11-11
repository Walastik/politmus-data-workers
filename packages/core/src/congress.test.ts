import { describe, expect, it } from 'vitest'

import { byState, chamberLeaders, chamberMakeup, delegationSummary, houseSeatLabel, memberMatches, rosterPath, sortRoster } from './congress'
import type { Official } from './types'

const member = (partial: Partial<Official>) =>
  ({ id: partial.name, name: 'x', display_name: null, party: 'Democratic', state: 'Texas', office: 'Representative', ...partial }) as Official

describe('congress roster helpers', () => {
  it('filters by party, state and name', () => {
    const m = member({ name: 'Cruz, Ted', display_name: 'Ted Cruz', party: 'Republican' })
    expect(memberMatches(m, { party: 'R', stateName: 'Texas', query: 'ted' })).toBe(true)
    expect(memberMatches(m, { party: 'D', stateName: '', query: '' })).toBe(false)
  })

  it('builds the roster request', () => {
    expect(rosterPath({ status: 'former', party: 'D', stateName: 'Ohio', query: 'brown' })).toBe(
      '/api/officials?current_member=false&level=federal&party=D&state=Ohio&q=brown',
    )
    expect(rosterPath({ status: 'all', party: '', stateName: '', query: '' })).toBe('/api/officials?level=federal')
  })

  it('counts the makeup and summarizes a delegation', () => {
    const members = [member({ name: 'a', district: 2 }), member({ name: 'b', party: 'Republican', district: 1 }), member({ name: 'c', party: 'Green' })]
    expect(chamberMakeup(members).segments.map((s) => [s.key, s.count])).toEqual([
      ['D', 1],
      ['I', 1],
      ['R', 1],
    ])
    const summary = delegationSummary(members)
    expect(summary.label).toBe('3 seats · 1D 1R')
    expect(summary.byDistrict.map((m) => m.name)).toEqual(['c', 'b', 'a'])
    expect(houseSeatLabel(member({ district: 98 }))).toBe('At-large')
    expect(houseSeatLabel(member({ office: 'Delegate' }))).toBe('Delegate')
    expect(byState([member({ name: 'z', state: 'Ohio' }), member({ name: 'y' })]).map(([s]) => s)).toEqual(['Ohio', 'Texas'])
  })

  it('sorts by score with unscored members last', () => {
    const rows = [
      member({ name: 'none', score_matches: 0 }),
      member({ name: 'low', score_matches: 6, score_pct: 40 }),
      member({ name: 'high', score_matches: 6, score_pct: 90 }),
    ]
    expect(sortRoster(rows, { sort: 'score', hasPositionsOnly: false }).map((m) => m.name)).toEqual(['high', 'low', 'none'])
  })

  it('lists each chamber\'s top posts, with vacancies', () => {
    const members = [
      member({ name: 'Johnson', office: 'Representative', party: 'Republican', leadership_role: 'Speaker of the House' }),
      member({ name: 'Thune', office: 'Senator', party: 'Republican', leadership_role: 'Senate Majority Leader' }),
      member({ name: 'Durbin', office: 'Senator' }),
    ]
    expect(chamberLeaders(members, 'Senate')?.map((p) => [p.label, p.holder?.name ?? null])).toEqual([
      ['Majority Leader', 'Thune'],
      ['Minority Leader', null],
    ])
    expect(chamberLeaders(members, 'House')?.map((p) => p.holder?.name ?? null)).toEqual(['Johnson', null, null])
    expect(chamberLeaders([member({ name: 'x' })], 'House')).toBeNull()
  })
})
