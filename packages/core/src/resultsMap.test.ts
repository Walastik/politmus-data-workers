import { describe, expect, it } from 'vitest'

import { partyTint, type RaceResult, type ResultCandidate, type ResultsSnapshot, type StateResults } from './electionResults'
import {
  CALLOUTS,
  COLUMN_STUB,
  HATCH_FILL,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_ZOOM,
  NO_COUNTY_FILL,
  NO_RACE_FILL,
  columnHeight,
  columnSize,
  countyFill,
  layoutMarkers,
  spreadMarkers,
  stateFill,
  turnoutColor,
  zoomToBounds,
  type MapPoint,
} from './resultsMap'

function candidate(name: string, party: string, votes: number): ResultCandidate {
  return { name, party, votes }
}

function race(office: 'S' | 'H', candidates: ResultCandidate[], done = 10, district = 0): RaceResult {
  return {
    office,
    district,
    label: office === 'S' ? 'U.S. Senate' : `District ${district}`,
    special: false,
    totalVotes: candidates.reduce((sum, c) => sum + c.votes, 0),
    reporting: { done, total: 10, unit: 'counties' },
    counties: {},
    candidates,
  }
}

function state(code: string, races: RaceResult[]): StateResults {
  return {
    state: code,
    name: code,
    source: { name: 'Secretary of State', url: 'https://example.gov', lastUpdated: null, fetchedAt: '', official: false },
    registered: null,
    ballots: null,
    counties: {},
    races,
  }
}

function snapshot(states: StateResults[]): ResultsSnapshot {
  return {
    election: { date: '2026-11-03', name: 'General' },
    generatedAt: '',
    states: Object.fromEntries(states.map((s) => [s.state, s])),
  }
}

const senate = (dem: number, rep: number, done = 10) => race('S', [candidate('D', 'DEM', dem), candidate('R', 'REP', rep)], done)

describe('stateFill', () => {
  const snap = snapshot([
    state('GA', [senate(550, 450)]),
    state('PA', [
      race('H', [candidate('a', 'DEM', 6), candidate('b', 'REP', 4)], 10, 1),
      race('H', [candidate('a', 'DEM', 6), candidate('b', 'REP', 4)], 10, 2),
      race('H', [candidate('a', 'DEM', 4), candidate('b', 'REP', 6)], 10, 3),
    ]),
  ])
  const senateStates = new Set(['GA', 'NC'])

  it('tints a Senate state by its leader and margin', () => {
    expect(stateFill(snap, 'GA', 'S', senateStates)).toBe(partyTint('DEM', 10))
  })

  it('hatches a Senate race with no counts, and grays a state with no race', () => {
    expect(stateFill(snap, 'NC', 'S', senateStates)).toBe(HATCH_FILL)
    expect(stateFill(snap, 'WY', 'S', senateStates)).toBe(NO_RACE_FILL)
  })

  it('tints a House state by the party leading most seats', () => {
    // 2 of 3 seats against 1: a 33-point seat lead maps to a margin of 8 + 22 / 3.
    expect(stateFill(snap, 'PA', 'H', senateStates)).toBe(partyTint('DEM', 8 + 22 / 3))
    expect(stateFill(snap, 'GA', 'H', senateStates)).toBe(NO_RACE_FILL)
  })
})

describe('county colors', () => {
  it('ramps turnout from 30% to 80%', () => {
    expect(turnoutColor(null)).toBe(NO_COUNTY_FILL)
    expect(turnoutColor(10)).toBe('rgb(15, 52, 70)')
    expect(turnoutColor(30)).toBe('rgb(15, 52, 70)')
    expect(turnoutColor(55)).toBe('rgb(55, 143, 141)')
    expect(turnoutColor(95)).toBe('rgb(94, 234, 212)')
  })

  it('colors a county by leader or turnout', () => {
    const standing = { county: 'Fulton', leader: candidate('D', 'DEM', 60), margin: 20, votes: [60, 40], totalVotes: 100 }
    expect(countyFill('lead', standing, 50)).toBe(partyTint('DEM', 20))
    expect(countyFill('lead', null, 50)).toBe(NO_COUNTY_FILL)
    expect(countyFill('turnout', standing, 55)).toBe(turnoutColor(55))
  })
})

