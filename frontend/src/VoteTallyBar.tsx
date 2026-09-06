import type { Bill } from './types'

export default function VoteTallyBar({ summary }: { summary: Bill['votes_summary'] }) {
  const yes = summary.Yes ?? 0
  const no = summary.No ?? 0
  const present = summary.Present ?? 0
  const notVoting = summary['Not Voting'] ?? 0
  const recorded = yes + no
  const total = recorded + present + notVoting

  if (total === 0) {
    return <p className="text-xs text-slate-500">No recorded House votes</p>
  }

  const yesPct = recorded === 0 ? 0 : (yes / recorded) * 100
  const noPct = recorded === 0 ? 0 : (no / recorded) * 100

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded bg-slate-700">
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
