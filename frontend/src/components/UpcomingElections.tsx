import { CalendarPlus, Vote } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import { buildElectionIcs, downloadIcs, formatElectionDate } from '../calendar'
import { daysUntil } from '../feed'
import type { UpcomingElection } from '../types'

function countdownLabel(days: number | null) {
  if (days === null) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

// "Coming up" strip at the top of the feed: the next real elections nationwide.
export default function UpcomingElections() {
  const [elections, setElections] = useState<UpcomingElection[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(apiUrl('/api/feed/upcoming'), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load elections (${res.status})`)
        }
        return res.json() as Promise<{ elections: UpcomingElection[] }>
      })
      .then((data) => setElections(Array.isArray(data.elections) ? data.elections : []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        // The strip is a bonus; the feed below still works without it.
        setElections([])
      })
    return () => controller.abort()
  }, [])

  if (!elections || elections.length === 0) {
    return null
  }

  return (
    <section aria-labelledby="coming-up-heading">
      <h2
        id="coming-up-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        Coming up
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {elections.map((election) => {
          const dated = election.date
            ? { id: election.id, name: election.name, date: election.date }
            : null
          const ics = dated ? buildElectionIcs(dated) : null
          return (
            <article
              key={election.id}
              className="rounded-lg border border-slate-700 bg-slate-800 p-4"
            >
              <div className="flex items-start gap-2">
                <Vote className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold leading-snug">{election.name}</h3>
              </div>
              {dated ? (
                <p className="mt-1 text-xs text-slate-400">
                  {formatElectionDate(dated.date)}
                  {' · '}
                  <span className="font-semibold text-slate-200">
                    {countdownLabel(daysUntil(dated.date))}
                  </span>
                </p>
              ) : null}
              {dated && ics ? (
                <button
                  type="button"
                  onClick={() => downloadIcs(`election-${dated.date}.ics`, ics)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
                  aria-label={`Add ${election.name} to calendar`}
                >
                  <CalendarPlus className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                  Add to calendar
                </button>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
