import { useState } from 'react'
import {
  AlertCircle,
  Building2,
  Calendar,
  CalendarPlus,
  Clock,
  ExternalLink,
  FileCheck2,
  HelpCircle,
  Mail,
  MapPin,
  Navigation,
  Phone,
} from 'lucide-react'

import {
  buildElectionIcs,
  formatElectionDate,
  googleCalendarUrl,
  type CalendarElection,
} from '@politmus/core/calendar'
import { downloadIcs } from '../downloadIcs'
import { splitPollingHours } from '@politmus/core/pollingHours'
import {
  formatCivicAddress,
  getVoterResources,
  type AdminBodies,
  type AdminBody,
  type VoterInfo,
  type VoterLocation,
} from '@politmus/core/types'
import {
  INITIAL_LOCATIONS_SHOWN,
  UNAVAILABLE_MESSAGE,
  earlyVotingDates,
  electionOffices,
  locationGroups,
  registrationLinks,
  showStaticFallback,
  staticFallback,
  votingNotice,
  type NoticeIcon,
  type NoticeTone,
  type VotingNotice,
} from '@politmus/core/votingInfo'
import { directionsUrl, locationAddress } from '@politmus/core/votingSites'

interface VotingLocationsProps {
  voterInfo: VoterInfo | null
  loading: boolean
  error?: string | null
  stateCode?: string | null
}

export default function VotingLocations({
  voterInfo,
  loading,
  error = null,
  stateCode,
}: VotingLocationsProps) {
  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400" aria-live="polite" role="status">
        <p>Loading voting and polling location information…</p>
      </div>
    )
  }

  if (error || !voterInfo || voterInfo.uiState === 'unavailable') {
    return (
      <div className="space-y-6" aria-live="polite">
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <h3 className="font-semibold">
                Live voting location lookup is currently unavailable
              </h3>
              <p className="mt-1 text-sm text-amber-300/90">
                {error || voterInfo?.detail || UNAVAILABLE_MESSAGE}
              </p>
            </div>
          </div>
        </div>
        <StaticFallback stateCode={stateCode} />
      </div>
    )
  }

  const notice = votingNotice(voterInfo, stateCode)
  const groups = locationGroups(voterInfo)
  const fallback = showStaticFallback(voterInfo)

  return (
    <div className="space-y-8" aria-live="polite">
      {voterInfo.election && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                Election
              </span>
              <h2 className="text-lg font-bold text-slate-100">
                {voterInfo.election.name}
              </h2>
            </div>
            {voterInfo.election.date && (
              <ElectionDate
                election={{ ...voterInfo.election, date: voterInfo.election.date }}
                stateCode={stateCode}
              />
            )}
          </div>
          <EarlyVotingDates voterInfo={voterInfo} stateCode={stateCode} />
        </div>
      )}

      {/* Registration block displayed whenever registration links exist */}
      <RegistrationBlock adminBodies={voterInfo.adminBodies} />

      {notice || groups.length > 0 || fallback ? (
        <div className="space-y-6">
          {notice ? <Notice notice={notice} /> : null}
          {groups.map((group) => (
            <LocationSection
              key={group.title}
              electionDate={voterInfo.election?.date}
              title={group.title}
              locations={group.locations}
              typeLabel={group.typeLabel}
            />
          ))}
          {fallback ? <StaticFallback stateCode={stateCode} /> : null}
        </div>
      ) : null}

      {/* Contact Cards for election offices */}
      {electionOffices(voterInfo.adminBodies).length > 0 && (
        <ContactCardsSection adminBodies={voterInfo.adminBodies} />
      )}

      {/* Informational Footer */}
      {voterInfo.uiState !== 'address_problem' && <VoterFooter />}
    </div>
  )
}

const NOTICE_TONES: Record<NoticeTone, { box: string; body: string }> = {
  info: { box: 'border-blue-800/60 bg-blue-950/30 text-blue-200', body: 'text-blue-300/90' },
  warning: { box: 'border-amber-800/60 bg-amber-950/30 text-amber-200', body: 'text-amber-300/90' },
  error: { box: 'border-red-900/60 bg-red-950/30 text-red-200', body: 'text-red-300/90' },
  neutral: { box: 'border-slate-700 bg-slate-800/80 text-slate-200', body: 'text-slate-400' },
  done: { box: 'border-slate-700 bg-slate-800/80 text-slate-200', body: 'text-slate-400' },
}

