import { Search } from 'lucide-react'
import { useState, useEffect, type FormEvent } from 'react'

import { apiUrl } from './api'
import LookupResults from './LookupResults'
import MemberDrawer from './MemberDrawer'
import type { CivicLookup, Official } from './types'

export default function AddressLookup() {
  const [address, setAddress] = useState('')
  const [lookup, setLookup] = useState<CivicLookup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedOfficial, setSelectedOfficial] = useState<Official | null>(null)
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false)

  // Extract fetch logic into a standalone function
  async function performLookup(targetAddress: string) {
    if (!targetAddress.trim()) {
      setError('Enter a U.S. street address.')
      setLookup(null)
      return
    }

    setLoading(true)
    setError(null)
    setSelectedOfficial(null)

    try {
      const response = await fetch(
        apiUrl(`/api/lookup?address=${encodeURIComponent(targetAddress)}`),
      )
      const body = await readJson(response)
      if (!response.ok) {
        throw new Error(apiDetail(body, `Lookup failed (${response.status})`))
      }
      setLookup(body as CivicLookup)
    } catch (err: unknown) {
      console.error(err)
      setLookup(null)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not look up that address. Try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await performLookup(address)
  }

  // Auto-load saved address when component mounts
  useEffect(() => {
    // We'll use a simple approach to get user data
    const fetchUserAddress = async () => {
      try {
        // This is a simplified version - in practice, you'd want to properly 
        // integrate with Clerk's user context
        const savedAddress = localStorage.getItem('savedAddress') || ''
        if (savedAddress && !hasAutoLoaded) {
          setHasAutoLoaded(true)
          await performLookup(savedAddress)
        }
      } catch (err) {
        console.error('Failed to auto-load address:', err)
      }
    }

    fetchUserAddress()
  }, [hasAutoLoaded])

  return (
    <div>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row"
        role="search"
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Street address</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="text"
            name="address"
            autoComplete="street-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1600 Pennsylvania Avenue NW, Washington, DC"
            className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Looking up…' : 'Find representatives'}
        </button>
      </form>

      <div className="mt-8" aria-live="polite">
        {error ? <p className="text-red-400">{error}</p> : null}
        {loading && !lookup ? (
          <p className="text-slate-400">Looking up that address…</p>
        ) : null}
        {lookup ? (
          <LookupResults
            lookup={lookup}
            onSelectOfficial={setSelectedOfficial}
          />
        ) : null}
      </div>

      {selectedOfficial ? (
        <MemberDrawer
          official={selectedOfficial}
          onClose={() => setSelectedOfficial(null)}
        />
      ) : null}
    </div>
  )
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function apiDetail(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object' || !('detail' in body)) {
    return fallback
  }
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
    const first = detail[0] as { msg?: unknown }
    if (typeof first.msg === 'string' && first.msg.trim()) {
      return first.msg
    }
  }
  return fallback
}
