// Election night results from state election offices: the snapshot shape
// written by backend/election_results.py, and what the results page says
// about it. On top of the counts a race can be called (civicAPI projects a
// winner; counting goes on and a call can be wrong) or certified (the state
// has made its count final). The page keeps the two visibly apart.

export interface ResultsSnapshot {
  election: { date: string; name: string }
  generatedAt: string
  states: Record<string, StateResults>
  // Every Senate race on the ballot (from FEC filings), so states without
  // official counts loaded can still show who ran.
  senate?: SenateRaceInfo[]
}

export interface StateResults {
  state: string
  name: string
  source: {
    name: string
    url: string
    lastUpdated: string | null
    fetchedAt: string
    official: boolean
    // Counts from civicAPI, an independent aggregator, for states we can't
    // read directly; stateUrl is the state's own results page.
    aggregator?: boolean
    stateUrl?: string | null
  }
  registered: number | null
  ballots: number | null
  counties: Record<string, { registered: number; ballots: number | null }>
  races: RaceResult[]
}

export interface RaceResult {
  office: 'S' | 'H'
  district: number
  label: string
  special: boolean
  totalVotes: number
  reporting: { done: number | null; total: number | null; unit: 'counties' | 'precincts' | 'towns' | 'percent' }
  candidates: ResultCandidate[]
  // County name -> votes per candidate, in `candidates` order.
  counties: Record<string, number[]>
  // civicAPI's projected winner, named as on our ballot line.
  call?: RaceCall
  // The date (YYYY-MM-DD) the state certified this race's count.
  certified?: string
}

export interface RaceCall {
  winner: string
  party: string
  source: string
  // When the call was made, if civicAPI says.
  at: string | null
}

export interface ResultCandidate {
  name: string
  party: string
  votes: number
  incumbent?: boolean
  writeIn?: boolean
  profile?: CandidateProfile
}

export interface CandidateProfile {
  officialId: string
  fecId: string
  name: string | null
  photoUrl: string | null
  isMember?: boolean | null
  receipts: number | null
  disbursements: number | null
  outsideSupport?: number | null
  outsideOppose?: number | null
}

export interface SenateRaceInfo {
  state: string
  stateName: string
  label: string
  resultsUrl: string | null
  candidates: { name: string; party: string; incumbent: boolean; profile: CandidateProfile | null }[]
}

export const RESULTS_ELECTION_DATE = '2026-11-03'
// States take a few weeks to certify; the link stays up while counts can still move.
const RESULTS_LINK_DAYS = 45

/**
 * Whether Happening Now points to the results page on `today` (YYYY-MM-DD,
 * local): 'tonight' on Election Day, 'counting' in the weeks after.
 */
