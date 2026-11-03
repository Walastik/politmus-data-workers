import { describe, expect, it } from 'vitest'

import { pacGiftsPath, pacListPath, pacMeta } from './pacExplorer'
import type { FinanceElection, Pac } from './types'

const election = { fec_candidate_id: 'S2TX00312', election_year: 2026 } as FinanceElection

describe('PAC explorer', () => {
  it('builds the list and gifts requests', () => {
    expect(pacListPath('C001056', election, { sort: 'amount', offset: 50, query: 'bank', category: 'corporate' })).toBe(
      '/api/officials/C001056/finance/pacs/list?fec_candidate_id=S2TX00312&election_year=2026&sort=amount&limit=50&offset=50&q=bank&category=corporate',
    )
    expect(pacGiftsPath('C001056', election, 'C123')).toBe(
      '/api/officials/C001056/finance/pacs/gifts?fec_candidate_id=S2TX00312&election_year=2026&pac_key=C123',
    )
  })

  it('describes a PAC’s giving', () => {
    const pac = { category_label: 'Corporate', gift_count: 1, first_date: '2026-01-02', last_date: '2026-01-02' } as Pac
    expect(pacMeta(pac)).toBe('Corporate · 1 gift · 2026-01-02')
  })
})
