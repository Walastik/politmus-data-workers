# Election results on iOS and Android: plan

Port the `/results` explorer to the native app, so the Results screen shows
the map, races and highlights instead of a link to politmus.com. Written
Nov. 5, 2026, the night after the election, from the session that built the
web page's current map.

## Where things stand

- **Web:** `apps/app/src/components/results/ElectionResults.web.tsx` (about 1,500
  lines) and `results.css`. It is plain DOM: `<div>`s, `<button>`s, an HTML
  marker layer over an SVG map, CSS transitions, mouse hover, `window`
  APIs. None of it runs on native.
- **Native today:** `ElectionResults.tsx` is a stub that links to
  politmus.com/results. Expo picks `.web.tsx` on web and `.tsx` on native, so
  the port replaces the stub and leaves the web file alone.
- **Shared and ready:** `packages/core/src/electionResults.ts` has all the
  results logic with tests: types, `raceStanding`, `reportingShare`,
  `senateTally`, `houseTally`, `houseFlips`, `resultHighlights`,
  `countyStanding`, `countyTurnout`, `partyTint`, `PARTY_COLOR`, the
  formatters, `STATE_FIPS`, `countyNameForFeature`, `countyMatchKey`,
  `snapshotRequestUrl`.
- **Route and entry point:** `src/app/results.tsx` already shows the app
  header (back arrow, or the Politmus link from a shared link).
  `ResultsCard` on Happening Now (`HappeningNow.tsx`) already does
  `router.push('/results')`, so it works on native as soon as the screen does.
- **Libraries already installed and in Expo Go:** `react-native-svg` 15.16,
  `react-native-reanimated` 4.7, `react-native-gesture-handler` 3.3,
  `expo-image` (see `OfficialPhoto.tsx`), `d3-geo`, `topojson-client`,
  `@tanstack/react-query`. Nothing new should need installing; if something
  does, use `npx expo install`.
- **Expo SDK 58.** Per `apps/app/AGENTS.md`, read the v58 docs before using an
  Expo or React Native API rather than going from memory.
- **The apps aren't released** (see `docs/deploy.md`), so there's no
  deadline, and results stay on the web until the app ships.

## What the web page does (the feature list to match)

1. **Hero:** title, Senate leads (`senateTally`), House seats changing
   hands (`houseFlips`), snapshot time, "Refreshes every minute".
2. **Chamber switch:** Senate or House.
3. **National map:** states filled by leader and margin (`stateFill`), gray
   hatch where there's no race.
   - Senate: each leader's photo, with a vote-share ring and margin pill, on a
     3D party-colored column. The column's height is the share of the
     count reported, from a 6px stub to full height; it rises once on load,
     then only moves when the count changes.
   - House: a seat-count pill per state (for example "R 5 · D 3").
   - States counted via civicAPI get a dashed ring.
4. **State drill-down:** tapping a state zooms the map to it (animated
   transform), fades out the markers, and draws its counties. Counties are
   colored by lead or by turnout, and a highlighted county gets a yellow
   outline. There's a back button.
5. **Side panel:**
   - Nothing selected (`Overview`): races closest first, or the House list.
   - A state selected (`StatePanel`): race chips, the House seat grid with
     flips, the candidate cards (photo, share bar, money, profile link), the
     "tug of war" bar between the top two, stats, the county lists, and a
     civicAPI note where it applies.
6. **Highlights:** horizontal cards (closest race, incumbent behind, money
   underdog, priciest votes, turnout). Tapping one opens that state and race,
   and maybe flags a county.
7. **Sources** footer, with the civicAPI credit its terms require.
8. **The view is in the URL** (`?state=TX&race=...&office=H`), so links open
   the same view.
9. **Escape** closes the state.

## Decisions (with a recommendation for each)

### Share the map layout with web first
These functions in the web file are pure math with no DOM:

- `CALLOUTS`, `spreadBubbles`, the Senate column height and fit logic in
  `Bubbles`
- the zoom calculation in `USMap`, `stateFill`, `turnoutColor`

