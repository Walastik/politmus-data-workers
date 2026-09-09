import type { Bill, BillVoteSummary, ChamberVoteSummary } from './types'

function chamberTotal(summary: ChamberVoteSummary | undefined) {
  if (!summary) {
    return 0
  }
  return Object.values(summary).reduce((sum: number, count) => sum + (count ?? 0), 0)
}

export function voteTotal(summary: BillVoteSummary | undefined) {
  if (!summary) {
    return 0
  }
  return chamberTotal(summary.house) + chamberTotal(summary.senate)
}

function ChamberTally({
  label,
  summary,
}: {
  label: string
  summary: ChamberVoteSummary | undefined
}) {
  const yes = summary?.Yes ?? 0
  const no = summary?.No ?? 0
  const present = summary?.Present ?? 0
  const notVoting = summary?.['Not Voting'] ?? 0
  const recorded = yes + no
  const total = recorded + present + notVoting

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
    </div>
  )
}

export default function VoteTallyBar({ summary }: { summary: Bill['votes_summary'] }) {
  const house = summary?.house
  const senate = summary?.senate
  if (voteTotal(summary) === 0) {
    return <p className="text-xs text-slate-500">No recorded votes</p>
  }

  return (
    <div className="space-y-3">
      <ChamberTally label="House" summary={house} />
      <ChamberTally label="Senate" summary={senate} />
      <p className="text-[10px] text-slate-600">
        Latest roll call stored for each chamber
      </p>
    </div>
  )
}
