import { describe, expect, it } from 'vitest'

import { DEFAULT_BILL_FILTERS, billsPath, sortForQueryChange } from './billsList'

describe('bills list', () => {
  it('only sends filters that narrow the list', () => {
    expect(billsPath(DEFAULT_BILL_FILTERS, { limit: 25, offset: 0 })).toBe('/api/bills?sort=voted_desc&limit=25&offset=0')
    expect(billsPath({ ...DEFAULT_BILL_FILTERS, query: 'hr 1', pace: 'fast', bipartisan: 'bipartisan' }, { limit: 25, offset: 50 })).toBe(
      '/api/bills?q=hr+1&pace=fast&bipartisan=bipartisan&sort=voted_desc&limit=25&offset=50',
    )
  })

  it('switches to best match while searching, unless the user chose a sort', () => {
    expect(sortForQueryChange('', 'farm', 'voted_desc')).toBe('relevance')
    expect(sortForQueryChange('', 'farm', 'introduced_asc')).toBe('introduced_asc')
    expect(sortForQueryChange('farm', '', 'relevance')).toBe('voted_desc')
  })
})
