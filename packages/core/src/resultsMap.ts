// Layout math for the election results map, shared by the web page and the
// native screen so both color states and place markers the same way. Pure
// functions: callers project the shapes (d3-geo) and pass in centroids and
// bounds, so nothing here touches the DOM or React Native.

import {
  houseTally,
  partyTint,
  raceStanding,
  reportingShare,
  senateRace,
  share,
  type CountyStanding,
  type RaceResult,
  type ResultsSnapshot,
  type SeatTally,
  type StateResults,
} from './electionResults'

// us-atlas shapes are projected (Albers USA) into a 975 × 610 frame.
export const MAP_WIDTH = 975
export const MAP_HEIGHT = 610

export type MapOffice = 'S' | 'H'
export type CountyView = 'lead' | 'turnout'
export type MapPoint = [number, number]
export type MapBounds = [[number, number], [number, number]]

// Fills for states and counties with nothing to show.
export const NO_RACE_FILL = '#1b2436'
export const NO_COUNTY_FILL = '#162036'
// A Senate race whose counts are only on the state's own site. Callers
// define an SVG <pattern> with this id.
export const HATCH_PATTERN_ID = 'er-hatch'
export const HATCH_FILL = `url(#${HATCH_PATTERN_ID})`

// Small Northeastern states get their marker out in the Atlantic, with a line.
export const CALLOUTS: Record<string, MapPoint> = {
  NH: [905, 120],
  MA: [915, 165],
  RI: [920, 205],
  CT: [905, 240],
  NJ: [890, 285],
  DE: [885, 325],
  MD: [870, 360],
  VT: [860, 70],
}

// A state's fill: the Senate leader's party, brighter for a bigger lead, or
// for the House the party leading the most seats, brighter for a wider split.
export function stateFill(
  snapshot: ResultsSnapshot,
  postal: string,
  office: MapOffice,
  senateStates: { has(postal: string): boolean },
): string {
  const results = snapshot.states[postal]
  if (office === 'S') {
    const race = senateRace(results)
    const standing = race ? raceStanding(race) : null
    if (standing?.leader) return partyTint(standing.leader.party, standing.margin)
    return senateStates.has(postal) ? HATCH_FILL : NO_RACE_FILL
  }
  const tally = houseTally(results)
  if (!tally.length) return NO_RACE_FILL
  const seats = tally.reduce((sum, t) => sum + t.leading, 0)
  const lead = tally[0]
  const runner = tally[1]?.leading ?? 0
  return partyTint(lead.party, 8 + (share(lead.leading - runner, seats) * 22) / 100)
}

// Turnout of registered voters on a teal ramp from 30% to 80%.
export function turnoutColor(turnout: number | null): string {
  if (turnout === null) return NO_COUNTY_FILL
  const t = Math.max(0, Math.min(1, (turnout - 30) / 50))
  const from = [15, 52, 70]
  const to = [94, 234, 212]
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function countyFill(view: CountyView, standing: CountyStanding | null, turnout: number | null): string {
  if (view === 'turnout') return turnoutColor(turnout)
  return standing?.leader ? partyTint(standing.leader.party, standing.margin) : NO_COUNTY_FILL
}

export interface MapZoom {
  k: number
  x: number
  y: number
}

export const MAX_ZOOM = 9
// How much of the frame a zoomed state fills.
const ZOOM_FILL = 0.86

// The transform (translate x, y, then scale k) that centers a state's
// projected bounds in the frame. No bounds is the whole country.
export function zoomToBounds(bounds: MapBounds | null | undefined): MapZoom {
  if (!bounds) return { k: 1, x: 0, y: 0 }
  const [[x0, y0], [x1, y1]] = bounds
  const k = Math.min(MAX_ZOOM, ZOOM_FILL / Math.max((x1 - x0) / MAP_WIDTH, (y1 - y0) / MAP_HEIGHT))
  return { k, x: MAP_WIDTH / 2 - (k * (x0 + x1)) / 2, y: MAP_HEIGHT / 2 - (k * (y0 + y1)) / 2 }
}

// ---- Markers ----

// The shortest Senate column, in pixels, for a race with nothing counted.
export const COLUMN_STUB = 6

// A Senate column's front width and its 3D depth, in pixels, for a face size.
export function columnSize(size: number): { width: number; depth: number } {
  const width = Math.round(size * 0.34)
  return { width, depth: Math.round(width * 0.45) }
}

// A Senate column rises with the share of the count that's in, from a stub
// at none to full height when every county or precinct has reported. The
// ocean callouts get shorter columns so their stack still fits.
export function columnHeight(race: RaceResult, state: string, size: number): number {
  const counted = Math.min(Math.max(reportingShare(race) ?? 0, 0), 1)
  const ceiling = size * (state in CALLOUTS ? 0.45 : 1.1)
  return Math.round(COLUMN_STUB + (ceiling - COLUMN_STUB) * counted)
}

// Push overlapping markers apart (neighbors like VA and NC), a few passes of
// simple repulsion in map units. Callout markers stay where they're put,
// and with `bounds` the others stay that far inside the sides and top.
export function spreadMarkers(
  items: { key: string; x: number; y: number }[],
  gap: number,
  bounds?: { edge: number; top: number },
): void {
  // Pinned at a side, a marker takes the rest of its push up or down
  // instead (down when the push was sideways, since the top is an edge too).
  const clamp = (item: { key: string; x: number; y: number }, uy = 0, away = 1) => {
    if (!bounds || item.key in CALLOUTS) return
    const x = Math.min(MAP_WIDTH - bounds.edge, Math.max(bounds.edge, item.x))
    const lost = Math.abs(item.x - x)
    item.x = x
    if (lost) item.y += lost * (Math.abs(uy) > 0.1 ? Math.sign(uy) * away : 1)
    item.y = Math.max(bounds.top, item.y)
  }
  for (const item of items) clamp(item)
  for (let pass = 0; pass < 30; pass++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 0.01
        if (distance >= gap) continue
        const push = (gap - distance) / 2
        const ux = dx / distance
        const uy = dy / distance
        const fixedA = a.key in CALLOUTS
        const fixedB = b.key in CALLOUTS
        if (!fixedA) {
          a.x -= ux * push * (fixedB ? 2 : 1)
          a.y -= uy * push * (fixedB ? 2 : 1)
        }
        if (!fixedB) {
          b.x += ux * push * (fixedA ? 2 : 1)
          b.y += uy * push * (fixedA ? 2 : 1)
        }
        clamp(a, uy, -1)
        clamp(b, uy, 1)
        moved = true
      }
    }
    if (!moved) break
  }
}

