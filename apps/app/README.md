# Politmus app (Expo)

One codebase for the iOS app, the Android app and the website (politmus.com):
Expo SDK 58, Expo Router, Uniwind (Tailwind v4 class names on React Native),
TanStack Query and Clerk. Logic that isn't UI lives in `@politmus/core`
(`packages/core`) and is unit tested there.

How it ships: [docs/deploy.md](../../docs/deploy.md).

## Architecture

```
packages/core        platform-free TypeScript (+ React): API types and client,
                     the shared location provider, and each page's display rules
apps/app             this app: routes, React Native UI, platform glue
  ├─ iOS / Android   Expo (Expo Go for most work; EAS for store builds)
  └─ web             static export served by nginx on Fly (politmus.com)
apps/web             the previous Vite site, kept only as a rollback
backend/             FastAPI on Fly, reached only through the site's /api proxy
```

- **API.** `lib/api.tsx` builds the core client (`createApiClient`) with Clerk's
  token on every request. `EXPO_PUBLIC_API_URL` is the origin: empty on the
  website (same-origin `/api`, proxied by nginx) and `https://politmus.com` in
  the apps. The API has no public address of its own.
- **Platform differences.** `Name.web.tsx` beside `Name.tsx` replaces it on web
  only (`AccountButton`, `LaunchScreen`, `LocationSettings`, `SignInLink`, `SignUpLink`,
  `Monogram`, `lib/calendar`, `lib/locationPlatform`). Route files can't be
  split that way reliably, so routes branch on `Platform.OS` instead.
- **Location.** The shared provider in core takes a platform object:
  SecureStore on native and `localStorage` on web, with expo-location for the
  device position on both. The signed-in saved address lives in Clerk
  (`unsafeMetadata.savedAddress`).
- **Accounts.** Web uses Clerk's own components (modal sign-in, `UserButton`
  with a Location Settings page). Native signs in through Clerk's hosted page,
  and signed-in users get `AccountSheet`: Sign out and Delete account, which
  Apple requires in-app.
- **Styling.** Uniwind only styles React Native's own components; wrap others
  with `withUniwind` (see `OfficialPhoto`, and `SafeAreaView` in `ui.tsx`).
  Tailwind only generates classes it finds written out in source, so don't
  build class names from pieces.

## Layout

- `src/app/`: routes.
  - `(tabs)/`: Now, Feed, My Reps, Congress and Bills, plus the hidden `home`
    tab (the website's landing page while signed out).
  - `member/[id]` and `bill/[id]` are the profiles, pushed on the stack from any
    screen; `member/[id]/pacs` is the PAC explorer and `bill/[id]/voters` the
    per-party vote list.
  - `candidates`, `voting` (every voting site and election office for the
    address), `privacy` and `terms`.
  - `index` is the Work in Progress page on web (Happening Now in the app),
    `+html.tsx` the website's page shell, `+not-found` sends unknown paths home.
- `src/components/`: UI; `profile/` holds the profile sections.
- `src/lib/`: API provider, TanStack Query hooks (`queries.ts`), the device side
  of the location provider, desktop layout helpers (`layout.ts`) and page
  titles (`metadata.ts`).

Put anything without React Native or DOM code in `packages/core`.

## Run

```bash
cp .env.example .env.local   # Clerk pk_test key; API URL (see the comments)
npm run ios                  # or: npm run android / npm run web / npm start
```

`npm start` prints a QR code for Expo Go on a phone. Expo Go only has its own
native modules: after adding a library with native code, build a development
client (`npx expo run:ios`, or `npx eas-cli@latest build --profile
development`). Expo Go also shows its own icon and splash, not ours.

`EXPO_PUBLIC_*` values are inlined when Metro compiles, so after changing
`.env.local` restart with `npx expo start --clear`. Typed routes
(`.expo/types/router.d.ts`) regenerate while Metro runs; start it once after
adding a route if `tsc` doesn't know the new path.

## Checks

```bash
npm run typecheck && npm run lint
```

From the repo root, `npm run lint && npm run typecheck && npm test && npm run
build` covers this app, `packages/core` and the legacy Vite site.

## Website

politmus.com is this app's static web export (`web.output: "static"`): every
route is prerendered to HTML, so pages have their content before JavaScript
runs, which search engines and Google's OAuth review rely on.

- `app/+html.tsx` is the page shell. SDK 58 requires it to render `headNodes`
  and `bodyNodes`.
- Each route exports `generateMetadata()` from `lib/metadata.ts` for its
  `<title>` and description; the root layout keeps `document.title` in step on
  client-side navigation. Add new routes to `PAGES` there.
- Wide windows (web, 768px and up) get the header nav (`DesktopNav`), a centered
  column and multi-column card grids (`lib/layout.ts`). Phones and the native
  app keep one column; don't use `md:` for this, since it also matches iPads.
- `public/` is copied as-is: favicon, apple-touch-icon, `monogram.svg`,
  `robots.txt`.
- `nginx.conf` maps `/member/<id>`, `/bill/<id>` and their subpages to the
  export's `[id]` pages, serves unknown paths the not-found page, and proxies
  `/api/` to the API.

To try the production build locally, export with an empty API URL (so `/api`
stays same-origin) and serve `dist/` behind something that proxies `/api`:

```bash
EXPO_PUBLIC_API_URL= npx expo export --platform web --output-dir dist --clear
```

## Brand assets

`brand/generate.py` (repo root) writes the SVG sources, `public/favicon.svg`
and `public/monogram.svg`. The PNGs in `assets/images/` (app icon, Android
adaptive layers, splash, favicon, header `monogram@1x-3x`) are rendered from
those SVGs; re-render them when the mark changes. The SVGs use filters that
need a full renderer such as resvg (`@resvg/resvg-js`) or a browser.