**Move them into `packages/core/src/resultsMap.ts`**, with vitest tests,
before writing any native UI, and switch the web file over to use them. Then
both platforms place markers the same way, and the web page is a check that
nothing moved. This is step 1, and it's a no-visible-change PR.

The marker layout is subtle, so carry it over exactly:

- Markers are spread by where the **faces** sit (base minus column height),
  then the columns are put back under them.
- The Northeast callout stack (VT, NH, MA, RI, CT, NJ, DE, MD out in the
  Atlantic) spaces by face plus column height, and callout columns are
  capped at 0.45 × the face size.
- A column near the top edge (Montana) is shortened so its face stays on
  the map, both before and after spreading.

### Map data
`states-albers-10m.json` is 82 KB and `counties-albers-10m.json` is 795 KB
(both in `apps/app/public/geo/`).

**Bundle the states file** (import the JSON) so the map draws with no extra
request. **Fetch the counties file** from
`https://politmus.com/geo/counties-albers-10m.json` the first time someone
opens a state (`staleTime: Infinity`, same as web). Results need the network
anyway, and this keeps 800 KB out of the app download.

Alternative: bundle both. That's simpler, and fine if the app's size
doesn't matter.

Compute the path strings once with `geoPath()` and `useMemo`; they're in the
975 × 610 frame, so the SVG uses `viewBox="0 0 975 610"`.

### Drawing the map and markers
- **States and counties:** `react-native-svg` `<Path>`s. Only the selected
  state's counties are drawn, as on web (Texas, the most, has 254).
- **Zoom:** animate a `<G>` transform with Reanimated
  (`Animated.createAnimatedComponent(G)`, `useAnimatedProps`), using the same
  bounds math as web: k up to 9 and 0.86 of the frame.
- **Columns:** draw them as SVG polygons (front, side and top faces) in an
  overlay `Svg` sized in pixels. That's exact and simpler than skewed
  `View`s. Animate the height with Reanimated, and use `useReducedMotion()`
  to skip the rise.
- **Faces:** `expo-image` in absolutely positioned `View`s above the
  columns, for caching and the initials fallback (reuse the
  `OfficialPhoto` pattern). Draw the share ring with `react-native-svg`.
- **Layering:** web orders each whole tower (column plus face) by y. On
  native, put **all columns in one layer below all faces**, so a column
  never covers a face. This is simpler and reads better at phone size. Check
  it on a screenshot.

### Phone layout
The web page puts the map and panel side by side from 1024px. On a phone,
stack them in one column:

- Hero: compact, the two score cards in a row
- chamber switch
- map: full width, aspect 975 : 610
- legend
- the panel content (Overview or StatePanel)
- Highlights: a horizontal `ScrollView`
- Sources

Tablets can use the side-by-side layout behind the existing `md:`
breakpoint.

**Marker size is the open question.** A phone map is about 360pt wide, and
web's smallest face is 32px, which crowds 35 Senate races. Try 26 to 28pt
faces with the pills kept. If it's still crowded, show the margin pill only
on the tapped state. Decide from simulator screenshots on the smallest phone
(iPhone 17e) and a large one. Pinch-to-zoom on the national map is a
possible later step; leave it out of the first version.

**Decided in step 3 (iPhone 17e, 18 Pro Max, Android screenshots):** 28pt
faces under 520pt of map width, with the margin pills kept, drawn in their
own layer above every face so a neighbor never hides one. House pills drop
the spaces ("D8 · R2") and stay inside the map by their own width. On a
phone the Atlantic callout stack can't fit in one column, so the shared
layout squeezes it and zigzags the faces. Every face stays inside the map:
Maine and Montana sit a little lower, on web too.

### Touch instead of hover
Web shows `StateTip`, `RaceTip` and `CountyTip` on hover. A phone has no
hover:

- Tapping a state or marker selects the state (zoom plus panel), same as a
  web click. The panel already shows what the state and race tips show.
- Tapping a county shows a small info card pinned under the map (the
  `CountyTip` content) until another tap or Back. No floating tooltip.