export function resultsLinkPhase(today: string, electionDate = RESULTS_ELECTION_DATE): 'tonight' | 'counting' | null {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${electionDate}T00:00:00Z`)) / 86_400_000)
  if (Number.isNaN(days) || days < 0 || days > RESULTS_LINK_DAYS) return null
  return days === 0 ? 'tonight' : 'counting'
}

/**
 * The Election Results GitHub Action (.github/workflows/election-results.yml)
 * reads the state results sites every few minutes and force-pushes the
 * snapshot to this data-only branch.
 */
export const RESULTS_SNAPSHOT_URL =
  'https://raw.githubusercontent.com/Walastik/politmus-data-workers/election-results-data/2026-11-03.json'

/**
 * GitHub's raw file CDN caches each URL for five minutes; a query string that
 * changes every minute skips that. It also caches which commit the branch
 * points to for a few minutes, so a new run shows up within about ten.
 */
export function snapshotRequestUrl(base: string, now = Date.now()): string {
  if (!/^https?:/.test(base)) return base
  return `${base}${base.includes('?') ? '&' : '?'}t=${Math.floor(now / 60_000)}`
}

// ---- Parties and colors ----

export type PartyKey = 'DEM' | 'REP' | 'IND' | 'LIB' | 'GRN' | 'OTH'

export function partyKey(party: string | null | undefined): PartyKey {
  const key = (party ?? '').toUpperCase()
  return key === 'DEM' || key === 'REP' || key === 'IND' || key === 'LIB' || key === 'GRN' ? key : 'OTH'
}

export const PARTY_LABEL: Record<PartyKey, string> = {
  DEM: 'Democrat',
  REP: 'Republican',
  IND: 'Independent',
  LIB: 'Libertarian',
  GRN: 'Green',
  OTH: 'Other',
}

export const PARTY_SHORT: Record<PartyKey, string> = { DEM: 'D', REP: 'R', IND: 'I', LIB: 'L', GRN: 'G', OTH: 'O' }

// Saturated party colors for marks; tints come from partyTint.
export const PARTY_COLOR: Record<PartyKey, string> = {
  DEM: '#3b82f6',
  REP: '#ef4444',
  IND: '#a855f7',
  LIB: '#eab308',
  GRN: '#22c55e',
  OTH: '#94a3b8',
}

// A fill for a leader's margin: pale for a toss-up, full color for a rout.
// Margin is in percentage points.
export function partyTint(party: string, margin: number): string {
  const strength = Math.max(0.18, Math.min(1, margin / 30))
  const [r, g, b] = hexRgb(PARTY_COLOR[partyKey(party)])
  // Blend toward the dark map background so a narrow lead reads as dim.
  const base = [30, 41, 59]
  const mix = (c: number, i: number) => Math.round(base[i] + (c - base[i]) * strength)
  return `rgb(${mix(r, 0)}, ${mix(g, 1)}, ${mix(b, 2)})`
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---- Race math ----

export interface RaceStanding {
  ranked: ResultCandidate[]
  leader: ResultCandidate | null
  runnerUp: ResultCandidate | null
  // Leader's lead over the runner-up, in percentage points of all votes.
  margin: number
  marginVotes: number
  totalVotes: number
}

export function share(votes: number, total: number): number {
  return total > 0 ? (votes / total) * 100 : 0
}

// Candidates by votes, without write-in lines that got nothing.
export function rankedCandidates(race: RaceResult): ResultCandidate[] {
  return race.candidates.filter((c) => !c.writeIn || c.votes > 0).sort((a, b) => b.votes - a.votes)
}

export function raceStanding(race: RaceResult): RaceStanding {
  const ranked = rankedCandidates(race).filter((c) => c.votes > 0)
  const totalVotes = race.candidates.reduce((sum, c) => sum + c.votes, 0)
  const [leader = null, runnerUp = null] = ranked
  const marginVotes = leader ? leader.votes - (runnerUp?.votes ?? 0) : 0
  return { ranked, leader, runnerUp, margin: share(marginVotes, totalVotes), marginVotes, totalVotes }
}

export function reportingShare(race: RaceResult): number | null {
  const { done, total } = race.reporting
  return done !== null && total ? done / total : null
}

// "159 of 159 counties", "95% of precincts"
export function reportingLabel(race: RaceResult): string {
  const { done, total, unit } = race.reporting
  if (done === null || !total) return 'Reporting status not published'
  if (unit === 'percent') return done >= 100 ? 'All reporting' : `About ${Math.round(done)}% reporting`
  if (done >= total) return `All ${total.toLocaleString('en-US')} ${unit} reporting`
  return `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${unit} reporting`
}

// "+18.6"
export function formatMargin(margin: number): string {
  return `+${margin < 10 ? margin.toFixed(1) : Math.round(margin)}`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatVotes(votes: number): string {
  return votes.toLocaleString('en-US')
}

// "$146M", "$4.2M", "$812K"
export function formatMoney(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`
  if (amount >= 1e6) return `$${amount >= 1e7 ? Math.round(amount / 1e6) : (amount / 1e6).toFixed(1)}M`
  if (amount >= 1e3) return `$${Math.round(amount / 1e3)}K`
  return `$${Math.round(amount)}`
}

// Money raised per vote won, when both are known.
export function dollarsPerVote(candidate: ResultCandidate): number | null {
  const receipts = candidate.profile?.receipts
  return receipts && candidate.votes > 0 ? receipts / candidate.votes : null
}

export function raceKey(state: string, race: Pick<RaceResult, 'office' | 'district'>): string {
  return race.office === 'S' ? `${state}-S` : `${state}-H${race.district}`
}

export function senateRace(state: StateResults | undefined): RaceResult | null {
  return state?.races.find((race) => race.office === 'S') ?? null
}

