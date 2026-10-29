import { ChevronRight, Globe, Phone } from 'lucide-react'
import type { ReactNode } from 'react'

import { ScoreChip } from './components/MemberCard'
import OfficialPhoto from './components/OfficialPhoto'
import ScoreHeadline from './components/ScoreHeadline'

import {
  lookupSections,
  representativeDistrict,
  representativeKey,
  representativeState,
  websiteLabel,
} from '@politmus/core/representatives'
import {
  civicRepresentativeToOfficial,
  isCivicStateLevel,
  officialName,
  partyBadgeClass,
  partyShort,
  type CivicLookup,
  type CivicRepresentative,
  type Official,
} from '@politmus/core/types'

// Everyone who represents a looked-up place: Congress first, then the state.
export default function LookupResults({
  lookup,
  onSelectOfficial,
}: {
  lookup: CivicLookup
  onSelectOfficial: (official: Official) => void
}) {
  const { fallbackState, federal, state, other } = lookupSections(lookup)

  return (
    <div className="space-y-10">
      <OfficeSection
        title="In Washington"
        description="Your two U.S. senators and your member of the House. Their Politmus Score compares how they vote with what they say they stand for."
      >
        {federal.length ? (
          <RepresentativeGrid
            representatives={federal}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        ) : (
          <p className="text-sm text-slate-500">No members of Congress found for this address.</p>
        )}
      </OfficeSection>

      {state.length ? (
        <OfficeSection
          title={`In ${fallbackState || 'your state'}`}
          description="Your governor and state legislators. We don’t score state officials yet."
        >
          <RepresentativeGrid
            representatives={state}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}

      {other.length ? (
        <OfficeSection title="Other offices">
          <RepresentativeGrid
            representatives={other}
            fallbackState={fallbackState}
            onSelectOfficial={onSelectOfficial}
          />
        </OfficeSection>
      ) : null}
    </div>
  )
}

// One line per federal member, for a quick look on other pages.
export function FederalRepsStrip({
  lookup,
  onSelectOfficial,
}: {
  lookup: CivicLookup
  onSelectOfficial: (official: Official) => void
}) {
  const { fallbackState, federal } = lookupSections(lookup)
  if (federal.length === 0) return null
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {federal.map((rep) => {
        const official = civicRepresentativeToOfficial(rep, representativeState(rep, fallbackState))
        const name = officialName(rep)
        return (
          <li key={representativeKey(rep)}>
            <button
              type="button"
              disabled={!official}
              onClick={() => official && onSelectOfficial(official)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left transition hover:border-slate-500 disabled:cursor-default"
            >
              <OfficialPhoto url={rep.photo_url} name={name} party={rep.party} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-100">{name}</span>
                <span className="block truncate text-[11px] text-slate-400">
                  {rep.party ? `${partyShort(rep.party)} · ` : ''}
                  {rep.office}
                </span>
              </span>
              <ScoreChip official={rep} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function OfficeSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      <div className="mt-4">{children}</div>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {representatives.map((representative) => (
        <RepresentativeCard
          key={representativeKey(representative)}
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
  const stateLabel = representativeState(representative, fallbackState)
  const official = civicRepresentativeToOfficial(representative, stateLabel)
  const name = officialName(representative)
  const district = representativeDistrict(representative)

  return (
    <article className="flex h-full flex-col rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <OfficialPhoto url={representative.photo_url} name={name} party={party} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {party ? (
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${partyBadgeClass(party)}`}>
                {partyShort(party)}
              </span>
            ) : null}
            <span>{name}</span>
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {representative.office}
            {district ? ` · ${district}` : stateLabel ? ` · ${stateLabel}` : ''}
          </p>
        </div>
      </div>

      {isCivicStateLevel(representative) ? null : (
        <ScoreHeadline
          points={representative.score_points}
          pct={representative.score_pct}
          matches={representative.score_matches}
        />
      )}
      {!isCivicStateLevel(representative) && representative.score_matches == null ? (
        <p className="mt-3 text-[11px] text-slate-500">Politmus Score: no stated positions to score yet</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3 text-xs">
        {phone ? (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 text-slate-300 hover:text-blue-300">
            <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {phone}
          </a>
        ) : null}
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1.5 text-slate-300 hover:text-blue-300"
          >
            <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{websiteLabel(website)}</span>
          </a>
        ) : null}
        {official ? (
          <button
            type="button"
            onClick={() => onSelectOfficial(official)}
            aria-label={`Full profile: ${name}`}
            className="ml-auto inline-flex items-center gap-0.5 font-semibold text-blue-400 hover:text-blue-300"
          >
            Full profile
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  )
}
