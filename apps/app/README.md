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
  My Reps, Congress, Bills). `member/[id]` and `bill/[id]` are the
  profiles (the web app's drawers), pushed on the stack from any screen;
  `bill/[id]/voters` is the per-party vote list, `member/[id]/pacs` the PAC
  explorer, `candidates` every race this
  cycle, and `voting` every voting site and election office for the address.
- `src/components/`: UI. `Name.web.tsx` beside `Name.tsx` replaces it on web
  only (see `AccountButton`). `profile/` holds the profile sections.
- `src/lib/`: the API provider (Clerk token on every request), TanStack Query
  hooks, and the device side of the shared location provider
  (`locationPlatform.ts`: SecureStore and expo-location).

Put anything without React Native or DOM code in `packages/core` so the web app
uses it too.

## Checks

```bash
npm run typecheck && npm run lint
```
