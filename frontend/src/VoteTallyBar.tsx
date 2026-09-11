import {
  partyBadgeClass,
  partyShort,
  sortParties,
  type Bill,
  type BillVotePartySummary,
  type ChamberVoteSummary,
  type VoteChamber,
} from './types'

function chamberTotal(summary: ChamberVoteSummary | undefined) {
  if (!summary) {
    return 0
  }
  return Object.values(summary).reduce((sum: number, count) => sum + (count ?? 0), 0)
}

export function voteTotal(summary: Bill['votes_summary'] | undefined) {
  if (!summary) {
    return 0
  }
  return chamberTotal(summary.house) + chamberTotal(summary.senate)
}

function PartyTally({
  chamber,
  party,
  summary,
  onPartyClick,
}: {
  chamber: VoteChamber
  party: string
  summary: ChamberVoteSummary
  onPartyClick?: (chamber: VoteChamber, party: string) => void
}) {
  const yes = summary.Yes ?? 0
  const no = summary.No ?? 0
  const recorded = yes + no
  const yesPct = recorded === 0 ? 0 : (yes / recorded) * 100
  const noPct = recorded === 0 ? 0 : (no / recorded) * 100
  const badge = (
    <span
      className={`w-5 shrink-0 rounded px-1 py-px text-center text-[10px] font-semibold ${partyBadgeClass(party)}`}
    >
      {partyShort(party)}
    </span>
  )

  return (
    <div className="flex items-center gap-2">
      {onPartyClick ? (
        <button
          type="button"
          onClick={() => onPartyClick(chamber, party)}
          className="rounded hover:ring-1 hover:ring-slate-400"
          aria-label={`Show ${party} ${chamber} votes`}
        >
          {badge}
        </button>
      ) : (
        badge
      )}
      <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-slate-700">
        <div className="bg-emerald-500" style={{ width: `${yesPct}%` }} />
        <div className="bg-red-500" style={{ width: `${noPct}%` }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
        <span className="text-emerald-400">{yes}Y</span>
        {' · '}
        <span className="text-red-400">{no}N</span>
      </span>
    </div>
  )
}

function ChamberTally({
  label,
  chamber,
  summary,
  byParty,
  onPartyClick,
}: {
  label: string
  chamber: VoteChamber
  summary: ChamberVoteSummary | undefined
  byParty: Record<string, ChamberVoteSummary> | undefined
  onPartyClick?: (chamber: VoteChamber, party: string) => void
}) {
  const yes = summary?.Yes ?? 0
  const no = summary?.No ?? 0
  const present = summary?.Present ?? 0
  const notVoting = summary?.['Not Voting'] ?? 0
  const recorded = yes + no
  const total = recorded + present + notVoting
  const parties = sortParties(Object.keys(byParty || {})).filter(
    (party) => chamberTotal(byParty?.[party]) > 0,
  )

  if (total === 0) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <p className="mt-1 text-xs text-slate-500">No recorded votes</p>
      </div>
    )
  }

  const yesPct = recorded === 0 ? 0 : (yes / recorded) * 100
  const noPct = recorded === 0 ? 0 : (no / recorded) * 100

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded bg-slate-700">
        <div className="bg-emerald-500" style={{ width: `${yesPct}%` }} />
        <div className="bg-red-500" style={{ width: `${noPct}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="text-emerald-400">{yes} Yes</span>
        <span className="text-red-400">{no} No</span>
        {present > 0 ? <span>{present} Present</span> : null}
        {notVoting > 0 ? <span>{notVoting} NV</span> : null}
      </div>
      {parties.length > 0 ? (
        <div className="mt-2 space-y-1">
          {parties.map((party) => (
            <PartyTally
              key={party}
              chamber={chamber}
              party={party}
              summary={byParty?.[party] || {}}
              onPartyClick={onPartyClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function VoteTallyBar({
  summary,
  byParty,
  onPartyClick,
}: {
  summary: Bill['votes_summary']
  byParty?: BillVotePartySummary
  onPartyClick?: (chamber: VoteChamber, party: string) => void
}) {
  const house = summary?.house
  const senate = summary?.senate
  if (voteTotal(summary) === 0) {
    return <p className="text-xs text-slate-500">No recorded votes</p>
  }

  return (
    <div className="space-y-3">
      <ChamberTally
        label="House"
        chamber="house"
        summary={house}
        byParty={byParty?.house}
        onPartyClick={onPartyClick}
      />
      <ChamberTally
        label="Senate"
        chamber="senate"
        summary={senate}
        byParty={byParty?.senate}
        onPartyClick={onPartyClick}
      />
      <p className="text-[10px] text-slate-600">
        Latest roll call stored for each chamber
      </p>
    </div>
  )
}