export function houseRaces(state: StateResults | undefined): RaceResult[] {
  return (state?.races ?? []).filter((race) => race.office === 'H').sort((a, b) => a.district - b.district)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${suffix}`
}

// States publish update times in their own formats: ISO 8601, or Clarity's
// "11/4/2026 9:16:43 AM MST". ISO times show on the viewer's clock; a local
// time keeps the zone it was published in. "Nov 4, 9:16 am".
export function formatSourceTime(raw: string | null | undefined): string {
  if (!raw) return ''
  const local = /^(\d{1,2})\/(\d{1,2})\/\d{4} (\d{1,2}):(\d{2})(?::\d{2})? ([AP]M)(?: ([A-Z]{2,4}))?$/i.exec(raw.trim())
  if (local) {
    const [, month, day, hour, minute, half, zone] = local
    const h24 = (Number(hour) % 12) + (half.toUpperCase() === 'PM' ? 12 : 0)
    return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${clock(h24, Number(minute))}${zone ? ` ${zone}` : ''}`
  }
  const time = Date.parse(raw)
  if (Number.isNaN(time)) return raw
  const date = new Date(time)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${clock(date.getHours(), date.getMinutes())}`
}

// ---- Counties ----

export interface CountyStanding {
  county: string
  leader: ResultCandidate | null
  margin: number
  totalVotes: number
  votes: number[]
}

export function countyStanding(race: RaceResult, county: string): CountyStanding | null {
  const votes = race.counties[county]
  if (!votes) return null
  const totalVotes = votes.reduce((sum, v) => sum + v, 0)
  const order = votes.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])
  const [first, second] = order
  const leader = first && first[0] > 0 ? race.candidates[first[1]] : null
  return {
    county,
    leader,
    margin: share((first?.[0] ?? 0) - (second?.[0] ?? 0), totalVotes),
    totalVotes,
    votes,
  }
}

export function countyTurnout(state: StateResults, county: string): number | null {
  const row = state.counties[county]
  return row && row.registered > 0 && row.ballots ? (row.ballots / row.registered) * 100 : null
}

// Every race in the state has all its counties or precincts reporting.
export function isAggregated(state: StateResults | undefined): boolean {
  return Boolean(state?.source.aggregator)
}

export const AGGREGATOR = { name: 'civicAPI', url: 'https://civicapi.org' }

export function countingComplete(state: StateResults): boolean {
  return state.races.length > 0 && state.races.every((race) => (reportingShare(race) ?? 0) >= 1)
}

export function stateTurnout(state: StateResults): number | null {
  return state.registered && state.ballots ? (state.ballots / state.registered) * 100 : null
}

// ---- Seat tallies ----

export interface SeatTally {
  party: PartyKey
  leading: number
}

// Who leads the House seats a state's counts cover, e.g. VA: D 7, R 4.
export function houseTally(state: StateResults | undefined): SeatTally[] {
  const counts = new Map<PartyKey, number>()
  for (const race of houseRaces(state)) {
    const leader = raceStanding(race).leader
    if (leader) counts.set(partyKey(leader.party), (counts.get(partyKey(leader.party)) ?? 0) + 1)
  }
  return [...counts].map(([party, leading]) => ({ party, leading })).sort((a, b) => b.leading - a.leading)
}

export function senateTally(snapshot: ResultsSnapshot): SeatTally[] {
  const counts = new Map<PartyKey, number>()
  for (const state of Object.values(snapshot.states)) {
    const race = senateRace(state)
    const leader = race ? raceStanding(race).leader : null
    if (leader) counts.set(partyKey(leader.party), (counts.get(partyKey(leader.party)) ?? 0) + 1)
  }
  return [...counts].map(([party, leading]) => ({ party, leading })).sort((a, b) => b.leading - a.leading)
}

// ---- Highlights ----

export type HighlightKind =
  | 'closest'
  | 'incumbent-behind'
  | 'money-underdog'
  | 'priciest-votes'
  | 'turnout-high'
  | 'turnout-low'
  | 'landslide'

export interface Highlight {
  kind: HighlightKind
  title: string
  headline: string
  detail: string
  state: string
  raceKey: string | null
  county?: string
  candidate?: ResultCandidate
  // Positive is better for sorting within a kind.
  score: number
}

interface RaceRef {
  state: StateResults
  race: RaceResult
  standing: RaceStanding
}

function allRaces(snapshot: ResultsSnapshot): RaceRef[] {
  return Object.values(snapshot.states).flatMap((state) =>
    state.races
      .map((race) => ({ state, race, standing: raceStanding(race) }))
      // Uncontested seats aren't news.
      .filter(({ standing }) => standing.leader && standing.runnerUp && standing.runnerUp.votes > 0),
  )
}

function raceName(ref: RaceRef): string {
  return ref.race.office === 'S' ? `${ref.state.name} Senate` : `${ref.state.state}-${ref.race.district}`
}

function lastName(name: string): string {
  const parts = name.replace(/,.*$/, '').split(/\s+/).filter((p) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(p))
  return parts.at(-1) ?? name
}

// The most interesting things in the counts so far, a few of each kind.
export function resultHighlights(snapshot: ResultsSnapshot): Highlight[] {
  const races = allRaces(snapshot)
  const highlights: Highlight[] = []

  // Closest races.
  for (const ref of [...races].sort((a, b) => a.standing.margin - b.standing.margin).slice(0, 3)) {
    const { leader, runnerUp, marginVotes, margin } = ref.standing
    if (!leader || !runnerUp) continue
    highlights.push({
      kind: 'closest',
      title: 'Closest race',
      headline: `${raceName(ref)}: ${formatVotes(marginVotes)} votes apart`,
      detail: `${leader.name} leads ${runnerUp.name} by ${margin.toFixed(2)} points.`,
      state: ref.state.state,
      raceKey: raceKey(ref.state.state, ref.race),
      candidate: leader,
      score: -margin,
    })
  }

  // Incumbents behind.
  for (const ref of races) {
    const incumbent = ref.race.candidates.find((c) => c.incumbent)
    const { leader, totalVotes } = ref.standing
    if (!incumbent || !leader || incumbent === leader) continue
    const behindVotes = leader.votes - incumbent.votes
    const behind = share(behindVotes, totalVotes)
    highlights.push({
      kind: 'incumbent-behind',
      title: 'Incumbent behind',
      headline: `${incumbent.name} trails in ${raceName(ref)}`,
      detail: `${leader.name} (${PARTY_SHORT[partyKey(leader.party)]}) leads the sitting member by ${
        behind < 0.1 ? `${formatVotes(behindVotes)} votes` : `${behind.toFixed(1)} points`
      }.`,
      state: ref.state.state,
      raceKey: raceKey(ref.state.state, ref.race),
      candidate: leader,
      score: behind,
    })
  }

  // The candidate who raised less is ahead.
  for (const ref of races) {
    const { leader, runnerUp } = ref.standing
    const lead = leader?.profile?.receipts
    const trail = runnerUp?.profile?.receipts
    if (!leader || !runnerUp || !lead || !trail || trail < lead * 1.5 || trail < 500_000) continue
    highlights.push({
      kind: 'money-underdog',
      title: 'Money didn’t decide it',
      headline: `${lastName(leader.name)} leads despite being outraised ${(trail / lead).toFixed(1)} to 1`,
      detail: `${runnerUp.name} raised ${formatMoney(trail)} to ${leader.name}’s ${formatMoney(lead)} in ${raceName(ref)}.`,
      state: ref.state.state,
      raceKey: raceKey(ref.state.state, ref.race),
      candidate: leader,
      score: trail / lead,
    })
  }

  // Most money raised per vote, among fully reported races: a partial count
  // makes every vote look expensive. civicAPI's "fully reported" can mean
  // precincts while mail ballots are still counted, so its races sit this out.
  const priced = races
    .filter((ref) => (reportingShare(ref.race) ?? 0) >= 1 && !isAggregated(ref.state))
    .flatMap((ref) => ref.standing.ranked.slice(0, 2).map((c) => ({ ref, c, perVote: dollarsPerVote(c) })))
    .filter((x): x is { ref: RaceRef; c: ResultCandidate; perVote: number } => x.perVote !== null && x.c.votes > 5000)
    .sort((a, b) => b.perVote - a.perVote)
  for (const { ref, c, perVote } of priced.slice(0, 2)) {
    highlights.push({
      kind: 'priciest-votes',
      title: 'Priciest votes',
      headline: `$${perVote.toFixed(2)} raised per vote`,
      detail: `${c.name} raised ${formatMoney(c.profile?.receipts ?? 0)} for ${formatVotes(c.votes)} votes in ${raceName(ref)}.`,
      state: ref.state.state,
      raceKey: raceKey(ref.state.state, ref.race),
      candidate: c,
      score: perVote,
    })
  }

  // Biggest landslide among competitive-looking Senate races.
  const landslide = races.filter((r) => r.race.office === 'S').sort((a, b) => b.standing.margin - a.standing.margin)[0]
  if (landslide?.standing.leader) {
    highlights.push({
      kind: 'landslide',
      title: 'Biggest Senate lead',
      headline: `${landslide.standing.leader.name} ${formatMargin(landslide.standing.margin)}`,
      detail: `${formatVotes(landslide.standing.marginVotes)} votes ahead in ${landslide.state.name}.`,
      state: landslide.state.state,
      raceKey: raceKey(landslide.state.state, landslide.race),
      candidate: landslide.standing.leader,
      score: landslide.standing.margin,
    })
  }

  // County turnout extremes, among counties with at least 2,000 voters, in
  // states that have finished their election night count (a county still
  // counting would look like low turnout).
  const turnouts = Object.values(snapshot.states).filter(countingComplete).flatMap((state) =>
    Object.keys(state.counties)
      .map((county) => ({ state, county, turnout: countyTurnout(state, county) }))
      .filter((x): x is { state: StateResults; county: string; turnout: number } =>
        x.turnout !== null && x.turnout <= 100 && (x.state.counties[x.county]?.registered ?? 0) >= 2000,
      ),
  )
  turnouts.sort((a, b) => b.turnout - a.turnout)
  const turnoutCard = (x: (typeof turnouts)[number], kind: 'turnout-high' | 'turnout-low'): Highlight => {
    const stateWide = stateTurnout(x.state)
    return {
      kind,
      title: kind === 'turnout-high' ? 'Highest turnout' : 'Lowest turnout',
      headline: `${countyLabel(x.state, x.county)}: ${x.turnout.toFixed(1)}%`,
      detail: `of registered voters cast a ballot${stateWide ? `, against ${stateWide.toFixed(1)}% statewide` : ''}.`,
      state: x.state.state,
      raceKey: senateRace(x.state) ? raceKey(x.state.state, { office: 'S', district: 0 }) : null,
      county: x.county,
      score: kind === 'turnout-high' ? x.turnout : -x.turnout,
    }
  }
  if (turnouts[0]) highlights.push(turnoutCard(turnouts[0], 'turnout-high'))
  if (turnouts.length > 1) highlights.push(turnoutCard(turnouts[turnouts.length - 1], 'turnout-low'))

  // Say so when a story rests on aggregator counts.
  return interleave(highlights, HIGHLIGHT_ORDER, MAX_HIGHLIGHTS).map((h) =>
    isAggregated(snapshot.states[h.state]) ? { ...h, detail: `${h.detail} Counts via civicAPI.` } : h,
  )
}

const HIGHLIGHT_ORDER: HighlightKind[] = [
  'closest',
  'incumbent-behind',
  'money-underdog',
  'priciest-votes',
  'turnout-high',
  'landslide',
  'turnout-low',
]
const MAX_HIGHLIGHTS = 14

// The best of each kind first, then the next best of each, so the strip
// opens with a variety of stories.
function interleave(highlights: Highlight[], order: HighlightKind[], max: number): Highlight[] {
  const groups = order.map((kind) => highlights.filter((h) => h.kind === kind).sort((a, b) => b.score - a.score))
  const result: Highlight[] = []
  for (let round = 0; result.length < max && groups.some((g) => g.length > round); round++) {
    for (const group of groups) if (group[round] && result.length < max) result.push(group[round])
  }
  return result
}

export interface FlipTally {
  party: PartyKey
  seats: number
}

// House seats where a challenger leads the sitting member, by the party
// that would gain them.
export function houseFlips(snapshot: ResultsSnapshot): FlipTally[] {
  const counts = new Map<PartyKey, number>()
  for (const state of Object.values(snapshot.states)) {
    for (const race of houseRaces(state)) {
      const incumbent = race.candidates.find((c) => c.incumbent)
      const leader = raceStanding(race).leader
      if (!incumbent || !leader || partyKey(leader.party) === partyKey(incumbent.party)) continue
      counts.set(partyKey(leader.party), (counts.get(partyKey(leader.party)) ?? 0) + 1)
    }
  }
  return [...counts].map(([party, seats]) => ({ party, seats })).sort((a, b) => b.seats - a.seats)
}

// "Fulton County, GA" or "Alexandria, VA" for an independent city.
export function countyLabel(state: Pick<StateResults, 'state'>, county: string): string {
  if (county.endsWith(' city')) return `${county.slice(0, -5)}, ${state.state}`
  const noun = state.state === 'LA' ? 'Parish' : state.state === 'AK' ? 'Borough' : 'County'
  return `${county} ${noun}, ${state.state}`
}

// ---- Map geography ----

// us-atlas state ids are FIPS codes.
export const STATE_FIPS: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
}

// A results county name for a us-atlas county feature. Virginia's
// independent cities (FIPS 510 and up) carry a " city" suffix in results.
export function countyNameForFeature(fips: string, name: string): string {
  const stateFips = fips.slice(0, 2)
  const countyCode = Number(fips.slice(2))
  if (stateFips === '51' && countyCode >= 510) return `${name} city`
  return name
}

// Lowercased, punctuation-free key for matching county names across sources
// ("St. Clair" / "Saint Clair", "DeKalb" / "De Kalb").
export function countyMatchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z0-9]/g, '')
}

// ---- Calls and certification ----

// certified: the state has made its count final. called: civicAPI projects a
// winner, but counting goes on and the call can still be wrong. counting:
// nobody has called it; a candidate only leads.
export type RaceStatus = 'certified' | 'called' | 'counting'

export function raceStatus(race: RaceResult): RaceStatus {
  if (race.certified) return 'certified'
  return race.call && raceWinner(race) ? 'called' : 'counting'
}

// Who won: the leader of a certified count, or the candidate civicAPI called.
export function raceWinner(race: RaceResult): ResultCandidate | null {
  if (race.certified) return raceStanding(race).leader
  return race.call ? (race.candidates.find((c) => c.name === race.call?.winner) ?? null) : null
}

export const STATUS_LABEL: Record<RaceStatus, string> = { certified: 'Certified', called: 'Called', counting: 'Counting' }

export const STATUS_EXPLAINER: Record<Exclude<RaceStatus, 'counting'>, string> = {
  called: 'civicAPI, an independent aggregator, projects a winner. Votes are still being counted and a call can be wrong.',
  certified: 'The state has certified its count. The result is final.',
}

// "Called by civicAPI Nov 4", "Certified Nov 21"
export function statusLine(race: RaceResult): string | null {
  const status = raceStatus(race)
  if (status === 'certified') return `Certified ${formatDay(race.certified!)}`
  if (status === 'called') {
    const day = race.call?.at ? formatDay(race.call.at) : ''
    return `Called by ${race.call?.source}${day ? ` ${day}` : ''}`
  }
  return null
}

function formatDay(raw: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// ---- The next Congress ----
//
// A quick before and after: who holds each chamber now, and who would if
// every race ends the way it stands. It reads the same counts as the page but
// is its own projection; the scoreboard's leads don't change.

// Democrats, Republicans, and everyone else (independents who don't caucus
// with either party, third parties).
export type Bloc = 'DEM' | 'REP' | 'OTH'
export const BLOCS: Bloc[] = ['DEM', 'REP', 'OTH']

export function blocOf(party: string | null | undefined): Bloc {
  const key = partyKey(party)
  return key === 'DEM' || key === 'REP' ? key : 'OTH'
}

export const BLOC_LABEL: Record<Bloc, string> = { DEM: 'Democrats', REP: 'Republicans', OTH: 'Independents and others' }
export const BLOC_SHORT: Record<Bloc, string> = { DEM: 'D', REP: 'R', OTH: 'Other' }
export const BLOC_COLOR: Record<Bloc, string> = { DEM: PARTY_COLOR.DEM, REP: PARTY_COLOR.REP, OTH: PARTY_COLOR.OTH }

// The 119th Congress as elected in 2024. Senate Democrats include Angus King
// (ME) and Bernie Sanders (VT), independents who caucus with them.
export const CONGRESS_BEFORE: Record<'S' | 'H', Record<Bloc, number>> = {
  S: { DEM: 47, REP: 53, OTH: 0 },
  H: { DEM: 215, REP: 220, OTH: 0 },
}
// Senators whose seats weren't on the 2026 ballot: 65 of 100. The 35 up were
// the 33 regular Class 2 seats (20 R, 13 D) and specials in Ohio and Florida
// (both R appointees). King and Sanders count with the Democrats.
export const SENATE_HOLDOVERS: Record<Bloc, number> = { DEM: 34, REP: 31, OTH: 0 }
export const SENATE_SEATS_UP = 35
// The president serves through January 2029; the vice president breaks Senate ties.
export const PRESIDENT_PARTY: Bloc = 'REP'

export const CHAMBER_SIZE = { S: 100, H: 435 } as const
// Seats one party needs. Senate: 51, or 50 for the vice president's party.
export const MAJORITY = { S: 51, H: 218 } as const
// Ending a filibuster (cloture) takes three-fifths of the Senate.
export const CLOTURE = 60
// Two-thirds of a full chamber: veto overrides, constitutional amendments;
// in the Senate also treaties and convicting an impeached official; in the
// House, passing a bill under suspension of the rules.
export const TWO_THIRDS = { S: 67, H: 290 } as const

export interface BlocSeats {
  bloc: Bloc
  before: number
  after: number
  // Senate seats not on this ballot.
  holdover: number
  certified: number
  called: number
  leading: number
}

export interface ChamberOutlook {
  office: 'S' | 'H'
  size: number
  seats: Record<Bloc, BlocSeats>
  // Seats on the ballot with no votes counted yet (or not in our data).
  uncounted: number
  controlBefore: Bloc | null
  controlAfter: Bloc | null
  // Who controls on seats that are certified, called or not up alone, if anyone.
  controlSettled: Bloc | null
}

// Whose chamber it is with these seats, or null when no bloc has a majority
// (independents decide). The vice president's party controls a 50-50 Senate.
export function chamberControl(office: 'S' | 'H', seats: Record<Bloc, number>): Bloc | null {
  if (office === 'S' && seats[PRESIDENT_PARTY] >= 50) return PRESIDENT_PARTY
  return (BLOCS.find((bloc) => seats[bloc] >= MAJORITY[office]) ?? null)
}

export function chamberOutlook(snapshot: ResultsSnapshot, office: 'S' | 'H'): ChamberOutlook {
  const before = CONGRESS_BEFORE[office]
  const holdover = office === 'S' ? SENATE_HOLDOVERS : { DEM: 0, REP: 0, OTH: 0 }
  const seats = Object.fromEntries(
    BLOCS.map((bloc) => [bloc, { bloc, before: before[bloc], after: holdover[bloc], holdover: holdover[bloc], certified: 0, called: 0, leading: 0 }]),
  ) as Record<Bloc, BlocSeats>
  let counted = 0
  for (const state of Object.values(snapshot.states)) {
    for (const race of state.races) {
      if (race.office !== office) continue
      const status = raceStatus(race)
      const party = status === 'counting' ? raceStanding(race).leader?.party : raceWinner(race)?.party
      if (!party) continue
      const row = seats[blocOf(party)]
      counted += 1
      row.after += 1
      if (status === 'certified') row.certified += 1
      else if (status === 'called') row.called += 1
      else row.leading += 1
    }
  }
  const onBallot = office === 'S' ? Math.max(SENATE_SEATS_UP, snapshot.senate?.length ?? 0) : CHAMBER_SIZE.H
  const settled = (bloc: Bloc) => seats[bloc].holdover + seats[bloc].certified + seats[bloc].called
  return {
    office,
    size: CHAMBER_SIZE[office],
    seats,
    uncounted: Math.max(0, onBallot - counted),
    controlBefore: chamberControl(office, before),
    controlAfter: chamberControl(office, { DEM: seats.DEM.after, REP: seats.REP.after, OTH: seats.OTH.after }),
    controlSettled: chamberControl(office, { DEM: settled('DEM'), REP: settled('REP'), OTH: settled('OTH') }),
  }
}

const CHAMBER_NAME = { S: 'Senate', H: 'House' } as const

// "Flips to Democrats", "Republicans keep it", "No majority"
export function controlHeadline(outlook: ChamberOutlook): string {
  const { controlBefore: before, controlAfter: after } = outlook
  if (!after) return 'No majority yet'
  if (after !== before) return `Flips to ${BLOC_LABEL[after]}`
  return `${BLOC_LABEL[after]} keep it`
}

function seatWord(n: number) {
  return `${n} ${n === 1 ? 'seat' : 'seats'}`
}

/**
 * What the projected seats would mean: who controls the chamber, how much
 * room the majority has, and which supermajority rules it clears or misses.
 */
export function chamberNotes(outlook: ChamberOutlook): string[] {
  const { office, seats, controlAfter: after, controlBefore: before } = outlook
  const chamber = CHAMBER_NAME[office]
  const notes: string[] = []
  const change = (bloc: Bloc) => {
    const diff = seats[bloc].after - seats[bloc].before
    return diff === 0 ? 'no change' : `${diff > 0 ? '+' : ''}${diff}`
  }

  if (!after) {
    const top = BLOCS.reduce((a, b) => (seats[b].after > seats[a].after ? b : a))
    notes.push(
      `No party reaches ${MAJORITY[office]}. ${BLOC_LABEL[top]} would have ${seats[top].after}, so control would turn on ${seatWord(seats.OTH.after)} held by independents and others.`,
    )
  } else {
    const n = seats[after].after
    const other = after === 'DEM' ? 'REP' : 'DEM'
    notes.push(
      after === before
        ? `${BLOC_LABEL[after]} would keep the ${chamber}, ${n} to ${seats[other].after} (${change(after)} from ${seats[after].before}).`
        : `${BLOC_LABEL[after]} would take the ${chamber}, ${n} to ${seats[other].after}, up from ${seats[after].before}.`,
    )
    // On a party-line vote, how many of its own members the majority can lose.
    // The vice president's party can lose one more in the Senate and still tie.
    const needed = office === 'S' && after === PRESIDENT_PARTY ? 50 : MAJORITY[office]
    const cushion = n - needed
    const majorityBefore = before === after ? seats[after].before - needed : null
    notes.push(
      cushion === 0
        ? `No room to spare: one defection would sink a simple-majority vote.`
        : `${BLOC_LABEL[after]} could lose ${cushion} of their own on a simple-majority vote and still win it${
            majorityBefore !== null && majorityBefore !== cushion
              ? `, ${cushion > majorityBefore ? 'up' : 'down'} from ${majorityBefore} now`
              : ''
          }.`,
    )
    if (office === 'S') {
      notes.push(
        n >= CLOTURE
          ? `${n} seats clears the 60 needed to end a filibuster, so ${BLOC_LABEL[after]} could pass most bills without the other party.`
          : `${n} seats is ${CLOTURE - n} short of the 60 needed to end a filibuster, so most bills would still need votes from the other side. Budget reconciliation and confirmations need only a simple majority.`,
      )
    }
    const twoThirds = TWO_THIRDS[office]
    if (n >= twoThirds) {
      notes.push(
        office === 'S'
          ? `${n} seats is two-thirds of the Senate: enough alone to override a veto, ratify a treaty or convict an impeached official.`
          : `${n} seats is two-thirds of the House: enough alone to override a veto or pass bills under suspension of the rules.`,
      )
    } else if (twoThirds - n <= 10) {
      notes.push(`${n} seats is ${twoThirds - n} short of the ${twoThirds} (two-thirds) that overrides a veto.`)
    }
  }

  if (outlook.controlSettled && outlook.controlSettled === after) {
    notes.push(`Settled: ${BLOC_LABEL[after!]} have a majority from called and certified races alone.`)
  } else if (after) {
    const firm = seats[after].holdover + seats[after].certified + seats[after].called
    notes.push(
      `Not settled: ${BLOC_LABEL[after]} have ${firm} seats ${office === 'S' ? 'not up, ' : ''}called or certified, and ${MAJORITY[office]} is a majority. The rest are leads.`,
    )
  }
  if (outlook.uncounted) notes.push(`${seatWord(outlook.uncounted)} on the ballot ${outlook.uncounted === 1 ? 'has' : 'have'} no votes counted here yet.`)
  return notes
}

/** What both chambers together would mean, with the president's party. */
export function congressNotes(senate: ChamberOutlook, house: ChamberOutlook): string[] {
  const president = BLOC_LABEL[PRESIDENT_PARTY]
  const s = senate.controlAfter
  const h = house.controlAfter
  const notes: string[] = []
  const trifectaBefore = senate.controlBefore === PRESIDENT_PARTY && house.controlBefore === PRESIDENT_PARTY
  if (s === PRESIDENT_PARTY && h === PRESIDENT_PARTY) {
    notes.push(`${president} would keep the White House, Senate and House${trifectaBefore ? '' : ', a new trifecta'}.`)
  } else if (s && h && s === h) {
    notes.push(
      `${BLOC_LABEL[s]} would control both chambers against a ${PARTY_LABEL[PRESIDENT_PARTY as PartyKey]} president${
        trifectaBefore ? `, ending the ${PARTY_LABEL[PRESIDENT_PARTY as PartyKey]} trifecta` : ''
      }. The president's agenda would need ${BLOC_LABEL[s]}' votes, and the veto becomes the president's main tool.`,
    )
  } else if (s && h) {
    notes.push(
      `A split Congress: ${BLOC_LABEL[h]} would run the House and ${BLOC_LABEL[s]} the Senate${trifectaBefore ? `, ending the ${PARTY_LABEL[PRESIDENT_PARTY as PartyKey]} trifecta` : ''}. Most bills would need both parties to pass.`,
    )
  }
  if (s && s !== PRESIDENT_PARTY) {
    notes.push(`A Senate run by ${BLOC_LABEL[s]} decides which of the president's judges and cabinet picks are confirmed.`)
  }
  if (h && h !== PRESIDENT_PARTY && house.controlBefore === PRESIDENT_PARTY) {
    notes.push(`The new House majority would pick the Speaker and chair every committee, with the power to subpoena and investigate.`)
  }
  const overrideS = s ? senate.seats[s].after >= TWO_THIRDS.S : false
  const overrideH = h ? house.seats[h].after >= TWO_THIRDS.H : false
  if (s && h && s === h && s !== PRESIDENT_PARTY) {
    notes.push(
      overrideS && overrideH
        ? `${BLOC_LABEL[s]} would have two-thirds of both chambers, enough to override a veto on their own.`
        : `Overriding a veto takes two-thirds of both chambers (${TWO_THIRDS.H} House, ${TWO_THIRDS.S} Senate); ${BLOC_LABEL[s]} would not have that alone.`,
    )
  }
  return notes
}
