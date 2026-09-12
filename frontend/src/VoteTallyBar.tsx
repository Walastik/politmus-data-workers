import {
  partyBadgeClass,
  partyShort,
  type Bill,
  type BillVotePartySummary,
  type ChamberVoteSummary,
  type VoteChamber,
} from './types'

const PARTY_PIES = ['Democratic', 'Republican', 'Independent'] as const

const YES_FILL = '#10b981'
const NO_FILL = '#ef4444'
const EMPTY_FILL = '#334155'

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

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

function pieSlicePath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
) {
  const start = polar(cx, cy, r, startDeg)
  const end = polar(cx, cy, r, endDeg)
  const delta = ((endDeg - startDeg) % 360 + 360) % 360
  const largeArc = delta > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

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
  const recorded = yes + no
  const cx = 18
  const cy = 18
  const r = 16
  const start = -90
  const yesSweep = recorded === 0 ? 0 : (yes / recorded) * 360

  let slices: { d?: string; fill: string; circle?: boolean }[]
  if (recorded === 0) {
    slices = [{ fill: EMPTY_FILL, circle: true }]
  } else if (yes === 0) {
    slices = [{ fill: NO_FILL, circle: true }]
  } else if (no === 0) {
    slices = [{ fill: YES_FILL, circle: true }]
  } else {
    slices = [
      {
        d: pieSlicePath(cx, cy, r, start, start + yesSweep),
        fill: YES_FILL,
      },
      {
        d: pieSlicePath(cx, cy, r, start + yesSweep, start + 360),
        fill: NO_FILL,
      },
    ]
  }

  const description =
    recorded === 0
      ? `${label}: no recorded yes or no votes`
      : `${label}: ${yes} yes, ${no} no`

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
