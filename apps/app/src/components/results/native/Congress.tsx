import {
  BLOCS,
  BLOC_COLOR,
  BLOC_LABEL,
  BLOC_SHORT,
  CLOTURE,
  MAJORITY,
  STATUS_EXPLAINER,
  STATUS_LABEL,
  TWO_THIRDS,
  chamberNotes,
  chamberOutlook,
  congressNotes,
  controlHeadline,
  raceStatus,
  type Bloc,
  type ChamberOutlook,
  type RaceResult,
  type ResultsSnapshot,
} from '@politmus/core/electionResults'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

const TABULAR = { fontVariant: ['tabular-nums' as const] }

// ---- Calls and certification ----

// Called is an outline, certified is solid: a call can still change, a
// certified count can't.
export function StatusBadge({ status }: { status: 'called' | 'certified' }) {
  const certified = status === 'certified'
  return (
    <View
      accessibilityLabel={`${STATUS_LABEL[status]}. ${STATUS_EXPLAINER[status]}`}
      className={`flex-row items-center rounded-[5px] border px-1.5 ${certified ? 'border-slate-200 bg-slate-200' : 'border-slate-200/65'}`}
    >
      <Text className={`text-[10px] font-extrabold uppercase tracking-wide ${certified ? 'text-slate-900' : 'text-slate-200'}`}>
        ✓ {STATUS_LABEL[status]}
      </Text>
    </View>
  )
}

export function RaceStatusBadge({ race }: { race: RaceResult }) {
  const status = raceStatus(race)
  return status === 'counting' ? null : <StatusBadge status={status} />
}

// ---- The next Congress ----

const CHAMBER_TITLE = { S: 'Senate', H: 'House' } as const

export function NextCongress({ snapshot }: { snapshot: ResultsSnapshot }) {
  const senate = chamberOutlook(snapshot, 'S')
  const house = chamberOutlook(snapshot, 'H')
  const together = congressNotes(senate, house)
  return (
    <View className="gap-3.5 rounded-[20px] border border-[#26324d] bg-[#131d33] p-4">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-xl font-extrabold text-slate-100">
          The next Congress, if today’s results hold
        </Text>
        <Text className="text-sm leading-5 text-slate-400">
          Who holds each chamber now, and who would if every race ends the way it stands. It’s a projection from the same
          counts; the leads above don’t change.
        </Text>
      </View>
      <SeatKey />
      <View className="gap-3 md:flex-row">
        <ChamberCard outlook={senate} />
        <ChamberCard outlook={house} />
      </View>
      {together.length ? (
        <View className="gap-1.5">
          <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">What it adds up to</Text>
          <Notes notes={together} />
        </View>
      ) : null}
    </View>
  )
}

function SeatKey() {
  const rows: { swatch: Swatch; badge: ReactNode; text: string }[] = [
    { swatch: 'certified', badge: <StatusBadge status="certified" />, text: STATUS_EXPLAINER.certified },
    { swatch: 'called', badge: <StatusBadge status="called" />, text: STATUS_EXPLAINER.called },
    {
      swatch: 'leading',
      badge: (
        <View className="rounded-[5px] border border-emerald-400/35 bg-emerald-400/15 px-1.5">
          <Text className="text-[10px] font-extrabold tracking-wide text-emerald-300">LEADS</Text>
        </View>
      ),
      text: 'Nobody has called it. The candidate is ahead in the count so far.',
    },
  ]
  return (
    <View className="gap-1.5">
      {rows.map((row) => (
        <View key={row.swatch} className="flex-row items-start gap-2">
          <View className="w-[118px] flex-row items-center gap-1.5 pt-px">
            <View style={swatchStyle(row.swatch, BLOC_COLOR.DEM)} className="h-2.5 w-[18px] rounded-[3px]" />
            {row.badge}
          </View>
          <Text className="flex-1 text-xs leading-[17px] text-slate-400">{row.text}</Text>
        </View>
      ))}
    </View>
  )
}

