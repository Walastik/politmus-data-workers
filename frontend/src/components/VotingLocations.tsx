import {
  AlertCircle,
  Building2,
  Calendar,
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
  formatCivicAddress,
  getVoterResources,
  type AdminBody,
  type VoterInfo,
  type VoterLocation,
} from '../types'

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
                {error ||
                  voterInfo?.detail ||
                  'We could not reach the voting information service. You can still register to vote or check your status below.'}
              </p>
            </div>
          </div>
        </div>
        <StaticFallback stateCode={stateCode} />
      </div>
    )
  }

  const { uiState } = voterInfo

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
              <div className="flex items-center gap-1.5 text-sm text-slate-300">
                <Calendar className="h-4 w-4 text-slate-400" />
                <span>{voterInfo.election.date}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Registration block displayed whenever registration links exist */}
      <RegistrationBlock adminBodies={voterInfo.adminBodies} />

      {/* Conditional UI based on uiState */}
      {uiState === 'live' && (
        <LiveStateView voterInfo={voterInfo} />
      )}

      {uiState === 'mail_only' && (
        <MailOnlyStateView voterInfo={voterInfo} stateCode={stateCode} />
      )}

      {uiState === 'no_locations_yet' && (
        <NoLocationsYetStateView voterInfo={voterInfo} stateCode={stateCode} />
      )}

      {uiState === 'no_data_yet' && (
        <NoDataYetStateView stateCode={stateCode} />
      )}

      {uiState === 'nearby_only' && (
        <NearbyOnlyStateView voterInfo={voterInfo} stateCode={stateCode} />
      )}

      {uiState === 'election_over' && (
        <ElectionOverStateView stateCode={stateCode} />
      )}

      {uiState === 'no_election' && (
        <NoElectionStateView stateCode={stateCode} />
      )}

      {uiState === 'address_problem' && (
        <AddressProblemStateView stateCode={stateCode} />
      )}

      {/* Contact Cards for election offices */}
      {voterInfo.adminBodies && (voterInfo.adminBodies.local || voterInfo.adminBodies.state) && (
        <ContactCardsSection adminBodies={voterInfo.adminBodies} />
      )}

      {/* Informational Footer */}
      {uiState !== 'address_problem' && <VoterFooter />}
    </div>
  )
}

