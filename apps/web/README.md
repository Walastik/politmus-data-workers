# Politmus Vite site (legacy)

The previous politmus.com: React 19, Vite, Tailwind v4 and Clerk. The website
now ships from the Expo app (`apps/app`), and new work goes there. This site is
kept only as a rollback, and its tests still exercise `packages/core`.

```bash
npm run dev:vite     # repo root; proxies /api to localhost:8000
npm run build:vite
```

Rollback deploy, from the repo root: see [docs/deploy.md](../../docs/deploy.md).
