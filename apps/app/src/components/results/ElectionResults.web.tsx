import './results.css'

import {
  PARTY_COLOR,
  PARTY_LABEL,
  PARTY_SHORT,
  AGGREGATOR,
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
  raceWinner,
  statusLine,
  type ChamberOutlook,
  isAggregated,
  STATE_FIPS,
  countingComplete,
  countyLabel,
  countyMatchKey,
  countyNameForFeature,
  countyStanding,
  countyTurnout,
  dollarsPerVote,
  formatMargin,
  formatMoney,
  formatPercent,
  formatSourceTime,
  formatVotes,
  houseFlips,
  houseRaces,
  houseTally,
  partyKey,
  partyTint,
  raceKey,
  raceStanding,
  reportingLabel,
  reportingShare,
  resultHighlights,
  senateRace,
  senateTally,
  share,
  stateTurnout,
  type CandidateProfile,
  type Highlight,
  type RaceResult,
  type ResultsSnapshot,
  type SenateRaceInfo,
  type StateResults,
} from '@politmus/core/electionResults'
import {
  HATCH_PATTERN_ID,
  MAP_HEIGHT as H,
  MAP_WIDTH as W,
  NO_RACE_FILL,
  countyFill,
  layoutMarkers,
  panBy,
  stateFill,
  turnoutColor,
  zoomAbout,
  zoomToBounds,
  type CountyView,
  type MapZoom,
  type MapOffice as Office,
} from '@politmus/core/resultsMap'
import { getVoterResources } from '@politmus/core/types'
import { useQuery } from '@tanstack/react-query'
import type { Feature, Geometry } from 'geojson'
import { geoPath } from 'd3-geo'
import { router } from 'expo-router'
import { feature, mesh } from 'topojson-client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getJson, useSnapshot } from './snapshot'

// us-atlas shapes are projected (Albers USA) into the W × H frame.
const path = geoPath()