function ChamberCard({ outlook }: { outlook: ChamberOutlook }) {
  const { office, seats, controlAfter } = outlook
  const shown = BLOCS.filter((bloc) => seats[bloc].before || seats[bloc].after)
  const control = controlAfter ? BLOC_COLOR[controlAfter] : '#64748b'
  return (
    <View className="min-w-0 gap-2.5 rounded-2xl bg-[#1a2540] p-3.5 md:flex-1">
      <View className="flex-row items-center justify-between gap-2.5">
        <Text className="text-xs font-bold uppercase tracking-wider text-slate-500">{CHAMBER_TITLE[office]}</Text>
        <View style={{ borderColor: control, backgroundColor: `${control}4d` }} className="rounded-full border px-2.5 py-0.5">
          <Text className="text-xs font-bold text-white">{controlHeadline(outlook)}</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-x-5 gap-y-1">
        {shown.map((bloc) => {
          const row = seats[bloc]
          const diff = row.after - row.before
          return (
            <View
              key={bloc}
              accessible
              accessibilityLabel={`${BLOC_LABEL[bloc]}: ${row.before} now, ${row.after} after`}
              className="flex-row items-baseline gap-1.5"
            >
              <Text style={{ color: BLOC_COLOR[bloc] }} className="text-[15px] font-extrabold">
                {BLOC_SHORT[bloc]}
              </Text>
              <Text style={TABULAR} className="text-[15px] font-semibold text-slate-400">
                {row.before} →
              </Text>
              <Text style={TABULAR} className="text-[26px] font-extrabold text-slate-100">
                {row.after}
              </Text>
              {diff ? (
                <Text style={TABULAR} className={`text-xs font-bold ${diff > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {diff > 0 ? `+${diff}` : diff}
                </Text>
              ) : null}
            </View>
          )
        })}
      </View>
      <SeatBar outlook={outlook} />
      <Notes notes={chamberNotes(outlook)} />
    </View>
  )
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <View className="gap-1">
      {notes.map((note) => (
        <View key={note} className="flex-row gap-1.5">
          <Text className="text-[13px] leading-[19px] text-slate-500">•</Text>
          <Text className="flex-1 text-[13px] leading-[19px] text-slate-400">{note}</Text>
        </View>
      ))}
    </View>
  )
}

type Swatch = 'holdover' | 'certified' | 'called' | 'leading' | 'uncounted'

function mix(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const base = [15, 23, 42]
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(base[i] + (c - base[i]) * amount))
  return `rgb(${parts.join(', ')})`
}

// The same steps as the web bar, without its stripes: solid for certified,
// dimmer for called, faint with an outline for a lead.
function swatchStyle(kind: Swatch, color: string) {
  switch (kind) {
    case 'certified':
      return { backgroundColor: color }
    case 'called':
      return { backgroundColor: mix(color, 0.72) }
    case 'leading':
      return { backgroundColor: mix(color, 0.3), borderWidth: 1, borderColor: mix(color, 0.8), borderStyle: 'dashed' as const }
    case 'holdover':
      return { backgroundColor: mix(color, 0.24) }
    default:
      return { backgroundColor: '#1e293b' }
  }
}

// Democrats fill from the left, Republicans from the right, seats with no
// count yet in the middle. Lines mark the majority and supermajorities,
// counted from the majority's side.
function SeatBar({ outlook }: { outlook: ChamberOutlook }) {
  const { office, size, seats, uncounted, controlAfter } = outlook
  const parts = (bloc: Bloc) => {
    const row = seats[bloc]
    const list: { kind: Swatch; n: number }[] = [
      { kind: 'holdover', n: row.holdover },
      { kind: 'certified', n: row.certified },
      { kind: 'called', n: row.called },
      { kind: 'leading', n: row.leading },
    ]
    return (bloc === 'REP' ? list.reverse() : list).map((part) => ({ ...part, color: BLOC_COLOR[bloc] }))
  }
  const segments = [...parts('DEM'), ...parts('OTH'), { kind: 'uncounted' as const, n: uncounted, color: '#1e293b' }, ...parts('REP')].filter(
    (part) => part.n > 0,
  )
  const fromRight = controlAfter === 'REP'
  const marks = [
    { n: MAJORITY[office], label: 'majority', center: true },
    ...(office === 'S' ? [{ n: CLOTURE, label: 'ends a filibuster', center: false }] : []),
    { n: TWO_THIRDS[office], label: 'two-thirds', center: false },
  ].map((mark) => ({ ...mark, at: mark.center ? 50 : ((fromRight ? size - mark.n : mark.n) / size) * 100 }))
  return (
    <View
      accessible
      accessibilityLabel={`${CHAMBER_TITLE[office]} seats after the election: ${BLOCS.map((b) => `${BLOC_LABEL[b]} ${seats[b].after}`).join(', ')}`}
    >
      <View className="h-[18px] flex-row overflow-hidden rounded-md bg-slate-800">
        {segments.map((part, i) => (
          <View key={i} style={[{ width: `${(part.n / size) * 100}%`, height: '100%' }, swatchStyle(part.kind, part.color)]} />
        ))}
      </View>
      {marks.map((mark) => (
        <View
          key={mark.n}
          pointerEvents="none"
          style={{ left: `${mark.at}%`, marginLeft: -1 }}
          className="absolute -top-0.5 h-[22px] w-0.5 bg-slate-50"
        />
      ))}
      <View className="h-4">
        {marks.map((mark) => (
          <Text
            key={mark.n}
            style={[TABULAR, { left: `${mark.at}%`, width: 30, marginLeft: -15 }]}
            className="absolute top-0.5 text-center text-[10px] font-bold text-slate-400"
          >
            {mark.n}
          </Text>
        ))}
      </View>
      <Text className="text-[11px] text-slate-500">
        {marks.map((mark) => `${mark.n} ${mark.label}`).join(' · ')}
        {office === 'S' ? ' · Faded: not up this year' : ''}
      </Text>
    </View>
  )
}
