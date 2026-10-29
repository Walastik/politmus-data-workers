# Politmus app (Expo)

iOS, Android and web from one codebase: Expo SDK 58, Expo Router, Uniwind
(Tailwind v4 class names on React Native) and Clerk. Shared logic and the API
client come from `@politmus/core` (`packages/core`).

## Run

```bash
cp .env.example .env.local   # then fill in the Clerk key
npm run ios                  # or: npm run android / npm run web / npm start
```

`npm start` prints a QR code for Expo Go on a phone. After adding a library with
native code, Expo Go is not enough: build a development client with
`npx expo run:ios` or `npx eas-cli@latest build --profile development`.

`EXPO_PUBLIC_*` values are inlined when Metro compiles, so after changing
`.env.local` restart with `npx expo start --clear`.

## Layout

- `src/app/`: routes. `(tabs)/` mirrors the web app's sections (Now, Feed,
  My Reps, Congress, Bills); screens not ported yet link to politmus.com.
- `src/components/`: UI. `Name.web.tsx` beside `Name.tsx` replaces it on web
  only (see `AccountButton`).
- `src/lib/`: the API provider (Clerk token on every request) and TanStack
  Query hooks.

Put anything without React Native or DOM code in `packages/core` so the web app
uses it too.

## Checks

```bash
npm run typecheck && npm run lint
```