- Keep hit targets at 44pt or more. The callouts make the small
  Northeastern states tappable.

### View state, links and Back
- Replace `readViewParams` and `writeViewParams` (`window.location`) with
  Expo Router: `useLocalSearchParams()` to read and `router.setParams()` to
  write `state`, `race` and `office`. `politmus://results?state=TX` then
  opens Texas. (Universal links from politmus.com aren't set up; that's
  part of the release work in `deploy.md`.)
- **Android Back and the iOS back swipe:** with a state open, Back closes
  the state first, the way Escape does on web. Use `usePreventRemove`
  (React Navigation) or `BackHandler`. Check the Expo SDK 58 docs for the
  right API.

### Refreshing
Use the same query as web: `snapshotRequestUrl(SNAPSHOT_URL)`,
`refetchInterval: 60_000`, and `EXPO_PUBLIC_RESULTS_URL` for a local
snapshot. On native, connect React Query's `focusManager` to `AppState`, so
it stops polling in the background and refreshes when the app comes back.
GitHub's raw CDN caches for about five minutes, so polling faster gains
nothing.

## Lessons from building the web map
- **Hidden markers must stop taking touches.** On web, faded markers kept
  catching the pointer over a zoomed state's counties (#88). On native,
  set `pointerEvents="none"` on the marker layer while a state is open, not
  just opacity 0.
- **Keep the info layer above the markers.** Per-marker z-ordering once
  covered the tooltip (#87). Put the county info card outside the map's
  layers.
- **The data, not the code, decides some faces.** Hyphenated surnames
  ("El-Sayed") once failed to match profiles; that's fixed in
  `backend/election_results.py` (#86). Montana's Senate candidates have no
  Politmus photos, so initials there are expected.
- **No em-dashes in app sentences** (house style); a dash for an empty value
  is fine.

## Steps (one PR each)
1. **Shared layout:** move the map math to `packages/core/src/resultsMap.ts`
   with tests, and point the web file at it. Check `/results` on web is
   unchanged.
2. **Native skeleton:** `ElectionResults.tsx` with the snapshot query, the
   loading and error states, Hero, the chamber switch, and Overview as a
   list, but no map. Already useful on its own.
3. **National map:** state fills, legend, House pills, Senate faces and
   columns with the rise. Screenshots on a small and a large iPhone, and on
   Android.
4. **Drill-down:** tap to select, animated zoom, counties (fetched), lead
   and turnout coloring, the county info card, Back closes the state, view
   in the route params.
5. **StatePanel:** race chips, candidate cards with profile links
   (`router.push('/member/[id]')`), the tug bar, stats, the seat grid, the
   county lists, the civicAPI note.
6. **Highlights and Sources;** remove the old stub text.
7. **Polish:** `focusManager` and `AppState`, reduced motion,
   accessibility labels (copy the web `aria-label`s), tablet layout.

## Checking it
- `npm run lint && npm run typecheck && npm test` at the repo root after
  each step.
- **Simulators:** this Mac has iPhone 18 Pro, iPhone 18 Pro Max and
  iPhone 17e simulators, and an Android emulator in `~/Library/Android/sdk`.
  `npx expo start --ios` / `--android`; Expo Go is enough, since every
  library above ships in it. Screenshots: `xcrun simctl io booted screenshot
  <file>`.
- **Live data:** the snapshot on `election-results-data` keeps updating while
  the Election Results workflow loop runs (see `deploy.md`). For a fixed
  test snapshot, use `EXPO_PUBLIC_RESULTS_URL` as described there.
- **The web page must look the same after step 1.** Compare `/results`
  before and after.

## Out of scope
Store builds and release (EAS, Clerk native setup; see `deploy.md`), push
notifications for results, and pinch-to-zoom on the national map.

## Starting the next session
Open a new session in a fresh worktree from `main` and say:

> Implement docs/results-mobile-plan.md, starting with step 1. One PR per
> step; show me simulator screenshots for the map steps.
