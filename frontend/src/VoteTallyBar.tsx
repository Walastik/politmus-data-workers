import {
  partyBadgeClass,
  partyShort,
  sortParties,
  type Bill,
  type BillVotePartySummary,
  type ChamberVoteSummary,
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
  party,
  summary,
}: {
  party: string
  summary: ChamberVoteSummary
}) {
  const yes = summary.Yes ?? 0
  const no = summary.No ?? 0
  const recorded = yes + no
  const yesPct = recorded === 0 ? 0 : (yes / recorded) * 100
  const noPct = recorded === 0 ? 0 : (no / recorded) * 100

  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-5 shrink-0 rounded px-1 py-px text-center text-[10px] font-semibold ${partyBadgeClass(party)}`}
      >
        {partyShort(party)}
      </span>
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
  summary,
  byParty,
}: {
  label: string
  summary: ChamberVoteSummary | undefined
  byParty: Record<string, ChamberVoteSummary> | undefined
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
            <PartyTally key={party} party={party} summary={byParty?.[party] || {}} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function VoteTallyBar({
  summary,
  byParty,
}: {
  summary: Bill['votes_summary']
  byParty?: BillVotePartySummary
}) {
  const house = summary?.house
  const senate = summary?.senate
  if (voteTotal(summary) === 0) {
    return <p className="text-xs text-slate-500">No recorded votes</p>
  }

  return (
    <div className="space-y-3">
      <ChamberTally label="House" summary={house} byParty={byParty?.house} />
      <ChamberTally label="Senate" summary={senate} byParty={byParty?.senate} />
      <p className="text-[10px] text-slate-600">
        Latest roll call stored for each chamber
      </p>
    </div>
  )
}