describe('zoomToBounds', () => {
  it('leaves the whole country unzoomed', () => {
    expect(zoomToBounds(null)).toEqual({ k: 1, x: 0, y: 0 })
  })

  it('centers a state and fills 86% of the frame along its longer side', () => {
    const zoom = zoomToBounds([
      [100, 100],
      [295, 161],
    ])
    // 195 wide is a fifth of the frame; 61 tall is a tenth.
    expect(zoom.k).toBeCloseTo(0.86 * 5)
    expect(zoom.x + (zoom.k * (100 + 295)) / 2).toBeCloseTo(MAP_WIDTH / 2)
    expect(zoom.y + (zoom.k * (100 + 161)) / 2).toBeCloseTo(MAP_HEIGHT / 2)
  })

  it('caps the zoom for tiny states', () => {
    expect(
      zoomToBounds([
        [900, 200],
        [905, 204],
      ]).k,
    ).toBe(MAX_ZOOM)
  })
})

describe('columns', () => {
  it('sizes the column from the face', () => {
    expect(columnSize(40)).toEqual({ width: 14, depth: 6 })
    expect(columnSize(50)).toEqual({ width: 17, depth: 8 })
  })

  it('rises from a stub to 1.1 faces, and 0.45 faces for a callout', () => {
    expect(columnHeight(senate(1, 0, 0), 'GA', 40)).toBe(COLUMN_STUB)
    expect(columnHeight(senate(1, 0, 5), 'GA', 40)).toBe(25)
    expect(columnHeight(senate(1, 0, 10), 'GA', 40)).toBe(44)
    expect(columnHeight(senate(1, 0, 10), 'NH', 40)).toBe(18)
  })
})

describe('spreadMarkers', () => {
  it('pushes overlapping markers apart evenly', () => {
    const items = [
      { key: 'VA', x: 100, y: 100 },
      { key: 'NC', x: 104, y: 100 },
    ]
    spreadMarkers(items, 20)
    expect(items[1].x - items[0].x).toBeCloseTo(20)
    expect(items[0].x + items[1].x).toBeCloseTo(204)
  })

  it('keeps markers inside the sides, still clear of a callout', () => {
    const items = [
      { key: 'NH', x: 950, y: 100 },
      { key: 'ME', x: 960, y: 100 },
    ]
    spreadMarkers(items, 30, { edge: 20, top: 0 })
    expect(items[1].x).toBeLessThanOrEqual(MAP_WIDTH - 20)
    expect(Math.hypot(items[1].x - 950, items[1].y - 100)).toBeGreaterThanOrEqual(30 - 1e-6)
  })

  it('never moves a callout', () => {
    const items = [
      { key: 'NJ', x: 890, y: 285 },
      { key: 'PA', x: 880, y: 285 },
    ]
    spreadMarkers(items, 20)
    expect(items[0]).toMatchObject({ x: 890, y: 285 })
    expect(items[1].x).toBeCloseTo(870)
  })
})

