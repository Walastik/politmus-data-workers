import { LocateFixed, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { canUseGeolocation, suggestAddresses, type PhotonResult } from '../geo'
import { useCivicLocation } from '../useCivicLocation'

// Address box with suggestions and a "Use my location" button. Sets the app's
// shared location; `onDone` runs once one is set (e.g. to leave the landing page).
export default function LocationPicker({
  submitLabel = 'Show my area',
  initial = '',
  onDone,
  onCancel,
  autoFocus = false,
}: {
  submitLabel?: string
  initial?: string
  onDone?: () => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const { setAddress, locateMe, locating, locationError } = useCivicLocation()
  const [value, setValue] = useState(initial)
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const query = useDebounce(value.trim(), 300)

  useEffect(() => {
    if (!query || query === initial.trim()) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    suggestAddresses(query, controller.signal)
      .then(setSuggestions)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error('Photon lookup failed', err)
      })
    return () => controller.abort()
  }, [query, initial])

  function choose(address: string) {
    setShowSuggestions(false)
    if (!address.trim()) return
    setAddress(address)
    onDone?.()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    choose(value)
  }

  async function useLocation() {
    setShowSuggestions(false)
    if (await locateMe()) onDone?.()
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" role="search">
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
            autoFocus={autoFocus}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="1100 Congress Ave, Austin, TX 78701"
            className="w-full rounded-md border border-slate-700 bg-slate-800 py-2.5 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          {showSuggestions && suggestions.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-700 bg-slate-800 text-left shadow-lg">
              {suggestions.map((suggestion, index) => (
                <li
                  key={index}
                  className="cursor-pointer px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setValue(suggestion.formattedAddress)
                    choose(suggestion.formattedAddress)
                  }}
                >
                  {suggestion.formattedAddress}
                </li>
              ))}
            </ul>
          ) : null}
        </label>
        {canUseGeolocation() ? (
          <button
            type="button"
            onClick={useLocation}
            disabled={locating}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            {locating ? 'Locating…' : 'Use my location'}
          </button>
        ) : null}
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
        ) : null}
      </form>
      {locationError ? <p className="mt-2 text-sm text-red-400">{locationError}</p> : null}
      <p className="mt-2 text-xs text-slate-500">
        Addresses go to the Census geocoder and Google’s Civic Information API to find your districts and
        voting sites. Your device location is only used to look these up.
      </p>
    </div>
  )
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
