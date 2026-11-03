import {
  partyBadgeClass,
  partyShort,
  type Bill,
  type BillRollCall,
  type BillVotePartySummary,
  type ChamberVoteSummary,
  type VoteChamber,
} from '@politmus/core/types'
import { PARTY_PIES, chamberCounts, voteTotal, votePieDescription, votePieSlices } from '@politmus/core/billProfile'
import { voteKindNote } from '@politmus/core/voteContext'

export { voteTotal }

function VotePie({
  yes,
  no,
  label,
  decorative = false,
}: {
  yes: number
  no: number
  label: string
  decorative?: boolean
}) {
  const slices = votePieSlices(yes, no)
  const description = votePieDescription(label, yes, no)
  const cx = 18
  const cy = 18
  const r = 16

  return (
    <svg
      viewBox="0 0 36 36"
      className="h-14 w-14 shrink-0"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : description}
    >
      {decorative ? null : <title>{description}</title>}
      {slices.map((slice, index) =>
        slice.circle ? (
          <circle key={index} cx={cx} cy={cy} r={r} fill={slice.fill} />
        ) : (
          <path key={index} d={slice.d} fill={slice.fill} />
        ),
      )}
    </svg>
  )
}

function PartyVotePie({
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
  const pie = (
    <>
      <VotePie
        yes={yes}
        no={no}
        label={party}
        decorative={Boolean(onPartyClick)}
      />
      <span
        className={`rounded px-1.5 py-px text-center text-[10px] font-semibold ${partyBadgeClass(party)}`}
      >
        {partyShort(party)}
      </span>
      <span className="text-[10px] tabular-nums text-slate-400">
        <span className="text-emerald-400">{yes}Y</span>
        {' · '}
        <span className="text-red-400">{no}N</span>
      </span>
    </>
  )

  const className =
    'flex w-full flex-col items-center gap-1 rounded-md px-1 py-1'

  if (onPartyClick) {
    return (
      <button
        type="button"
        onClick={() => onPartyClick(chamber, party)}
        className={`${className} hover:bg-slate-800 hover:ring-1 hover:ring-slate-500`}
        aria-label={`Show ${party} ${chamber} votes, ${yes} yes, ${no} no`}
      >
        {pie}
      </button>
    )
  }

  return <div className={className}>{pie}</div>
}

// What the tallied vote was on, so a cloture or amendment vote is not read
// as a vote on the bill itself.
function TalliedVoteLabel({ rollCall }: { rollCall?: BillRollCall | null }) {
  if (!rollCall) return null
  const note = voteKindNote(rollCall)
  if (!note) {
    return <p className="mt-0.5 text-[11px] text-slate-500">Vote on passage</p>
  }
  return (
    <p className="mt-1 rounded border border-sky-700/40 bg-sky-950/30 px-2 py-1 text-[11px] text-sky-200">
      <strong className="font-semibold">
        {rollCall.vote_kind === 'amendment' ? 'Amendment vote.' : 'Procedural vote.'}
      </strong>{' '}
      {note}
    </p>
  )
}

function ChamberTally({
  label,
  chamber,
  summary,
  byParty,
  rollCall,
  onPartyClick,
}: {
  label: string
  chamber: VoteChamber
  summary: ChamberVoteSummary | undefined
  byParty: Record<string, ChamberVoteSummary> | undefined
  rollCall?: BillRollCall | null
  onPartyClick?: (chamber: VoteChamber, party: string) => void
}) {
  const { yes, no, present, notVoting, total, yesPct, noPct } = chamberCounts(summary)

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

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <TalliedVoteLabel rollCall={rollCall} />
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
      <div className="mt-3 grid grid-cols-3 items-start">
        {PARTY_PIES.map((party) => (
          <PartyVotePie
            key={party}
            chamber={chamber}
            party={party}
            summary={byParty?.[party] || {}}
            onPartyClick={onPartyClick}
          />
        ))}
      </div>
    </div>
  )
}

export default function VoteTallyBar({
  summary,
  byParty,
  rollCalls,
  onPartyClick,
}: {
  summary: Bill['votes_summary']
  byParty?: BillVotePartySummary
  // The roll call each chamber's tally counts, to label its kind.
  rollCalls?: Partial<Record<VoteChamber, BillRollCall | null>>
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
        rollCall={rollCalls?.house}
        onPartyClick={onPartyClick}
      />
      <ChamberTally
        label="Senate"
        chamber="senate"
        summary={senate}
        byParty={byParty?.senate}
        rollCall={rollCalls?.senate}
        onPartyClick={onPartyClick}
      />
      <p className="text-[10px] text-slate-600">
        {rollCalls
          ? 'Latest vote on passage in each chamber, or the latest vote if none'
          : 'Latest roll call stored for each chamber'}
      </p>
    </div>
  )
}
