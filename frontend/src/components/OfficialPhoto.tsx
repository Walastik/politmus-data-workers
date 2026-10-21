import { useState } from 'react'

import { initials, partyBadgeClass } from '../types'

const SIZE_CLASS = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-xl',
} as const

// Congress.gov portraits are hotlinked; a missing or broken image falls back
// to the member's initials on their party color.
export default function OfficialPhoto({
  url,
  name,
  party,
  attribution,
  size = 'md',
}: {
  url?: string | null
  name: string
  party?: string | null
  attribution?: string | null
  size?: keyof typeof SIZE_CLASS
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const frame = `${SIZE_CLASS[size]} shrink-0 overflow-hidden rounded-full ring-2 ${partyRingClass(party)}`

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt={name ? `Portrait of ${name}` : 'Portrait'}
        title={attribution ?? undefined}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={`${frame} bg-slate-800 object-cover object-top`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`${frame} flex items-center justify-center font-semibold ${partyBadgeClass(party ?? '')}`}
    >
      {initials(name)}
    </span>
  )
}

function partyRingClass(party?: string | null) {
  if (party === 'Democratic' || party === 'D') return 'ring-blue-500/50'
  if (party === 'Republican' || party === 'R') return 'ring-red-500/50'
  return 'ring-emerald-500/50'
}