type MapFeature = Feature<Geometry, { name: string }> & { id: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Topo = any

function useTopology(url: string, enabled = true) {
  return useQuery({ queryKey: ['topology', url], queryFn: () => getJson<Topo>(url), enabled, staleTime: Infinity })
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function Face({ name, profile, party, className }: { name: string; profile?: CandidateProfile | null; party: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const ring = PARTY_COLOR[partyKey(party)]
  if (profile?.photoUrl && !failed) {
    return (
      <img
        src={profile.photoUrl}
        alt=""
        className={className}
        style={{ ['--ring' as string]: ring }}
        onError={() => setFailed(true)}
        loading="lazy"
      />
    )
  }
  return (
    <span className={`${className ?? ''} er-cand-initials`} style={{ ['--ring' as string]: ring }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

function openProfile(profile: CandidateProfile | null | undefined) {
  if (profile?.officialId) router.push({ pathname: '/member/[id]', params: { id: profile.officialId } })
}

// The view lives in the query string (?state=GA&race=GA-H5&office=H) so a
// link opens the same race. This file is web-only, so it uses the URL directly.
function readViewParams(): { state?: string; race?: string; office?: string } {
  // The static export renders this page on the server, without a URL.
  if (typeof window === 'undefined') return {}
  const search = new URLSearchParams(window.location.search)
  return {
    state: search.get('state') ?? undefined,
    race: search.get('race') ?? undefined,
    office: search.get('office') ?? undefined,
  }
}

function writeViewParams(view: Record<string, string | null>) {
  const search = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(view)) {
    if (value) search.set(key, value)
    else search.delete(key)
  }
  const query = search.toString()
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', next)
}

// ---- Root ----

export default function ElectionResults() {
  const snapshotQuery = useSnapshot()
  const statesTopo = useTopology('/geo/states-albers-10m.json')
  const [params] = useState(readViewParams)

  const [office, setOffice] = useState<Office>(params.office === 'H' ? 'H' : 'S')
  const [selected, setSelected] = useState<string | null>(params.state?.toUpperCase() ?? null)
  const [raceId, setRaceId] = useState<string | null>(params.race ?? null)
  const [countyView, setCountyView] = useState<CountyView>('lead')
  const [flagged, setFlagged] = useState<string | null>(null)
  const countiesTopo = useTopology('/geo/counties-albers-10m.json', Boolean(selected))

  const snapshot = snapshotQuery.data ?? null

  // Keep the view in the URL, so a link opens the same state and race.
  useEffect(() => {
    writeViewParams({ state: selected, race: raceId, office: office === 'H' ? 'H' : null })
  }, [selected, raceId, office])

  const selectState = useCallback(
    (state: string | null, nextRace?: string | null) => {
      setSelected(state)
      setFlagged(null)
      if (!state || !snapshot) return setRaceId(null)
      if (nextRace) return setRaceId(nextRace)
      // Open on the chamber being viewed, falling back to whatever the state has.
      const results = snapshot.states[state]
      const first = office === 'H' ? (houseRaces(results)[0] ?? senateRace(results)) : (senateRace(results) ?? houseRaces(results)[0])
      setRaceId(first ? raceKey(state, first) : null)
    },
    [office, snapshot],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && selectState(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectState])

  const highlights = useMemo(() => (snapshot ? resultHighlights(snapshot) : []), [snapshot])

  if (snapshotQuery.isError) {
    return (
      <div className="er">
        <div className="er-loading">Results are unavailable right now. Try again in a minute.</div>
      </div>
    )
  }
  if (!snapshot || !statesTopo.data) {
    return (
      <div className="er">
        <div className="er-loading">Loading the latest counts…</div>
      </div>
    )
  }

  const results = selected ? snapshot.states[selected] : undefined
  // A link with a state and no race opens on the chamber being viewed.
  const race =
    results?.races.find((r) => raceKey(results.state, r) === raceId) ??
    (results && !raceId
      ? (office === 'H' ? (houseRaces(results)[0] ?? senateRace(results)) : (senateRace(results) ?? houseRaces(results)[0])) ?? null
      : null)
  const senateInfo = new Map((snapshot.senate ?? []).map((info) => [info.state, info]))

  return (
    <div className="er">
      <div className="er-wrap">
        <Hero snapshot={snapshot} />
        <NextCongress snapshot={snapshot} />
        <div className="er-toolbar">
          <div className="er-seg" role="group" aria-label="Chamber">
            <button type="button" aria-pressed={office === 'S'} onClick={() => setOffice('S')}>
              Senate
            </button>
            <button type="button" aria-pressed={office === 'H'} onClick={() => setOffice('H')}>
              House
            </button>
          </div>
          <span className="er-updated">
            Refreshes every minute · snapshot {formatSourceTime(snapshot.generatedAt)}
          </span>
        </div>

        <div className="er-stage">
          <div className="er-main">
          <USMap
            snapshot={snapshot}
            topo={statesTopo.data}
            countiesTopo={countiesTopo.data ?? null}
            office={office}
            selected={selected}
            race={race}
            results={results}
            senateInfo={senateInfo}
            countyView={countyView}
            flagged={flagged}
            onSelect={selectState}
          />
          <Highlights
            highlights={highlights}
            onOpen={(h) => {
              if (h.raceKey?.includes('-H')) setOffice('H')
              selectState(h.state, h.raceKey)
              if (h.county) {
                setFlagged(h.county)
                setCountyView(h.kind.startsWith('turnout') ? 'turnout' : 'lead')
              }
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
          </div>
          <aside className="er-panel" aria-live="polite">
            {selected ? (
              <StatePanel
                key={selected}
                state={selected}
                results={results}
                info={senateInfo.get(selected)}
                race={race}
                office={office}
                countyView={countyView}
                onCountyView={setCountyView}
                onRace={setRaceId}
                onFlag={setFlagged}
                flagged={flagged}
                onBack={() => selectState(null)}
              />
            ) : (
              <Overview snapshot={snapshot} office={office} onSelect={selectState} />
            )}
          </aside>
        </div>

        <Sources snapshot={snapshot} />
      </div>
    </div>
  )
}

// ---- Hero and scoreboard ----

function Hero({ snapshot }: { snapshot: ResultsSnapshot }) {
  const tally = senateTally(snapshot)
  const counted = Object.values(snapshot.states).filter((s) => senateRace(s)).length
  const viaAggregator = Object.values(snapshot.states).filter((s) => senateRace(s) && isAggregated(s)).length
  const totalSenate = snapshot.senate?.length ?? counted
  const houseSeats = Object.values(snapshot.states).reduce((sum, s) => sum + houseRaces(s).length, 0)
  const flips = houseFlips(snapshot)
  return (
    <header className="er-hero">
      <div>
        <div className="er-kicker">
          <span className="er-live" aria-hidden="true" /> 2026 midterms · Unofficial results
        </div>
        <h1 className="er-title">How the midterms are counting</h1>
        <p className="er-sub">
          Most numbers here come straight from a state election office and update as they post new counts. States we can’t
          read directly come from civicAPI, an independent aggregator, and are marked with a dashed ring. A race marked{' '}
          <StatusBadge status="called" /> has a winner projected by civicAPI while counting goes on, and a call can be
          wrong. <StatusBadge status="certified" /> means the state has made its count final.
        </p>
      </div>
      <div className="er-score">
        <div className="er-score-card">
          <div className="er-score-label">Senate leads</div>
          <div className="er-score-value">
            {tally.map((t) => (
              <span key={t.party} style={{ color: PARTY_COLOR[t.party] }}>
                {PARTY_SHORT[t.party]} {t.leading}
              </span>
            ))}
            <small>
              in {counted} of {totalSenate} races{viaAggregator ? `, ${viaAggregator} via civicAPI` : ''}
            </small>
          </div>
        </div>
        <div className="er-score-card">
          <div className="er-score-label">House seats changing hands</div>
          <div className="er-score-value">
            {flips.length ? (
              flips.map((f) => (
                <span key={f.party} style={{ color: PARTY_COLOR[f.party] }}>
                  {PARTY_SHORT[f.party]} +{f.seats}
                </span>
              ))
            ) : (
              <span>0</span>
            )}
            <small>of {houseSeats} counted</small>
          </div>
        </div>
      </div>
    </header>
  )
}

// ---- Calls and certification ----

// Called is an outline, certified is solid: a call can still change, a
// certified count can't.
function StatusBadge({ status }: { status: 'called' | 'certified' }) {
  return (
    <span className={`er-status er-status-${status}`} title={STATUS_EXPLAINER[status]}>
      <span aria-hidden="true">✓</span> {STATUS_LABEL[status]}
    </span>
  )
}

function RaceStatusBadge({ race }: { race: RaceResult }) {
  const status = raceStatus(race)
  return status === 'counting' ? null : <StatusBadge status={status} />
}

// ---- The next Congress ----

function NextCongress({ snapshot }: { snapshot: ResultsSnapshot }) {
  const senate = chamberOutlook(snapshot, 'S')
  const house = chamberOutlook(snapshot, 'H')
  const together = congressNotes(senate, house)
  return (
    <section className="er-congress" aria-labelledby="er-congress-title">
      <div className="er-congress-head">
        <div>
          <h2 id="er-congress-title">The next Congress, if today’s results hold</h2>
          <p className="er-sub">
            Who holds each chamber now, and who would if every race ends the way it stands. It’s a projection from the same
            counts; the leads above don’t change.
          </p>
        </div>
        <SeatKey />
      </div>
      <div className="er-congress-grid">
        <ChamberCard outlook={senate} />
        <ChamberCard outlook={house} />
      </div>
      {together.length ? (
        <div className="er-congress-together">
          <h3>What it adds up to</h3>
          <ul className="er-notes">
            {together.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function SeatKey() {
  return (
    <dl className="er-key">
      <div>
        <dt>
          <span className="er-swatch is-certified" /> <StatusBadge status="certified" />
        </dt>
        <dd>{STATUS_EXPLAINER.certified}</dd>
      </div>
      <div>
        <dt>
          <span className="er-swatch is-called" /> <StatusBadge status="called" />
        </dt>
        <dd>{STATUS_EXPLAINER.called}</dd>
      </div>
      <div>
        <dt>
          <span className="er-swatch is-leading" /> <span className="er-tag er-tag-lead">LEADS</span>
        </dt>
        <dd>Nobody has called it. The candidate is ahead in the count so far.</dd>
      </div>
    </dl>
  )
}

const CHAMBER_TITLE = { S: 'Senate', H: 'House' } as const

function ChamberCard({ outlook }: { outlook: ChamberOutlook }) {
  const { office, seats, controlAfter } = outlook
  const shown = BLOCS.filter((bloc) => seats[bloc].before || seats[bloc].after)
  return (
    <div className="er-chamber">
      <div className="er-chamber-top">
        <h3>{CHAMBER_TITLE[office]}</h3>
        <span className="er-control" style={{ ['--party' as string]: controlAfter ? BLOC_COLOR[controlAfter] : '#64748b' }}>
          {controlHeadline(outlook)}
        </span>
      </div>
      <div className="er-chamber-nums">
        {shown.map((bloc) => {
          const row = seats[bloc]
          const diff = row.after - row.before
          return (
            <div key={bloc} className="er-chamber-num" aria-label={`${BLOC_LABEL[bloc]}: ${row.before} now, ${row.after} after`}>
              <span style={{ color: BLOC_COLOR[bloc] }}>{BLOC_SHORT[bloc]}</span>
              <span className="er-chamber-before">{row.before}</span>
              <span aria-hidden="true">→</span>
              <b>{row.after}</b>
              {diff ? <small className={diff > 0 ? 'is-up' : 'is-down'}>{diff > 0 ? `+${diff}` : diff}</small> : null}
            </div>
          )
        })}
      </div>
      <SeatBar outlook={outlook} />
      <ul className="er-notes">
        {chamberNotes(outlook).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

// Democrats fill from the left, Republicans from the right, seats with no
// count yet in the middle. Lines mark the majority and supermajorities,
// counted from the majority's side.
function SeatBar({ outlook }: { outlook: ChamberOutlook }) {
  const { office, size, seats, uncounted, controlAfter } = outlook
  const parts = (bloc: 'DEM' | 'REP' | 'OTH') => {
    const row = seats[bloc]
    const list = [
      { kind: 'holdover', n: row.holdover },
      { kind: 'certified', n: row.certified },
      { kind: 'called', n: row.called },
      { kind: 'leading', n: row.leading },
    ]
    return (bloc === 'REP' ? list.reverse() : list).map((part) => ({ ...part, bloc }))
  }
  const segments = [...parts('DEM'), ...parts('OTH'), { kind: 'uncounted', n: uncounted, bloc: null }, ...parts('REP')].filter(
    (part) => part.n > 0,
  )
  const fromRight = controlAfter === 'REP'
  const marks = [
    { n: MAJORITY[office], label: 'majority', center: true },
    ...(office === 'S' ? [{ n: CLOTURE, label: 'ends a filibuster', center: false }] : []),
    { n: TWO_THIRDS[office], label: 'two-thirds', center: false },
  ]
  return (
    <div className="er-seatbar-wrap">
      <div className="er-seatbar" role="img" aria-label={`${CHAMBER_TITLE[office]} seats after the election: ${BLOCS.map((b) => `${BLOC_LABEL[b]} ${seats[b].after}`).join(', ')}`}>
        {segments.map((part, i) => (
          <span
            key={i}
            className={`er-seg-${part.kind}`}
            style={{ width: `${(part.n / size) * 100}%`, ['--party' as string]: part.bloc ? BLOC_COLOR[part.bloc] : undefined }}
            title={`${part.bloc ? `${BLOC_LABEL[part.bloc]}: ` : ''}${part.n} ${SEGMENT_LABEL[part.kind]}`}
          />
        ))}
        {marks.map((mark) => {
          // The majority line sits at the middle for either side.
          const at = mark.center ? 50 : ((fromRight ? size - mark.n : mark.n) / size) * 100
          return <span key={mark.n} className="er-mark" style={{ left: `${at}%` }} />
        })}
      </div>
      <div className="er-marks">
        {marks.map((mark) => {
          const at = mark.center ? 50 : ((fromRight ? size - mark.n : mark.n) / size) * 100
          return (
            <span key={mark.n} style={{ left: `${at}%` }} title={`${mark.n}: ${mark.label}`}>
              {mark.n}
            </span>
          )
        })}
      </div>
      <div className="er-marks-key">
        {marks.map((mark) => `${mark.n} ${mark.label}`).join(' · ')}
        {office === 'S' ? ' · Faded: not up this year' : ''}
      </div>
    </div>
  )
}

const SEGMENT_LABEL: Record<string, string> = {
  holdover: 'not up this year',
  certified: 'certified',
  called: 'called',
  leading: 'leading, not called',
  uncounted: 'with no votes counted yet',
}

// ---- The map ----

interface MapProps {
  snapshot: ResultsSnapshot
  topo: Topo
  countiesTopo: Topo | null
  office: Office
  selected: string | null
  race: RaceResult | null
  results: StateResults | undefined
  senateInfo: Map<string, SenateRaceInfo>
  countyView: CountyView
  flagged: string | null
  onSelect: (state: string | null) => void
}

interface Tip {
  x: number
  y: number
  content: ReactNode
}

const HOME: MapZoom = { k: 1, x: 0, y: 0 }

// Zooming and dragging the national map, so crowded markers are easy to
// pick out. A trackpad pinch (or Ctrl/⌘ and the scroll wheel) zooms about
// the pointer, two fingers pinch on a touch screen, and once zoomed in the
// map drags with the mouse or one finger. A plain scroll, and one finger at
// 1x, still scroll the page.
function useMapGestures(
  ref: React.RefObject<HTMLDivElement | null>,
  view: MapZoom,
  setView: React.Dispatch<React.SetStateAction<MapZoom>>,
  enabled: boolean,
) {
  const [active, setActive] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const last = useRef<{ x: number; y: number; distance: number } | null>(null)
  const dragged = useRef(false)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const zoomed = view.k > 1.01

  // Screen point to map units in the frame.
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box || !box.width) return null
      return { x: ((clientX - box.left) / box.width) * W, y: ((clientY - box.top) / box.height) * H, scale: W / box.width }
    },
    [ref],
  )
  // Gestures move the map live, without the zoom's easing.
  const touch = useCallback(() => {
    setActive(true)
    clearTimeout(settle.current)
    settle.current = setTimeout(() => setActive(false), 160)
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    // Trackpad pinches arrive as wheel events with ctrlKey (Chrome, Firefox,
    // Edge); Safari sends its own gesture events.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const at = toMap(event.clientX, event.clientY)
      if (!at) return
      touch()
      // A mouse wheel notch is ~100 units, a trackpad pinch a few at a time;
      // capping each event keeps a notch to about 1.5x.
      const delta = Math.max(-40, Math.min(40, event.deltaY))
      setView((v) => zoomAbout(v, Math.exp(-delta * 0.01), at.x, at.y))
    }
    let gestureScale = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const e = event as Event & { scale: number; clientX: number; clientY: number }
      const at = toMap(e.clientX, e.clientY)
      if (!at) return
      touch()
      setView((v) => zoomAbout(v, e.scale / gestureScale, at.x, at.y))
      gestureScale = e.scale
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart)
    element.addEventListener('gesturechange', onGestureChange)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
    }
  }, [ref, enabled, setView, toMap, touch])

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) } : { ...a, distance: 0 }
  }

  const handlers = enabled
    ? {
        onPointerDown: (event: React.PointerEvent) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          last.current = spread()
          if (pointers.current.size === 1) dragged.current = false
        },
        onPointerMove: (event: React.PointerEvent) => {
          if (!pointers.current.has(event.pointerId) || !last.current) return
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          const now = spread()
          const at = toMap(now.x, now.y)
          if (!at) return
          const two = pointers.current.size > 1
          // One pointer only drags once zoomed in; at 1x it scrolls the page.
          if (!two && !zoomed) return
          const dx = now.x - last.current.x
          const dy = now.y - last.current.y
          if (!dragged.current && Math.hypot(dx, dy) < 4 && !two) return
          if (!dragged.current) {
            dragged.current = true
            ref.current?.setPointerCapture?.(event.pointerId)
          }
          touch()
          const factor = two && last.current.distance ? now.distance / last.current.distance : 1
          setView((v) => zoomAbout(panBy(v, dx * at.scale, dy * at.scale), factor, at.x, at.y))
          last.current = now
        },
        onPointerUp: (event: React.PointerEvent) => {
          pointers.current.delete(event.pointerId)
          last.current = pointers.current.size ? spread() : null
        },
        onPointerCancel: (event: React.PointerEvent) => {
          pointers.current.delete(event.pointerId)
          last.current = pointers.current.size ? spread() : null
        },
        // A drag ends with a click on whatever was under it; that isn't a tap.
        onClickCapture: (event: React.MouseEvent) => {
          if (!dragged.current) return
          event.stopPropagation()
          dragged.current = false
        },
      }
    : {}

  return { active, handlers }
}

// Zoom without pinching: buttons, and a note on how.
function ZoomControls({ zoomed, onZoom, onReset }: { zoomed: boolean; onZoom: (factor: number) => void; onReset: () => void }) {
  return (
    <div className="er-zoombar" role="group" aria-label="Map zoom">
      <span className="er-hint">{zoomed ? 'Drag to move around' : 'Pinch, or Ctrl/⌘ + scroll, to zoom'}</span>
      {zoomed ? (
        <button type="button" className="er-zoombtn er-zoombtn-wide" onClick={onReset} aria-label="Show the whole country">
          Whole map
        </button>
      ) : null}
      <button type="button" className="er-zoombtn" onClick={() => onZoom(1 / 1.6)} disabled={!zoomed} aria-label="Zoom out">
        −
      </button>
      <button type="button" className="er-zoombtn" onClick={() => onZoom(1.6)} aria-label="Zoom in">
        +
      </button>
    </div>
  )
}

function USMap(props: MapProps) {
  const { snapshot, topo, countiesTopo, office, selected, race, results, senateInfo, countyView, flagged, onSelect } = props
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)

  const states = useMemo(
    () => (feature(topo, topo.objects.states) as unknown as { features: MapFeature[] }).features,
    [topo],
  )
  const nation = useMemo(() => path(mesh(topo, topo.objects.nation)) ?? '', [topo])
  const byPostal = useMemo(() => new Map(states.map((f) => [STATE_FIPS[f.id], f])), [states])

  const selectedFeature = selected ? byPostal.get(selected) : undefined
  // The national view people pinch, scroll-zoom and drag (1x until they do).
  // A state opens with zoomToBounds, and closing it returns here.
  const [national, setNational] = useState<MapZoom>(HOME)
  const zoom = useMemo(
    () => (selectedFeature ? zoomToBounds(path.bounds(selectedFeature)) : national),
    [selectedFeature, national],
  )
  const gesture = useMapGestures(ref, national, setNational, !selected)

  const counties = useMemo(() => {
    if (!countiesTopo || !selectedFeature) return []
    const all = (feature(countiesTopo, countiesTopo.objects.counties) as unknown as { features: MapFeature[] }).features
    return all.filter((f) => f.id.startsWith(selectedFeature.id))
  }, [countiesTopo, selectedFeature])

  // County names in results, by match key.
  const countyKeys = useMemo(() => {
    const keys = new Map<string, string>()
    for (const name of Object.keys(results?.counties ?? {})) keys.set(countyMatchKey(name), name)
    for (const name of Object.keys(race?.counties ?? {})) keys.set(countyMatchKey(name), name)
    return keys
  }, [results, race])

  const bubbleSize = width < 520 ? 32 : width < 820 ? 40 : 50

  const showTip = (event: React.MouseEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    setTip({ x: Math.min(x, box.width - 280), y: Math.min(y, box.height - 150), content })
  }

  return (
    <div className="er-mapcard">
      <div
        className={`er-map${national.k > 1.01 && !selected ? ' is-zoomed' : ''}${gesture.active ? ' is-gesturing' : ''}`}
        ref={ref}
        onMouseLeave={() => setTip(null)}
        {...gesture.handlers}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={office === 'S' ? 'Senate results map' : 'House results map'}>
          <defs>
            <pattern id={HATCH_PATTERN_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#1e293b" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2" />
            </pattern>
          </defs>
          <g className="er-zoom" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` }}>
            {states.map((f) => {
              const postal = STATE_FIPS[f.id]
              const isSelected = postal === selected
              return (
                <path
                  key={f.id}
                  d={path(f) ?? ''}
                  className={`er-state${selected && !isSelected ? ' is-dim' : ''}${isSelected ? ' is-selected' : ''}`}
                  fill={isSelected && counties.length ? '#0f172a' : stateFill(snapshot, postal, office, senateInfo)}
                  tabIndex={selected ? -1 : 0}
                  role="button"
                  aria-label={f.properties.name}
                  onClick={() => onSelect(isSelected ? null : postal)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(postal)}
                  onMouseMove={(e) => !selected && showTip(e, <StateTip snapshot={snapshot} postal={postal} name={f.properties.name} office={office} info={senateInfo.get(postal)} />)}
                  onMouseLeave={() => setTip(null)}
                />
              )
            })}
            {counties.map((f) => {
              const name = countyKeys.get(countyMatchKey(countyNameForFeature(f.id, f.properties.name)))
              const standing = race && name ? countyStanding(race, name) : null
              const turnout = results && name ? countyTurnout(results, name) : null
              const fill = countyFill(countyView, standing, turnout)
              return (
                <path
                  key={f.id}
                  d={path(f) ?? ''}
                  className={`er-county${flagged && name === flagged ? ' is-flagged' : ''}`}
                  fill={fill}
                  onMouseMove={(e) =>
                    showTip(
                      e,
                      <CountyTip
                        label={results ? countyLabel(results, name ?? f.properties.name) : f.properties.name}
                        race={race}
                        standing={standing}
                        turnout={turnout}
                        row={name ? results?.counties[name] : undefined}
                      />,
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                />
              )
            })}
            {selectedFeature && counties.length ? <path d={path(selectedFeature) ?? ''} className="er-outline" /> : null}
            <path d={nation} className="er-nation" />
          </g>
        </svg>

        <Bubbles
          snapshot={snapshot}
          states={byPostal}
          office={office}
          size={bubbleSize}
          width={width}
          view={national}
          hidden={Boolean(selected)}
          onSelect={onSelect}
          onHover={showTip}
          onLeave={() => setTip(null)}
        />

        {selected ? (
          <div className="er-maphud">
            <button type="button" className="er-back" onClick={() => onSelect(null)}>
              ← All states
            </button>
            {selected && !countiesTopo ? <span className="er-updated">Loading counties…</span> : null}
          </div>
        ) : null}
        {tip ? (
          <div className="er-tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.content}
          </div>
        ) : null}
      </div>
      {/* Below the map, not over it, so a zoomed-in state is never covered. */}
      <div className="er-mapfoot">
        <Legend
          office={office}
          countyView={selected ? countyView : null}
          pending={(snapshot.senate ?? []).some((info) => !senateRace(snapshot.states[info.state]))}
          aggregated={Object.values(snapshot.states).some(isAggregated)}
        />
        {selected ? null : <div className="er-hint">Tap a state to dig into its counties</div>}
        {selected ? null : (
          <ZoomControls
            zoomed={national.k > 1.01}
            onZoom={(factor) => setNational((view) => zoomAbout(view, factor, W / 2, H / 2))}
            onReset={() => setNational(HOME)}
          />
        )}
      </div>
    </div>
  )
}

function Bubbles({
  snapshot,
  states,
  office,
  size,
  width,
  view,
  hidden,
  onSelect,
  onHover,
  onLeave,
}: {
  snapshot: ResultsSnapshot
  states: Map<string, MapFeature>
  office: Office
  size: number
  width: number
  // The national zoom: faces keep their size and spread apart as it grows.
  view: MapZoom
  hidden: boolean
  onSelect: (state: string) => void
  onHover: (event: React.MouseEvent, content: ReactNode) => void
  onLeave: () => void
}) {
  const laid = layoutMarkers({
    snapshot,
    office,
    centroid: (postal) => {
      const f = states.get(postal)
      return f ? (path.centroid(f) as [number, number]) : null
    },
    size,
    // Laid out as if the map were that much wider, then drawn in the
    // zoomed frame, dropping markers panned out of view.
    width: width * view.k,
  })
  const { columnWidth, depth } = laid
  const slack = (size * 2 * W) / Math.max(width, 1)
  const items = laid.markers
    .map((m) => ({ ...m, x: m.x * view.k + view.x, y: m.y * view.k + view.y, cx: m.cx * view.k + view.x, cy: m.cy * view.k + view.y }))
    .filter((m) => m.x > -slack && m.x < W + slack && m.y > -slack && m.y < H + slack)

  return (
    <div className={`er-bubbles${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
      {items.map((item) => {
        const left = `${(item.x / W) * 100}%`
        const top = `${(item.y / H) * 100}%`
        const callout =
          item.x !== item.cx ? (
            <span
              key={`${item.key}-line`}
              className="er-callout"
              style={{
                left: `${(item.cx / W) * 100}%`,
                top: `${(item.cy / H) * 100}%`,
                width: `${(Math.hypot(item.x - item.cx, item.y - item.cy) / W) * 100}%`,
                transform: `rotate(${Math.atan2(item.y - item.cy, item.x - item.cx)}rad)`,
              }}
            />
          ) : null
        if (item.tally) {
          return [
            callout,
            <button
              key={item.key}
              type="button"
              className={`er-bubble er-bubble-house${isAggregated(item.results) ? ' er-bubble-agg' : ''}`}
              style={{ left, top }}
              onClick={() => onSelect(item.key)}
              aria-label={`${item.results.name} House results${isAggregated(item.results) ? ', via civicAPI' : ''}`}
            >
              <span className="er-pill" style={{ background: PARTY_COLOR[item.tally[0].party] }}>
                {item.tally.map((t) => `${PARTY_SHORT[t.party]} ${t.leading}`).join(' · ')}
              </span>
            </button>,
          ]
        }
        const standing = raceStanding(item.race!)
        const leader = standing.leader!
        const color = PARTY_COLOR[partyKey(leader.party)]
        const leaderShare = share(leader.votes, standing.totalVotes)
        const radius = 47
        const circumference = 2 * Math.PI * radius
        const counted = Math.round((reportingShare(item.race!) ?? 0) * 100)
        return [
          callout,
          <button
            key={item.key}
            type="button"
            className={`er-bubble er-tower${isAggregated(item.results) ? ' er-bubble-agg' : ''}`}
            style={{
              left,
              top,
              zIndex: Math.round(item.y),
              ['--size' as string]: `${size}px`,
              ['--col-w' as string]: `${columnWidth}px`,
              ['--col-d' as string]: `${depth}px`,
              ['--col-h' as string]: `${item.lift}px`,
              ['--party' as string]: color,
            }}
            onClick={() => onSelect(item.key)}
            onMouseMove={(e) => onHover(e, <RaceTip results={item.results} race={item.race!} />)}
            onMouseLeave={onLeave}
            aria-label={`${item.results.name}: ${leader.name} leads by ${standing.margin.toFixed(1)} points, ${counted}% counted`}
          >
            <span className="er-face">
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r={radius} fill="#0f172a" stroke="#334155" strokeWidth="6" />
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${(leaderShare / 100) * circumference} ${circumference}`}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <Face name={leader.name} profile={leader.profile} party={leader.party} />
              <span className="er-pill" style={{ background: color }}>
                {formatMargin(standing.margin)}
              </span>
            </span>
            <span className="er-col" aria-hidden="true">
              <span className="er-col-top" />
              <span className="er-col-side" />
            </span>
          </button>,
        ]
      })}
    </div>
  )
}

function Legend({
  office,
  countyView,
  pending,
  aggregated,
}: {
  office: Office
  countyView: CountyView | null
  pending: boolean
  aggregated: boolean
}) {
  if (countyView === 'turnout') {
    return (
      <div className="er-legend">
        <div className="er-legend-row">Turnout of registered voters</div>
        <div className="er-legend-row">
          30%
          <span className="er-ramp" style={{ background: `linear-gradient(90deg, ${turnoutColor(30)}, ${turnoutColor(80)})` }} />
          80%
        </div>
      </div>
    )
  }
  return (
    <div className="er-legend">
      <div className="er-legend-row">
        <span>D</span>
        <span
          className="er-ramp"
          style={{
            background: `linear-gradient(90deg, ${partyTint('DEM', 30)}, ${partyTint('DEM', 2)} 48%, ${partyTint('REP', 2)} 52%, ${partyTint('REP', 30)})`,
          }}
        />
        <span>R</span>
      </div>
      <div className="er-legend-row">Brighter means a bigger lead</div>
      {countyView === null ? (
        <>
          {aggregated ? (
            <div className="er-legend-row">
              <span className="er-swatch er-swatch-agg" />
              Dashed ring: counts via civicAPI, not the state
            </div>
          ) : null}
          {office === 'S' && pending ? (
            <div className="er-legend-row">
              <span className="er-swatch" style={{ background: 'repeating-linear-gradient(45deg,#1e293b 0 3px,#475569 3px 5px)' }} />
              Counts on the state’s own site
            </div>
          ) : null}
          <div className="er-legend-row">
            <span className="er-swatch" style={{ background: NO_RACE_FILL }} />
            {office === 'S' ? 'No Senate race' : 'Not loaded yet'}
          </div>
        </>
      ) : null}
    </div>
  )
}

// ---- Tooltips ----

function StateTip({
  snapshot,
  postal,
  name,
  office,
  info,
}: {
  snapshot: ResultsSnapshot
  postal: string
  name: string
  office: Office
  info?: SenateRaceInfo
}) {
  const results = snapshot.states[postal]
  if (office === 'H') {
    const tally = houseTally(results)
    return (
      <>
        <h4>{name}</h4>
        {tally.length ? (
          tally.map((t) => (
            <div className="er-tt-row" key={t.party}>
              <span>{PARTY_LABEL[t.party]}s lead</span>
              <b>{t.leading}</b>
            </div>
          ))
        ) : (
          <div className="er-tt-note">House counts for {name} aren’t loaded yet.</div>
        )}
      </>
    )
  }
  const race = senateRace(results)
  if (race && results) return <RaceTip results={results} race={race} />
  return (
    <>
      <h4>{name}</h4>
      <div className="er-tt-note">
        {info ? `${info.label}: counts are on ${name}’s own results site. Tap for the candidates.` : 'No Senate race this year.'}
      </div>
    </>
  )
}

function RaceTip({ results, race }: { results: StateResults; race: RaceResult }) {
  const standing = raceStanding(race)
  return (
    <>
      <h4>
        {results.name} · {race.label}
      </h4>
      {standing.ranked.slice(0, 3).map((c) => (
        <div className="er-tt-row" key={c.name}>
          <span>
            <span className="er-dot" style={{ background: PARTY_COLOR[partyKey(c.party)] }} /> {c.name}
          </span>
          <b>{formatPercent(share(c.votes, standing.totalVotes))}</b>
        </div>
      ))}
      <div className="er-tt-note">
        {statusLine(race) ? `${statusLine(race)} · ` : ''}
        {reportingLabel(race)}
        {isAggregated(results) ? ' · via civicAPI' : ''}
      </div>
    </>
  )
}

function CountyTip({
  label,
  race,
  standing,
  turnout,
  row,
}: {
  label: string
  race: RaceResult | null
  standing: ReturnType<typeof countyStanding>
  turnout: number | null
  row?: { registered: number; ballots: number | null }
}) {
  return (
    <>
      <h4>{label}</h4>
      {race && standing ? (
        race.candidates
          .map((c, i) => ({ c, votes: standing.votes[i] ?? 0 }))
          .filter((x) => x.votes > 0)
          .sort((a, b) => b.votes - a.votes)
          .slice(0, 3)
          .map(({ c, votes }) => (
            <div className="er-tt-row" key={c.name}>
              <span>
                <span className="er-dot" style={{ background: PARTY_COLOR[partyKey(c.party)] }} /> {c.name}
              </span>
              <b>
                {formatPercent(share(votes, standing.totalVotes))} <span className="er-row-faint">{formatVotes(votes)}</span>
              </b>
            </div>
          ))
      ) : (
        <div className="er-tt-note">{race ? 'Not part of this race.' : 'No counts for this county.'}</div>
      )}
      {turnout !== null && row ? (
        <div className="er-tt-row">
          <span>Turnout</span>
          <b>
            {formatPercent(turnout)} <span className="er-row-faint">of {formatVotes(row.registered)}</span>
          </b>
        </div>
      ) : null}
    </>
  )
}

// ---- Panel: overview ----

function Overview({
  snapshot,
  office,
  onSelect,
}: {
  snapshot: ResultsSnapshot
  office: Office
  onSelect: (state: string, race?: string) => void
}) {
  if (office === 'H') {
    const states = Object.values(snapshot.states).filter((s) => houseRaces(s).length)
    return (
      <>
        <h2>House races we’re counting</h2>
        <p className="er-source">
          Every House seat, by state. A yellow dot marks a seat where the sitting member is behind. A check marks a called
          seat, and a filled check a certified one. States tagged civicAPI come from an independent aggregator, not the
          state.
        </p>
        {states.map((s) => (
          <div key={s.state}>
            <button type="button" className="er-row" onClick={() => onSelect(s.state)}>
              <span className="er-row-main">
                <b>{s.name}</b>
                {isAggregated(s) ? <span className="er-agg-tag">civicAPI</span> : null}
              </span>
              <span className="er-row-side">
                {houseTally(s).map((t) => (
                  <span key={t.party} style={{ color: PARTY_COLOR[t.party], marginLeft: 8 }}>
                    {PARTY_SHORT[t.party]} {t.leading}
                  </span>
                ))}
              </span>
            </button>
            <SeatGrid state={s} selected={null} onSelect={(key) => onSelect(s.state, key)} />
          </div>
        ))}
      </>
    )
  }

  const counted = Object.values(snapshot.states)
    .map((s) => ({ s, race: senateRace(s) }))
    .filter((x): x is { s: StateResults; race: RaceResult } => Boolean(x.race))
    .map((x) => ({ ...x, standing: raceStanding(x.race) }))
    .sort((a, b) => a.standing.margin - b.standing.margin)
  const pending = (snapshot.senate ?? []).filter((info) => !senateRace(snapshot.states[info.state]))

  return (
    <>
      <div>
        <h3>Senate, closest first</h3>
      </div>
      <div className="er-list">
        {counted.map(({ s, race, standing }) => (
          <button key={s.state} type="button" className="er-row" onClick={() => onSelect(s.state)}>
            <span className="er-row-main">
              <span className="er-dot" style={{ background: PARTY_COLOR[partyKey(standing.leader?.party)] }} />
              <span>
                <b>{s.name}</b> <span className="er-row-faint">{standing.leader?.name}</span>
                {isAggregated(s) ? <span className="er-agg-tag">civicAPI</span> : null}
              </span>
            </span>
            <span className="er-row-side">
              <RaceStatusBadge race={race} />
              <span style={{ color: PARTY_COLOR[partyKey(standing.leader?.party)] }}>{formatMargin(standing.margin)}</span>
            </span>
          </button>
        ))}
      </div>
      {pending.length ? (
        <>
          <div>
            <h3>Counts on state sites</h3>
            <p className="er-source" style={{ marginTop: 6 }}>
              We haven’t connected these states’ official results yet. Tap one for the candidates and a link to its count.
            </p>
          </div>
          <div className="er-pending">
            {pending.map((info) => (
              <button key={info.state} type="button" className="er-pending-row er-row" onClick={() => onSelect(info.state)}>
                <span>{info.stateName}</span>
                <span className="er-faces">
                  {info.candidates.slice(0, 3).map((c) => (
                    <Face key={c.name} name={c.name} profile={c.profile} party={c.party} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}

function SeatGrid({ state, selected, onSelect }: { state: StateResults; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="er-house-grid" style={{ padding: '4px 10px 10px' }}>
      {houseRaces(state).map((race) => {
        const standing = raceStanding(race)
        const key = raceKey(state.state, race)
        const incumbent = race.candidates.find((c) => c.incumbent)
        const flip = Boolean(incumbent && standing.leader && incumbent !== standing.leader)
        const status = raceStatus(race)
        const who = raceWinner(race) ?? standing.leader
        return (
          <button
            key={key}
            type="button"
            className={`er-seat${flip ? ' is-flip' : ''}${status === 'counting' ? '' : ` is-${status}`}`}
            aria-pressed={selected === key}
            title={`${state.state}-${race.district}: ${who?.name ?? 'No votes yet'}${statusLine(race) ? ` (${statusLine(race)})` : ''}${flip ? ' (sitting member behind)' : ''}`}
            style={{ background: standing.leader ? partyTint(standing.leader.party, standing.margin) : '#1e293b' }}
            onClick={() => onSelect(key)}
          >
            {race.district}
          </button>
        )
      })}
    </div>
  )
}

// ---- Panel: one state ----

function StatePanel({
  state,
  results,
  info,
  race,
  office,
  countyView,
  onCountyView,
  onRace,
  onFlag,
  flagged,
  onBack,
}: {
  state: string
  results: StateResults | undefined
  info: SenateRaceInfo | undefined
  race: RaceResult | null
  office: Office
  countyView: CountyView
  onCountyView: (view: CountyView) => void
  onRace: (key: string) => void
  onFlag: (county: string | null) => void
  flagged: string | null
  onBack: () => void
}) {
  const name = results?.name ?? info?.stateName ?? getVoterResources(state).name
  if (!results) {
    const url = info?.resultsUrl ?? getVoterResources(state).pollingPlaceUrl ?? 'https://vote.gov'
    return (
      <>
        <button type="button" className="er-back" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
          ← All states
        </button>
        <h2>{name}</h2>
        <p className="er-source">
          We don’t read {name}’s official counts yet, so they’re on the state’s own site.{' '}
          <a href={url} target="_blank" rel="noreferrer">
            See {name}’s results
          </a>
        </p>
        {info ? (
          <>
            <h3>{info.label} candidates</h3>
            <div className="er-cands">
              {info.candidates.map((c) => (
                <div className="er-cand" key={c.name}>
                  <Face name={c.name} profile={c.profile} party={c.party} className="er-cand-photo" />
                  <div>
                    <div className="er-cand-name">{c.name}</div>
                    <div className="er-cand-meta">
                      <span style={{ color: PARTY_COLOR[partyKey(c.party)] }}>{PARTY_LABEL[partyKey(c.party)]}</span>
                      {c.incumbent ? <span className="er-tag er-tag-inc">INCUMBENT</span> : null}
                      {c.profile?.receipts ? <span>Raised {formatMoney(c.profile.receipts)}</span> : null}
                    </div>
                    {c.profile ? (
                      <button type="button" className="er-profile" onClick={() => openProfile(c.profile)}>
                        Full profile →
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="er-source">No Senate race in {name} this year.</p>
        )}
      </>
    )
  }

  const senate = senateRace(results)
  const house = houseRaces(results)
  const turnout = stateTurnout(results)

  return (
    <>
      <div>
        <h2>{name}</h2>
        {isAggregated(results) ? (
          <div className="er-agg-note" role="note">
            <b>Counts via civicAPI, not from {name} directly.</b> We can’t read {name}’s own results feed, so these come from{' '}
            <a href={AGGREGATOR.url} target="_blank" rel="noreferrer">
              civicAPI
            </a>
            , an independent aggregator that doesn’t publish its sources. They can trail the state’s count by hours.
            {results.source.lastUpdated ? ` civicAPI last updated this ${formatSourceTime(results.source.lastUpdated)}.` : ''}
            {results.source.stateUrl ? (
              <>
                {' '}
                <a href={results.source.stateUrl} target="_blank" rel="noreferrer">
                  Check {name}’s official results
                </a>
                .
              </>
            ) : null}
          </div>
        ) : (
          <p className="er-source" style={{ marginTop: 4 }}>
            Unofficial results from the{' '}
            <a href={results.source.url} target="_blank" rel="noreferrer">
              {results.source.name}
            </a>
            {results.source.lastUpdated ? `, updated ${formatSourceTime(results.source.lastUpdated)}` : ''}.
          </p>
        )}
      </div>
      {results.ballots ? (
        <div className="er-stats">
          <div className="er-stat">
            <div className="er-stat-label">Ballots</div>
            <div className="er-stat-value">{formatCompact(results.ballots)}</div>
          </div>
          <div className="er-stat">
            <div className="er-stat-label">Registered</div>
            <div className="er-stat-value">{results.registered ? formatCompact(results.registered) : '-'}</div>
          </div>
          <div className="er-stat">
            <div className="er-stat-label">Turnout</div>
            <div className="er-stat-value">{turnout ? formatPercent(turnout) : '-'}</div>
          </div>
        </div>
      ) : null}

      <div className="er-chips" role="group" aria-label="Race">
        {senate ? (
          <button type="button" className="er-chip" aria-pressed={race === senate} onClick={() => onRace(raceKey(state, senate))}>
            Senate
          </button>
        ) : null}
        {office === 'S' && house.length ? (
          <span className="er-source" style={{ alignSelf: 'center' }}>
            + {house.length} House seats below
          </span>
        ) : null}
      </div>
      {house.length ? (
        <div>
          <h3 style={{ marginBottom: 6 }}>House seats</h3>
          <SeatGrid state={results} selected={race ? raceKey(state, race) : null} onSelect={onRace} />
        </div>
      ) : null}

      {race ? <RaceCard key={raceKey(state, race)} state={results} race={race} /> : null}

      {race && Object.keys(race.counties).length ? (
        <>
          <div className="er-seg" role="group" aria-label="County map">
            <button type="button" aria-pressed={countyView === 'lead'} onClick={() => onCountyView('lead')}>
              Who’s ahead
            </button>
            <button type="button" aria-pressed={countyView === 'turnout'} onClick={() => onCountyView('turnout')}>
              Turnout
            </button>
          </div>
          <CountyLists state={results} race={race} view={countyView} flagged={flagged} onFlag={onFlag} />
        </>
      ) : null}
    </>
  )
}

function formatCompact(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

function RaceCard({ state, race }: { state: StateResults; race: RaceResult }) {
  const standing = raceStanding(race)
  const status = raceStatus(race)
  const winner = raceWinner(race)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const { leader, runnerUp, totalVotes } = standing
  const top = Math.max(...standing.ranked.map((c) => c.votes), 1)
  const twoWay = leader && runnerUp ? leader.votes + runnerUp.votes : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h3>
          {race.office === 'S' ? 'U.S. Senate' : `${state.state}-${race.district} · U.S. House`}
          {race.special ? ' · Special' : ''}
        </h3>
        <div className="er-source" style={{ marginTop: 4 }}>
          {reportingLabel(race)} · {formatVotes(totalVotes)} votes counted
        </div>
        {winner ? (
          <div className={`er-call-note is-${status}`}>
            <StatusBadge status={status as 'called' | 'certified'} />
            <span>
              {status === 'certified' ? (
                <>
                  {state.name} certified <b>{winner.name}</b> the winner. This count is final.
                </>
              ) : (
                <>
                  {race.call?.source} called this for <b>{winner.name}</b>
                  {race.call?.at ? ` on ${formatSourceTime(race.call.at)}` : ''}. Votes are still being counted, and only {state.name}’s
                  certification makes it final.
                </>
              )}
            </span>
          </div>
        ) : null}
      </div>

      {leader && runnerUp ? (
        <div>
          <div className="er-tug" aria-hidden="true">
            <div
              style={{
                flexBasis: shown ? `${(leader.votes / twoWay) * 100}%` : '50%',
                background: PARTY_COLOR[partyKey(leader.party)],
              }}
            >
              {formatPercent(share(leader.votes, totalVotes))}
            </div>
            <div
              style={{
                flexBasis: shown ? `${(runnerUp.votes / twoWay) * 100}%` : '50%',
                background: PARTY_COLOR[partyKey(runnerUp.party)],
              }}
            >
              {formatPercent(share(runnerUp.votes, totalVotes))}
            </div>
          </div>
          <div className="er-margin-line">
            <span>
              <b>{leader.name}</b> leads by <b>{formatVotes(standing.marginVotes)}</b> votes
            </span>
            <b style={{ color: PARTY_COLOR[partyKey(leader.party)] }}>{formatMargin(standing.margin)}</b>
          </div>
        </div>
      ) : null}

      <div className="er-cands">
        {standing.ranked.map((c) => {
          const color = PARTY_COLOR[partyKey(c.party)]
          const isLeader = c === leader
          const perVote = dollarsPerVote(c)
          return (
            <div className={`er-cand${isLeader ? ' is-leader' : ''}`} key={c.name} style={{ ['--lead' as string]: color }}>
              <Face name={c.name} profile={c.profile} party={c.party} className="er-cand-photo" />
              <div style={{ minWidth: 0 }}>
                <div className="er-cand-top">
                  <span className="er-cand-name">{c.name}</span>
                  <span className="er-cand-pct">{formatPercent(share(c.votes, totalVotes))}</span>
                </div>
                <div className="er-cand-meta">
                  <span style={{ color }}>{PARTY_LABEL[partyKey(c.party)]}</span>
                  <span>{formatVotes(c.votes)} votes</span>
                  {c.incumbent ? <span className="er-tag er-tag-inc">INCUMBENT</span> : null}
                  {c === winner ? (
                    <StatusBadge status={status as 'called' | 'certified'} />
                  ) : isLeader ? (
                    <span className="er-tag er-tag-lead">LEADS</span>
                  ) : null}
                </div>
                <div className="er-bar">
                  <span style={{ width: shown ? `${(c.votes / top) * 100}%` : 0, background: color }} />
                </div>
                {c.profile?.receipts ? (
                  <div className="er-cand-money">
                    <span>
                      Raised <b>{formatMoney(c.profile.receipts)}</b>
                    </span>
                    {perVote ? (
                      <span>
                        <b>${perVote.toFixed(2)}</b> per vote
                      </span>
                    ) : null}
                    {c.profile.outsideSupport ? (
                      <span>
                        Outside help <b>{formatMoney(c.profile.outsideSupport)}</b>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {c.profile ? (
                  <button type="button" className="er-profile" onClick={() => openProfile(c.profile)}>
                    Full profile →
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CountyLists({
  state,
  race,
  view,
  flagged,
  onFlag,
}: {
  state: StateResults
  race: RaceResult
  view: CountyView
  flagged: string | null
  onFlag: (county: string | null) => void
}) {
  const standing = raceStanding(race)
  const rows = Object.keys(race.counties)
    .map((county) => ({ county, standing: countyStanding(race, county)!, turnout: countyTurnout(state, county) }))
    .filter((row) => row.standing.totalVotes > 0)

  const toggle = (county: string) => onFlag(flagged === county ? null : county)

  if (view === 'turnout') {
    const byTurnout = rows.filter((r) => r.turnout !== null && r.turnout <= 100).sort((a, b) => b.turnout! - a.turnout!)
    const list = (items: typeof byTurnout, title: string) => (
      <div>
        <h3 style={{ marginBottom: 4 }}>{title}</h3>
        <div className="er-list">
          {items.map((r) => (
            <button key={r.county} type="button" className="er-row" aria-pressed={flagged === r.county} onClick={() => toggle(r.county)}>
              <span className="er-row-main">
                <span className="er-dot" style={{ background: turnoutColor(r.turnout) }} />
                <span>{countyLabel(state, r.county)}</span>
              </span>
              <span className="er-row-side">{formatPercent(r.turnout!)}</span>
            </button>
          ))}
        </div>
      </div>
    )
    if (!byTurnout.length) return <p className="er-source">{state.name} doesn’t publish county turnout in its results feed.</p>
    return (
      <>
        {countingComplete(state) ? null : (
          <p className="er-source">
            {state.name} is still counting, so turnout will rise in counties that haven’t finished reporting.
          </p>
        )}
        {list(byTurnout.slice(0, 5), 'Highest turnout')}
        {list(byTurnout.slice(-5).reverse(), 'Lowest turnout')}
      </>
    )
  }

  const topTwo = standing.ranked.slice(0, 2)
  return (
    <>
      {topTwo.map((c) => {
        const strongest = rows
          .filter((r) => r.standing.leader === c)
          .sort((a, b) => b.standing.margin - a.standing.margin)
          .slice(0, 5)
        const color = PARTY_COLOR[partyKey(c.party)]
        const won = rows.filter((r) => r.standing.leader === c).length
        return (
          <div key={c.name}>
            <h3 style={{ marginBottom: 4 }}>
              {c.name.split(' ').at(-1)}’s strongest counties{' '}
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(ahead in {won})</span>
            </h3>
            <div className="er-list">
              {strongest.map((r) => (
                <button key={r.county} type="button" className="er-row" onClick={() => toggle(r.county)}>
                  <span className="er-row-main">
                    <span className="er-dot" style={{ background: partyTint(c.party, r.standing.margin) }} />
                    <span>{countyLabel(state, r.county)}</span>
                  </span>
                  <span className="er-row-side" style={{ color }}>
                    {formatMargin(r.standing.margin)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ---- Highlights ----

const HIGHLIGHT_TONE: Record<Highlight['kind'], string> = {
  closest: '#fbbf24',
  'incumbent-behind': '#f472b6',
  'money-underdog': '#34d399',
  'priciest-votes': '#a78bfa',
  'turnout-high': '#5eead4',
  'turnout-low': '#64748b',
  landslide: '#60a5fa',
}

function Highlights({ highlights, onOpen }: { highlights: Highlight[]; onOpen: (h: Highlight) => void }) {
  if (!highlights.length) return null
  return (
    <section className="er-highlights" aria-label="Highlights">
      <div className="er-highlights-head">
        <h2>What stands out so far</h2>
        <span className="er-updated">Tap one to jump to it</span>
      </div>
      <div className="er-cards">
        {highlights.map((h, i) => (
          <button
            key={`${h.kind}-${i}`}
            type="button"
            className="er-card"
            style={{ ['--tone' as string]: HIGHLIGHT_TONE[h.kind] }}
            onClick={() => onOpen(h)}
          >
            <span className="er-card-kind">{h.title}</span>
            <span className="er-card-head">
              {h.candidate ? (
                <Face name={h.candidate.name} profile={h.candidate.profile} party={h.candidate.party} />
              ) : null}
              <span className="er-card-title">{h.headline}</span>
            </span>
            <span className="er-card-detail">{h.detail}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Sources({ snapshot }: { snapshot: ResultsSnapshot }) {
  const aggregated = Object.values(snapshot.states).filter(isAggregated)
  return (
    <footer className="er-footer">
      <b>Where these numbers come from.</b> Each state’s election office publishes its own unofficial counts; where we
      can, we read them directly and change nothing. Totals keep moving as mail, provisional and overseas ballots are
      counted, and are final only once each state certifies. Race calls come from{' '}
      <a href={AGGREGATOR.url} target="_blank" rel="noreferrer">
        civicAPI
      </a>
      , for every state: they’re its projections, not the state’s, and are shown apart from the counts. Money raised is
      from FEC filings.
      <ul>
        {Object.values(snapshot.states).filter((s) => !isAggregated(s)).map((s) => (
          <li key={s.state}>
            {s.name}:{' '}
            <a href={s.source.url} target="_blank" rel="noreferrer">
              {s.source.name}
            </a>
            {s.source.lastUpdated ? `, updated ${formatSourceTime(s.source.lastUpdated)}` : ''}
          </li>
        ))}
      </ul>
      {aggregated.length ? (
        <p>
          <b>Via civicAPI.</b> Results for {aggregated.map((s) => s.name).join(', ')} are provided by{' '}
          <a href={AGGREGATOR.url} target="_blank" rel="noreferrer">
            civicAPI
          </a>
          , an independent aggregator, because we can’t read those states’ feeds directly. civicAPI doesn’t say where its
          numbers come from, and they can trail the states by hours; check each state’s own site for its official count.
        </p>
      ) : null}
    </footer>
  )
}

