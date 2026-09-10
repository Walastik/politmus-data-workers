import { Globe, MapPin, Phone, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { apiUrl } from './api'
import BillDrawer from './BillDrawer'
import {
  officeLine,
  partyBadgeClass,
  partyShort,
  positionBadgeClass,
  rosterStatusLabel,
  type Bill,
  type Official,
  type OfficialDetail,
  type OfficialVote,
} from './types'

export default function MemberDrawer({
  official,
  onClose,
}: {
  official: Official
  onClose: () => void
}) {
  const [detail, setDetail] = useState<OfficialDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [voteQuery, setVoteQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setDetail(null)
    setSelectedBill(null)
    setVoteQuery('')

    fetch(apiUrl(`/api/officials/${encodeURIComponent(official.id)}`), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load votes (${res.status})`)
        }
        return res.json() as Promise<OfficialDetail>
      })
      .then((data) => {
        setDetail(data)
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
  }, [official.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !selectedBill) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, selectedBill])

  const votes = detail?.votes ?? []
  const filteredVotes = useMemo(
    () => votes.filter((vote) => voteMatchesSearch(vote, voteQuery)),
    [votes, voteQuery],
  )

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70"
        aria-label="Close member details"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-drawer-title"
        className="relative z-50 flex h-full w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold ${partyBadgeClass(official.party)}`}
              >
                {partyShort(official.party)}
              </span>
              <span className="text-xs text-slate-400">{official.state}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {rosterStatusLabel(official)}
              </span>
            </div>
            <h2 id="member-drawer-title" className="mt-2 text-xl font-semibold">
              {official.name}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {officeLine(official)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <ContactSection official={detail ?? official} />

          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Recorded votes
          </h3>
          {loading ? (
            <p className="mt-3 text-sm text-slate-400">Loading vote history...</p>
          ) : error ? (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          ) : votes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              No recorded votes in the ingested bills.
            </p>
          ) : (
            <>
              <label className="relative mt-3 block">
                <span className="sr-only">
                  Search recorded votes by bill title, CRS summary, bill ID, or yes/no
                </span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={voteQuery}
                  onChange={(event) => setVoteQuery(event.target.value)}
                  placeholder="Title, summary, bill ID, or yes/no"
                  className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              {voteQuery.trim() ? (
                <p className="mt-2 text-xs text-slate-500">
                  Showing {filteredVotes.length} of {votes.length}{' '}
                  {votes.length === 1 ? 'vote' : 'votes'}
                </p>
              ) : null}
              {filteredVotes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  No recorded votes match this search.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {filteredVotes.map((vote) => (
                    <li key={`${vote.bill_id}-${vote.position}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedBill(billFromVote(vote))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-800/60 p-3 text-left transition hover:border-slate-500 hover:bg-slate-800"
                        aria-label={`Open details for ${vote.bill_title || vote.bill_id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-mono text-xs text-slate-400">{vote.bill_id}</p>
                          <span
                            className={`shrink-0 text-xs px-2 py-0.5 rounded font-bold ${positionBadgeClass(vote.position)}`}
                          >
                            {vote.position ?? 'Unknown'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium leading-snug">
                          {vote.bill_title || 'Untitled bill'}
                        </p>
                        {vote.sponsor_name ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Sponsor: {vote.sponsor_name}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>
      {selectedBill ? (
        <BillDrawer
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
        />
      ) : null}
    </div>
  )
}

function ContactSection({ official }: { official: Official }) {
  const phone = official.phone
  const officeAddress = official.office_address
  const websiteUrl = official.website_url
  if (!phone && !officeAddress && !websiteUrl) {
    return null
  }

  return (
    <section className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Contact
      </h3>
      <ul className="mt-3 space-y-3 text-sm">
        {phone ? (
          <li className="flex items-start gap-2">
            <Phone
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <a
              href={telHref(phone)}
              className="text-slate-200 underline-offset-2 hover:text-white hover:underline"
              aria-label={`Call ${phone}`}
            >
              {phone}
            </a>
          </li>
        ) : null}
        {officeAddress ? (
          <li className="flex items-start gap-2">
            <MapPin
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <span className="text-slate-200">{officeAddress}</span>
          </li>
        ) : null}
        {websiteUrl ? (
          <li className="flex items-start gap-2">
            <Globe
              className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-200 underline-offset-2 hover:text-white hover:underline"
              aria-label={`Official website, ${websiteLabel(websiteUrl)} (opens in a new tab)`}
            >
              {websiteLabel(websiteUrl)}
            </a>
          </li>
        ) : null}
      </ul>
    </section>
  )
}

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : undefined
}

function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function compactAlphanumeric(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isVotePositionQuery(query: string) {
  return query === 'yes' || query === 'no'
}

function billIdMatches(billId: string, query: string) {
  const id = billId.toLowerCase()
  const q = query.toLowerCase()
  if (id === q) {
    return true
  }
  const compactId = compactAlphanumeric(billId)
  const compactQuery = compactAlphanumeric(query)
  if (!compactQuery) {
    return false
  }
  if (compactId === compactQuery) {
    return true
  }
  return /\d/.test(compactQuery) && compactId.includes(compactQuery)
}

function searchableText(value: string | null) {
  if (!value) {
    return ''
  }
  return value.replace(/<[^>]+>/g, ' ')
}

function looksLikeBillIdQuery(query: string) {
  return /^\d+[a-z]+\d+$/.test(compactAlphanumeric(query))
}

function fuzzyTextMatch(value: string | null, query: string) {
  const haystack = normalizeSearchText(searchableText(value))
  if (!haystack) {
    return false
  }
  const needle = normalizeSearchText(query)
  if (!needle) {
    return true
  }
  if (haystack.includes(needle)) {
    return true
  }
  const tokens = needle.split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
}

function voteMatchesSearch(vote: OfficialVote, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return true
  }
  if (isVotePositionQuery(query)) {
    return (vote.position ?? '').toLowerCase() === query
  }
  if (billIdMatches(vote.bill_id, query)) {
    return true
  }
  if (looksLikeBillIdQuery(query)) {
    return false
  }
  return fuzzyTextMatch(vote.bill_title, query) || fuzzyTextMatch(vote.bill_summary, query)
}

function billFromVote(vote: OfficialVote): Bill {
  return {
    id: vote.bill_id,
    title: vote.bill_title,
    sponsor_id: null,
    sponsor_bioguide_id: null,
    sponsor_name: vote.sponsor_name,
    sponsor_party: null,
    cosponsor_party_breakdown: null,
    bipartisan_type: null,
    policy_area: null,
    summary: vote.bill_summary,
    introduced_date: null,
    voted_date: null,
    votes_summary: { house: {}, senate: {} },
  }
}
