import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from './api'
import {
  partyBadgeClass,
  partyShort,
  voteShort,
  voteTextClass,
  type BillVoter,
  type VoteChamber,
} from './types'

export default function VotePartyList({
  billId,
  chamber,
  party,
  onClose,
}: {
  billId: string
  chamber: VoteChamber
  party: string
  onClose: () => void
}) {
  const [voters, setVoters] = useState<BillVoter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setVoters([])

    const params = new URLSearchParams({ chamber, party })
    fetch(
      apiUrl(`/api/bills/${encodeURIComponent(billId)}/votes?${params}`),
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load votes (${res.status})`)
        }
        return res.json() as Promise<{ voters: BillVoter[] }>
      })
      .then((data) => {
        setVoters(Array.isArray(data.voters) ? data.voters : [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load votes')
        setLoading(false)
      })

    return () => controller.abort()
  }, [billId, chamber, party])

  const chamberLabel = chamber === 'senate' ? 'Senate' : 'House'

  return (
    <div className="absolute inset-0 z-[80] flex flex-col bg-slate-900/95">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {chamberLabel} votes
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-semibold ${partyBadgeClass(party)}`}
            >
              {partyShort(party)}
            </span>
            <h3 className="text-lg font-semibold text-slate-100">{party}</h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close voter list"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : loading ? (
          <p className="text-sm text-slate-400">Loading votes...</p>
        ) : voters.length === 0 ? (
          <p className="text-sm text-slate-400">
            No recorded votes for this party in the {chamberLabel.toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-1 font-mono text-sm">
            {voters.map((voter) => (
              <li
                key={voter.official_id}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="min-w-0 truncate text-slate-200">
                  {voter.name}
                </span>
                <span
                  className={`w-8 shrink-0 text-right font-semibold tabular-nums ${voteTextClass(voter.position)}`}
                >
                  {voteShort(voter.position)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
