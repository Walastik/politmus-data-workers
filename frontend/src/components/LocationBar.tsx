import { SignInButton, SignedOut } from '@clerk/clerk-react'
import { Check, MapPinHouse, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useCivicLocation } from '../useCivicLocation'
import LocationPicker from './LocationPicker'

// Which place a page is showing, with Change and Save; the address prompt when
// there is no place yet.
export default function LocationBar({
  prompt,
  submitLabel,
  detail,
}: {
  prompt: string
  submitLabel: string
  // Extra context after the address, such as the House district.
  detail?: ReactNode
}) {
  const location = useCivicLocation()
  const [editing, setEditing] = useState(false)

  if (!location.place || editing) {
    return (
      <section className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-4">
        {location.place ? null : <p className="mb-3 text-sm text-slate-300">{prompt}</p>}
        <LocationPicker
          submitLabel={submitLabel}
          initial={editing ? location.address ?? '' : ''}
          autoFocus={editing}
          onDone={() => setEditing(false)}
          onCancel={location.place ? () => setEditing(false) : undefined}
        />
      </section>
    )
  }

  const unsaved = location.place.kind === 'address' && !location.isSaved
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
      <span className="inline-flex items-center gap-1.5">
        <MapPinHouse className="h-4 w-4 text-slate-500" aria-hidden="true" />
        For <span className="font-medium text-slate-200">{location.label}</span>
        {detail ? <span className="text-slate-500">· {detail}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        Change
      </button>
      {unsaved && location.canSave ? (
        <button
          type="button"
          onClick={location.saveAddress}
          disabled={location.saving}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-60"
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {location.saving ? 'Saving…' : 'Save as my address'}
        </button>
      ) : null}
      {unsaved ? (
        <SignedOut>
          <SignInButton mode="modal">
            <button type="button" className="text-xs font-semibold text-slate-400 hover:text-blue-300">
              Sign in to save this address
            </button>
          </SignInButton>
        </SignedOut>
      ) : null}
    </div>
  )
}