function LiveStateView({ voterInfo }: { voterInfo: VoterInfo }) {
  const hasPolling = voterInfo.pollingLocations.length > 0
  const hasEarly = voterInfo.earlyVoteSites.length > 0
  const hasDropOff = voterInfo.dropOffLocations.length > 0

  return (
    <div className="space-y-6">
      {hasPolling && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Election Day Polling Places
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {voterInfo.pollingLocations.map((loc, idx) => (
              <LocationCard key={`poll-${idx}`} location={loc} typeLabel="Election Day" />
            ))}
          </div>
        </section>
      )}

      {hasEarly && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Early Voting Sites
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {voterInfo.earlyVoteSites.map((loc, idx) => (
              <LocationCard key={`early-${idx}`} location={loc} typeLabel="Early Voting" />
            ))}
          </div>
        </section>
      )}

      {hasDropOff && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Ballot Drop-off Locations
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {voterInfo.dropOffLocations.map((loc, idx) => (
              <LocationCard key={`drop-${idx}`} location={loc} typeLabel="Drop-off Box" />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MailOnlyStateView({
  voterInfo,
  stateCode,
}: {
  voterInfo: VoterInfo
  stateCode?: string | null
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-800/60 bg-blue-950/30 p-4 text-blue-200">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div>
            <h3 className="font-semibold">Voting by Mail in Your Jurisdiction</h3>
            <p className="mt-1 text-sm text-blue-300/90">
              Voters in this area vote primarily by mail. Ballots are mailed directly
              to registered voters. Completed ballots can be returned by mail or delivered
              to official drop-off locations.
            </p>
          </div>
        </div>
      </div>

      {voterInfo.dropOffLocations.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Ballot Drop-off Locations
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {voterInfo.dropOffLocations.map((loc, idx) => (
              <LocationCard key={`mail-drop-${idx}`} location={loc} typeLabel="Drop-off Box" />
            ))}
          </div>
        </section>
      )}

      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function NoLocationsYetStateView({
  voterInfo,
  stateCode,
}: {
  voterInfo: VoterInfo
  stateCode?: string | null
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-4 text-slate-200">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="font-semibold">
              Polling locations have not yet been assigned
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              An election is scheduled ({voterInfo.election?.name || 'Upcoming Election'}),
              but official polling place assignments have not yet been published for this address.
              Please check back closer to election day or verify with your local election office below.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function NoDataYetStateView({ stateCode }: { stateCode?: string | null }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-4 text-slate-200">
        <div className="flex items-start gap-3">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div>
            <h3 className="font-semibold">
              No voting location data available for this street segment
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Official election authorities have not published polling location records for this
              specific street segment. You can confirm your voter registration and polling details
              directly through your state resources below.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function NearbyOnlyStateView({
  voterInfo: _voterInfo,
  stateCode,
}: {
  voterInfo: VoterInfo
  stateCode?: string | null
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-amber-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="font-semibold">
              Multiple election precincts match this street segment
            </h3>
            <p className="mt-1 text-sm text-amber-300/90">
              Your address sits near precinct boundaries where multiple voting locations apply.
              To avoid casting an incorrect ballot, please confirm your designated polling place
              directly with your local election office.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function ElectionOverStateView({ stateCode }: { stateCode?: string | null }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-4 text-slate-200">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <h3 className="font-semibold">The election has concluded</h3>
            <p className="mt-1 text-sm text-slate-400">
              The scheduled election for this area is over. Keep your voter registration
              current to ensure you are ready for upcoming elections.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function NoElectionStateView({ stateCode }: { stateCode?: string | null }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-4 text-slate-200">
        <div className="flex items-start gap-3">
          <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <h3 className="font-semibold">No upcoming elections found</h3>
            <p className="mt-1 text-sm text-slate-400">
              There are no upcoming elections currently scheduled in the official voting
              database for this address. Use the links below to verify your voter registration
              status with your state.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function AddressProblemStateView({ stateCode }: { stateCode?: string | null }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-red-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <h3 className="font-semibold">Address not recognized</h3>
            <p className="mt-1 text-sm text-red-300/90">
              The election database could not parse or locate this address. Please ensure
              your street address includes the house number, street name, and ZIP code.
            </p>
          </div>
        </div>
      </div>
      <StaticFallback stateCode={stateCode} />
    </div>
  )
}

function RegistrationBlock({
  adminBodies,
}: {
  adminBodies?: { state: AdminBody | null; local: AdminBody | null } | null
}) {
  if (!adminBodies) {
    return null
  }
  const local = adminBodies.local
  const state = adminBodies.state

  const regUrl = local?.electionRegistrationUrl || state?.electionRegistrationUrl
  const confirmUrl =
    local?.electionRegistrationConfirmationUrl || state?.electionRegistrationConfirmationUrl
  const absenteeUrl = local?.absenteeVotingInfoUrl || state?.absenteeVotingInfoUrl
  const finderUrl = local?.votingLocationFinderUrl || state?.votingLocationFinderUrl
  const ballotUrl = local?.ballotInfoUrl || state?.ballotInfoUrl

  if (!regUrl && !confirmUrl && !absenteeUrl && !finderUrl && !ballotUrl) {
    return null
  }

  return (
    <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">
        Official Voter Registration & Information
      </h3>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {regUrl && (
          <a
            href={regUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
          >
            <span>Register to Vote</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {confirmUrl && (
          <a
            href={confirmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-blue-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-blue-300 transition hover:bg-slate-700"
          >
            <span>Check Registration Status</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {absenteeUrl && (
          <a
            href={absenteeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
          >
            <span>Absentee / Mail-in Voting</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {finderUrl && (
          <a
            href={finderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
          >
            <span>Official Location Finder</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
        {ballotUrl && (
          <a
            href={ballotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
          >
            <span>Sample Ballot</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}

function LocationCard({
  location,
  typeLabel,
}: {
  location: VoterLocation
  typeLabel: string
}) {
  const addressParts = [
    location.line1,
    location.city,
    [location.state, location.zip].filter(Boolean).join(' '),
  ].filter(Boolean)
  const fullAddress = addressParts.join(', ')

  const directionsUrl = fullAddress
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`
    : null

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
          <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="whitespace-pre-line">{location.pollingHours}</span>
          </div>
        )}

        {location.notes && (
          <p className="mt-2 text-xs italic text-slate-400">{location.notes}</p>
        )}
      </div>

      {directionsUrl && (
        <div className="mt-4 pt-3 border-t border-slate-700/60">
          <a
            href={directionsUrl}
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

function ContactCardsSection({
  adminBodies,
}: {
  adminBodies: { state: AdminBody | null; local: AdminBody | null }
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Election Administration
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {adminBodies.local && (
          <AdminBodyCard
            body={adminBodies.local}
            roleLabel="Your local election office"
          />
        )}
        {adminBodies.state && (
          <AdminBodyCard
            body={adminBodies.state}
            roleLabel="State election office"
          />
        )}
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
  const resources = getVoterResources(stateCode)

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
        Voter Resources for {resources.name}
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Confirm voter eligibility, register, or check your registration status via official voter portals:
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={resources.registerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-500"
        >
          <span>Register to Vote in {resources.name}</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>

        <a
          href={resources.checkRegistrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          <span>Check Registration (Vote.org)</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>

        <a
          href={resources.voteGovUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          <span>Federal Guide (Vote.gov)</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
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