const NOTICE_ICONS: Record<NoticeIcon, typeof Mail> = {
  mail: Mail,
  clock: Clock,
  help: HelpCircle,
  alert: AlertCircle,
  check: FileCheck2,
  calendar: Calendar,
}

// Icon colour by notice; an alert is red on an error and amber otherwise.
function noticeIconClass(notice: VotingNotice) {
  if (notice.tone === 'error') return 'text-red-400'
  return { mail: 'text-blue-400', clock: 'text-amber-400', help: 'text-blue-400', alert: 'text-amber-400', check: 'text-emerald-400', calendar: 'text-slate-400' }[notice.icon]
}

// Why there are no live sites to list, with the official lookup when known.
function Notice({ notice }: { notice: VotingNotice }) {
  const tone = NOTICE_TONES[notice.tone]
  const Icon = NOTICE_ICONS[notice.icon]
  return (
    <div className={`rounded-lg border p-4 ${tone.box}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${noticeIconClass(notice)}`} />
        <div>
          <h3 className="font-semibold">{notice.title}</h3>
          <p className={`mt-1 text-sm ${tone.body}`}>{notice.body}</p>
          {notice.action && (
            <a
              href={notice.action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{notice.action.label}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function LocationSection({
  title,
  locations,
  typeLabel,
  electionDate,
}: {
  title: string
  locations: VoterLocation[]
  typeLabel: string
  electionDate?: string | null
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? locations : locations.slice(0, INITIAL_LOCATIONS_SHOWN)
  const hiddenCount = locations.length - visible.length

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        {title}
        {locations.length > INITIAL_LOCATIONS_SHOWN && (
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
            ({locations.length})
          </span>
        )}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((loc, idx) => (
          <LocationCard key={idx} location={loc} typeLabel={typeLabel} electionDate={electionDate} />
        ))}
      </div>
      {locations.length > INITIAL_LOCATIONS_SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-3 text-sm font-semibold text-blue-400 hover:text-blue-300"
        >
          {showAll ? 'Show fewer' : `Show all ${locations.length} (${hiddenCount} more)`}
        </button>
      )}
    </section>
  )
}

// Rendered inside the Election card. Statewide dates only; counties pick the
// sites and daily hours. Hidden when the Civic API already lists early-voting
// sites, which carry their own dates.
function EarlyVotingDates({
  voterInfo,
  stateCode,
}: {
  voterInfo: VoterInfo
  stateCode?: string | null
}) {
  const dates = earlyVotingDates(voterInfo, stateCode)
  if (!dates) return null

  return (
    <section className="mt-4 border-t border-slate-700 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">
            Early Voting in {dates.stateName}
          </h3>
          <p className="mt-1 text-lg font-bold text-slate-100">{dates.range}</p>
        </div>
        <span
          className={
            dates.open
              ? 'rounded bg-emerald-900/60 px-2 py-0.5 text-xs font-semibold text-emerald-300'
              : 'rounded bg-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-300'
          }
        >
          {dates.status}
        </span>
      </div>
      {dates.note && <p className="mt-2 text-sm text-slate-300">{dates.note}</p>}
      <p className="mt-2 text-xs text-slate-500">
        Statewide dates. Your county sets the sites and daily hours. Source:{' '}
        <a
          href={dates.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 underline hover:text-blue-300"
        >
          {dates.sourceName}
        </a>
      </p>
    </section>
  )
}

function ElectionDate({
  election,
  stateCode,
}: {
  election: CalendarElection
  stateCode?: string | null
}) {
  const resources = getVoterResources(stateCode)
  const infoUrl = resources.pollingPlaceUrl ?? resources.voteGovUrl
  const ics = buildElectionIcs(election, { infoUrl })
  const googleUrl = googleCalendarUrl(election, { infoUrl })
  const label = formatElectionDate(election.date)

  if (!ics) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-slate-300">
        <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={() => downloadIcs(`election-${election.date}.ics`, ics)}
        className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-200 transition hover:border-blue-500 hover:text-blue-300"
        aria-label={`${label}: add to calendar with reminders`}
      >
        <CalendarPlus className="h-4 w-4 text-blue-400" aria-hidden="true" />
        <span>{label}</span>
      </button>
      <p className="text-xs text-slate-500">
        Adds reminders at 9 am the day before and 8 am on Election Day.
        {googleUrl && (
          <>
            {' '}
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 underline hover:text-blue-300"
            >
              Google Calendar
            </a>{' '}
            (uses your default reminders)
          </>
        )}
      </p>
    </div>
  )
}

function RegistrationBlock({ adminBodies }: { adminBodies?: AdminBodies | null }) {
  const links = registrationLinks(adminBodies)
  if (links.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">
        Official Voter Registration & Information
      </h3>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition ${REGISTRATION_LINK_CLASSES[link.style]}`}
          >
            <span>{link.label}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ))}
      </div>
    </div>
  )
}

const REGISTRATION_LINK_CLASSES = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  accent: 'border border-blue-700 bg-slate-800 text-blue-300 hover:bg-slate-700',
  plain: 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
}

function PollingHours({ hours, electionDate }: { hours: string; electionDate?: string | null }) {
  const { upcoming, passed } = splitPollingHours(hours, { electionDate })

  return (
    <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      <div className="min-w-0">
        {upcoming.length > 0 ? (
          <ul>
            {upcoming.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="italic text-slate-500">No upcoming hours listed for this site.</p>
        )}
        {passed.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
              Passed dates ({passed.length})
            </summary>
            <ul className="mt-1 text-slate-500">
              {passed.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function LocationCard({
  location,
  typeLabel,
  electionDate,
}: {
  location: VoterLocation
  typeLabel: string
  electionDate?: string | null
}) {
  const fullAddress = locationAddress(location)
  const directions = directionsUrl(location)

  return (
    <div className="flex flex-col justify-between rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300">
            {typeLabel}
          </span>
          {location.startDate && location.endDate && (
            <span className="text-xs text-slate-400">
              {location.startDate} – {location.endDate}
            </span>
          )}
        </div>

        <h4 className="mt-2 text-base font-semibold text-slate-100">
          {location.locationName || 'Polling Location'}
        </h4>

        {fullAddress && (
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-300">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{fullAddress}</span>
          </div>
        )}

        {location.pollingHours && (
          <PollingHours hours={location.pollingHours} electionDate={electionDate} />
        )}

        {location.notes && (
          <p className="mt-2 text-xs italic text-slate-400">{location.notes}</p>
        )}
      </div>

      {directions && (
        <div className="mt-4 pt-3 border-t border-slate-700/60">
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Directions</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  )
}

function ContactCardsSection({ adminBodies }: { adminBodies: AdminBodies }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Election Administration
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {electionOffices(adminBodies).map(({ body, role }) => (
          <AdminBodyCard key={role} body={body} roleLabel={role} />
        ))}
      </div>
    </section>
  )
}

function AdminBodyCard({
  body,
  roleLabel,
}: {
  body: AdminBody
  roleLabel: string
}) {
  const addressStr = formatCivicAddress(body.physicalAddress)

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">
        {roleLabel}
      </span>
      <h4 className="mt-1 text-base font-semibold text-slate-100">
        {body.name || roleLabel}
      </h4>

      <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
        {addressStr && (
          <li className="flex items-start gap-1.5">
            <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{addressStr}</span>
          </li>
        )}
        {body.hoursOfOperation && (
          <li className="flex items-start gap-1.5">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="whitespace-pre-line">{body.hoursOfOperation}</span>
          </li>
        )}
        {body.phone && (
          <li className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <a href={`tel:${body.phone}`} className="hover:text-blue-400">
              {body.phone}
            </a>
          </li>
        )}
        {body.email && (
          <li className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <a href={`mailto:${body.email}`} className="hover:text-blue-400">
              {body.email}
            </a>
          </li>
        )}
      </ul>

      {body.electionInfoUrl && (
        <div className="mt-3 pt-2 border-t border-slate-700/60">
          <a
            href={body.electionInfoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            <span>Official Website</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  )
}

function StaticFallback({ stateCode }: { stateCode?: string | null }) {
  const fallback = staticFallback(stateCode)
  const primaryClass =
    'inline-flex items-center gap-1.5 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-500'
  const secondaryClass =
    'inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700'

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{fallback.title}</h3>
      <p className="mt-1 text-xs text-slate-400">{fallback.intro}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        {fallback.links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={link.primary ? primaryClass : secondaryClass}
          >
            <span>{link.label}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ))}
      </div>

      {fallback.portalNote && (
        <p className="mt-3 text-xs text-slate-500">
          {fallback.portalNote.lead}
          <span className="font-medium text-slate-400">{fallback.portalNote.hosts}</span>
          {fallback.portalNote.tail}
        </p>
      )}
    </div>
  )
}

function VoterFooter() {
  return (
    <footer className="pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
      <p>
        Polling places can change. Confirm with your local election office before you go.
      </p>
      <p className="mt-1">
        Voting information powered by the Civic Information API.
      </p>
    </footer>
  )
}