export interface MapMarker {
  key: string
  // Where the marker's base sits, in map units (the 975 × 610 frame).
  x: number
  y: number
  // The state's centroid; different from x, y for a callout.
  cx: number
  cy: number
  results: StateResults
  // House: seats each party leads. Null for Senate.
  tally: SeatTally[] | null
  // Senate: the race. Null for House.
  race: RaceResult | null
  // Senate column height in pixels (0 for House pills).
  lift: number
}

export interface MarkerLayout {
  markers: MapMarker[]
  columnWidth: number
  depth: number
}

// Places a marker for every state with a race to show: a Senate face atop
// its column, or a House seat-count pill. `size` is the face size and
// `width` the map's width, both in pixels.
export function layoutMarkers({
  snapshot,
  office,
  centroid,
  size,
  width,
}: {
  snapshot: ResultsSnapshot
  office: MapOffice
  centroid: (postal: string) => MapPoint | null | undefined
  size: number
  width: number
}): MarkerLayout {
  const { width: columnWidth, depth } = columnSize(size)
  const pxToMap = MAP_WIDTH / Math.max(width, 1)
  const markers = Object.values(snapshot.states).flatMap((results): MapMarker[] => {
    const center = centroid(results.state)
    if (!center) return []
    const [cx, cy] = center
    const [x, y] = CALLOUTS[results.state] ?? [cx, cy]
    if (office === 'H') {
      const tally = houseTally(results)
      if (!tally.length) return []
      return [{ key: results.state, x, y, cx, cy, results, tally, race: null, lift: 0 }]
    }
    const race = senateRace(results)
    if (!race || !raceStanding(race).leader) return []
    return [{ key: results.state, x, y, cx, cy, results, tally: null, race, lift: columnHeight(race, results.state, size) }]
  })

  const gap = size * pxToMap * 1.08
  // The small Northeastern states sit in a column out in the Atlantic, in
  // north-to-south order, each face at least one marker below the last.
  // Nothing stands so high that even a stub column would put its face off
  // the top of the map (Maine, or Vermont on a phone).
  // (House pills have no face or column, so they keep their places.)
  const top = office === 'S' ? (COLUMN_STUB + size + depth + 6) * pxToMap : -Infinity
  const keepOnMap = (item: MapMarker) => {
    if (item.lift) item.y = Math.max(item.y, top)
  }
  for (const item of markers) keepOnMap(item)
  const stack = markers.filter((i) => i.key in CALLOUTS).sort((a, b) => CALLOUTS[a.key][1] - CALLOUTS[b.key][1])
  let below = -Infinity
  for (const item of stack) {
    item.y = Math.max(CALLOUTS[item.key][1], top, below + gap * 1.15 + item.lift * pxToMap)
    below = item.y
  }
  // On a small map (a phone) the stack runs off the bottom. Squeeze it to
  // fit and zigzag the faces left and right so neighbors still read.
  // Faces stay inside the sides of the map (Maine gets pushed east).
  const edge = (size / 2 + 2) * pxToMap
  const bottom = MAP_HEIGHT - 8 * pxToMap
  const first = stack[0]
  const last = stack.at(-1)
  if (first && last && last !== first && last.y > bottom) {
    const squeeze = (bottom - first.y) / (last.y - first.y)
    const start = first.y
    stack.forEach((item, i) => {
      item.y = start + (item.y - start) * squeeze
      item.x = Math.min(MAP_WIDTH - edge, item.x + (i % 2 ? 0.45 : -0.45) * size * pxToMap)
    })
  }
  // Keep every face on the map: a column near the top edge stops short.
  const fitLift = (item: MapMarker) =>
    item.lift ? Math.round(Math.max(COLUMN_STUB, Math.min(item.lift, item.y / pxToMap - size - depth - 6))) : 0
  for (const item of markers) item.lift = fitLift(item)
  // Spread by where the faces sit (atop their columns), then stand the
  // columns back under them.
  for (const item of markers) item.y -= item.lift * pxToMap
  // In face positions, the top a face can sit at with a stub column.
  spreadMarkers(markers, gap, { edge, top: top - COLUMN_STUB * pxToMap })
  for (const item of markers) item.y += item.lift * pxToMap
  for (const item of markers) keepOnMap(item)
  for (const item of markers) item.lift = fitLift(item)

  return { markers, columnWidth, depth }
}