describe('layoutMarkers', () => {
  // Centroids in map units for a handful of states.
  const centers: Record<string, MapPoint> = {
    GA: [700, 450],
    SC: [740, 410],
    MT: [300, 70],
    NH: [880, 130],
    MA: [880, 150],
    TX: [450, 480],
  }
  const centroid = (postal: string) => centers[postal]
  const width = MAP_WIDTH // one pixel per map unit
  const size = 40

  it('places Senate faces on columns and skips states without a leader or shape', () => {
    const snap = snapshot([
      state('GA', [senate(550, 450, 10)]),
      state('TX', [senate(0, 0)]),
      state('ZZ', [senate(1, 0)]),
    ])
    const { markers, columnWidth, depth } = layoutMarkers({ snapshot: snap, office: 'S', centroid, size, width })
    expect(markers.map((m) => m.key)).toEqual(['GA'])
    expect(markers[0]).toMatchObject({ x: 700, y: 450, cx: 700, cy: 450, lift: 44, tally: null })
    expect({ width: columnWidth, depth }).toEqual(columnSize(size))
  })

  it('shows House pills with no column', () => {
    const snap = snapshot([state('GA', [race('H', [candidate('a', 'REP', 5)], 10, 1)])])
    const [marker] = layoutMarkers({ snapshot: snap, office: 'H', centroid, size, width }).markers
    expect(marker.lift).toBe(0)
    expect(marker.tally).toEqual([{ party: 'REP', leading: 1 }])
  })

  it('shortens a column near the top edge so its face stays on the map', () => {
    const snap = snapshot([state('MT', [senate(550, 450, 10)])])
    const [marker] = layoutMarkers({ snapshot: snap, office: 'S', centroid, size, width }).markers
    // 70 down, less the face, the column depth and 6px of room: 18.
    expect(marker.lift).toBe(70 - size - columnSize(size).depth - 6)
    expect(marker.y).toBe(70)
  })

  it('stacks the Atlantic callouts north to south, a face and column apart', () => {
    const snap = snapshot([state('MA', [senate(550, 450, 10)]), state('NH', [senate(550, 450, 10)])])
    const { markers } = layoutMarkers({ snapshot: snap, office: 'S', centroid, size, width })
    const nh = markers.find((m) => m.key === 'NH')!
    const ma = markers.find((m) => m.key === 'MA')!
    expect([nh.x, nh.y]).toEqual(CALLOUTS.NH)
    expect([nh.cx, nh.cy]).toEqual(centers.NH)
    expect(nh.lift).toBe(18)
    expect(ma.x).toBe(CALLOUTS.MA[0])
    // 1.15 gaps plus MA's column below NH, which beats MA's own spot at 165.
    expect(ma.y).toBeCloseTo(CALLOUTS.NH[1] + size * 1.08 * 1.15 + 18)
  })

  it('moves a marker down when even a stub column would put its face off the map', () => {
    const snap = snapshot([state('MT', [senate(550, 450, 10)])])
    const { markers, depth } = layoutMarkers({ snapshot: snap, office: 'S', centroid: () => [300, 10], size, width })
    const [marker] = markers
    expect(marker.lift).toBe(COLUMN_STUB)
    expect(marker.y - marker.lift - size - depth / 2).toBeGreaterThanOrEqual(0)
  })

  it('moves the top callout down when its face would leave the map', () => {
    const snap = snapshot([state('VT', [senate(550, 450, 10)])])
    // A phone-sized map: 360px wide, so 70 map units is only 26px down.
    const small = layoutMarkers({ snapshot: snap, office: 'S', centroid: () => [850, 90], size: 28, width: 360 })
    const [vt] = small.markers
    const pxToMap = MAP_WIDTH / 360
    const faceTop = vt.y / pxToMap - vt.lift - 28 - small.depth / 2
    expect(faceTop).toBeGreaterThanOrEqual(0)
    expect(vt.lift).toBe(COLUMN_STUB)
  })

  it('squeezes the callout stack onto a small map and keeps faces inside the frame', () => {
    const callouts = Object.keys(CALLOUTS)
    const snap = snapshot([...callouts, 'ME'].map((code) => state(code, [senate(550, 450, 10)])))
    const at = (postal: string): MapPoint => (postal === 'ME' ? [960, 60] : [CALLOUTS[postal][0] - 40, CALLOUTS[postal][1]])
    const { markers } = layoutMarkers({ snapshot: snap, office: 'S', centroid: at, size: 28, width: 360 })
    const pxToMap = MAP_WIDTH / 360
    for (const m of markers) {
      expect(m.y).toBeLessThanOrEqual(MAP_HEIGHT - 8 * pxToMap + 1e-6)
      expect(m.x).toBeLessThanOrEqual(MAP_WIDTH - 16 * pxToMap + 1e-6)
    }
    const stack = markers.filter((m) => m.key in CALLOUTS).sort((a, b) => a.y - b.y)
    expect(stack.map((m) => m.key)).toEqual(['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD'])
  })

  it('leaves the callout stack alone when it fits', () => {
    const snap = snapshot(Object.keys(CALLOUTS).map((code) => state(code, [senate(550, 450, 0)])))
    const { markers } = layoutMarkers({ snapshot: snap, office: 'S', centroid: (p) => CALLOUTS[p], size: 40, width: 1200 })
    for (const m of markers) expect(m.x).toBe(CALLOUTS[m.key][0])
  })

  it('spreads neighbors by where their faces sit', () => {
    // SC's column is a stub and GA's is full, so their faces are far enough
    // apart vertically even though the bases are close.
    const snap = snapshot([state('GA', [senate(550, 450, 10)]), state('SC', [senate(550, 450, 0)])])
    const { markers } = layoutMarkers({ snapshot: snap, office: 'S', centroid, size, width })
    const [ga, sc] = markers
    const faces = Math.hypot(ga.x - sc.x, ga.y - ga.lift - (sc.y - sc.lift))
    expect(faces).toBeGreaterThanOrEqual(size * 1.08 - 1e-6)
    expect(ga.lift).toBe(44)
    expect(sc.lift).toBe(COLUMN_STUB)
  })
})
