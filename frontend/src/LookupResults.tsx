import { Globe, Phone } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  civicRepresentativeToOfficial,
  formatCivicAddress,
  groupCivicRepresentatives,
  partyBadgeClass,
  partyShort,
  stateNameFromAbbr,
  type CivicLookup,
  type CivicRepresentative,
  type Official,
} from './types'

export default function LookupResults({
  lookup,
  onSelectOfficial,
}: {
  lookup: CivicLookup
  onSelectOfficial: (official: Official) => void
}) {
  const grouped = groupCivicRepresentatives(lookup.representatives)
  const matchedAddress = formatCivicAddress(lookup.normalized_input)
  const fallbackState = stateNameFromAbbr(lookup.normalized_input?.state)

  return (
    <div>
      {matchedAddress ? (
        <p className="mb-8 text-sm text-slate-400">
          Showing representation for{' '}
          <span className="text-slate-200">{matchedAddress}</span>
        </p>
      ) : null}

      <OfficeSection title="United States Senate">
        {grouped.senators.length ? (
          <RepresentativeGrid
            representatives={grouped.senators}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        ) : (
          <p className="text-sm text-slate-500">
            No senators found for this address.
          </p>
        )}
      </OfficeSection>

      <OfficeSection title="House of Representatives">
        {grouped.house.length ? (
          <RepresentativeGrid
            representatives={grouped.house}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        ) : (
          <p className="text-sm text-slate-500">
            No House member found for this address.
          </p>
        )}
      </OfficeSection>

      {grouped.governors.length ? (
        <OfficeSection title="Governor">
          <RepresentativeGrid
            representatives={grouped.governors}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}

      {grouped.stateSenators.length ? (
        <OfficeSection title="State Senate">
          <RepresentativeGrid
            representatives={grouped.stateSenators}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}

      {grouped.stateHouse.length ? (
        <OfficeSection title="State House">
          <RepresentativeGrid
            representatives={grouped.stateHouse}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}

      {grouped.other.length ? (
        <OfficeSection title="Other offices">
          <RepresentativeGrid
            representatives={grouped.other}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}
    </div>
  )
}

function OfficeSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  )
}

function RepresentativeGrid({
  representatives,
  fallbackState,
  onSelectOfficial,
}: {
  representatives: CivicRepresentative[]
  fallbackState: string
  onSelectOfficial: (official: Official) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {representatives.map((representative) => (
        <RepresentativeCard
          key={`${representative.id ?? representative.name}-${representative.office}`}
          representative={representative}
          fallbackState={fallbackState}
          onSelectOfficial={onSelectOfficial}
        />
      ))}
    </div>
  )
}

function RepresentativeCard({
  representative,
  fallbackState,
  onSelectOfficial,
}: {
  representative: CivicRepresentative
  fallbackState: string
  onSelectOfficial: (official: Official) => void
}) {
  const party = representative.party || ''
  const phone = representative.phones[0]
  const website = representative.urls[0]
  const stateLabel = officialState(representative, fallbackState)
  const official = civicRepresentativeToOfficial(representative, stateLabel)

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        {party ? (
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${partyBadgeClass(party)}`}
          >
            {partyShort(party)}
          </span>
        ) : (
          <span />
        )}
        {stateLabel ? (
          <span className="text-xs text-slate-400">{stateLabel}</span>
        ) : null}
      </div>
      <h3 className="mt-2 text-base font-semibold">{representative.name}</h3>
      <p className="mt-1 text-xs text-slate-400">
        {representative.office}
        {representative.division_name &&
        (representative.division_id?.includes('/cd:') ||
          representative.division_id?.includes('/sldu:') ||
          representative.division_id?.includes('/sldl:'))
          ? ` · ${representative.division_name}`
          : ''}
      </p>
      {phone || website ? (
        <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
          {phone ? (
            <li className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{phone}</span>
            </li>
          ) : null}
          {website ? (
            <li className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{websiteLabel(website)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  )

  if (!official) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelectOfficial(official)}
      className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80"
    >
      {content}
    </button>
  )
}

function officialState(
  representative: CivicRepresentative,
  fallbackState: string,
) {
  if (
    representative.division_name &&
    !representative.division_id?.includes('/cd:') &&
    !representative.division_id?.includes('/sldu:') &&
    !representative.division_id?.includes('/sldl:')
  ) {
    return representative.division_name
  }
  return fallbackState
}

function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
