import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BillDrawer from './BillDrawer'
import type { Bill } from './types'

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const bill: Bill = {
  id: '119-s-2',
  title: 'Secure America Act',
  sponsor_id: null,
  sponsor_bioguide_id: null,
  sponsor_name: null,
  sponsor_party: null,
  cosponsor_party_breakdown: null,
  bipartisan_type: null,
  policy_area: null,
  summary: null,
  introduced_date: null,
  voted_date: null,
  days_to_vote: null,
  velocity_bucket: null,
  votes_summary: { house: {}, senate: {} },
  classification_metadata: { tldr: 'Funds border security.', eli5: 'Money for borders.', intents: [] },
}

function mockDetail(detail: Bill) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(detail), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('BillDrawer AI classification model badge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the model that classified the bill', async () => {
    mockDetail({ ...bill, classification_model: 'qwen3.6:27b' })
    render(<BillDrawer bill={bill} onClose={() => {}} />)
    expect(await screen.findByText('qwen3.6:27b')).toBeInTheDocument()
    expect(screen.queryByText('Nemotron 30B')).not.toBeInTheDocument()
  })

  it('shows no model badge when the model is unknown', async () => {
    mockDetail({ ...bill, classification_model: null })
    render(<BillDrawer bill={bill} onClose={() => {}} />)
    expect(await screen.findByText('AI Policy Classification')).toBeInTheDocument()
    expect(screen.queryByText('Nemotron 30B')).not.toBeInTheDocument()
    expect(screen.queryByText('qwen3.6:27b')).not.toBeInTheDocument()
  })
})
