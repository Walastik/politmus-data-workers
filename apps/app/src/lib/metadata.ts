import type { Metadata } from 'expo-router/server'

// What the website says about itself: the landing page's opening lines, used
// as every page's description unless the page has its own.
export const SITE_DESCRIPTION =
  'Politmus grades politicians on how they actually vote, so you can see if they keep their promises. Find your representatives, follow bills and votes in Congress, and see where and when to vote.'

type Page = { title: string | null; description?: string }

// Each route's page name, keyed by its path pattern. Routes put it in the
// static HTML (generateMetadata, for search engines and Google's OAuth review),
// and the root layout keeps document.title in step as you navigate.
const PAGES = {
  '/': { title: null },
  '/home': { title: null },
  '/landing': { title: null },
  '/dev-explorer': { title: null },
  '/now': { title: 'Happening Now' },
  '/feed': {
    title: 'Feed',
    description: 'The latest bills, votes and changes in Congress and your state legislature, as they happen.',
  },
  '/reps': {
    title: 'My Reps',
    description:
      'Find who represents you in Congress and your state legislature, with their contact details and accountability scores.',
  },
  '/congress': {
    title: 'Congress',
    description: 'Every member of the Senate and House, with their party, state and accountability score.',
  },
  '/bills': {
    title: 'Bills',
    description: 'Bills in Congress with plain-language summaries, their status and how each chamber voted.',
  },
  '/candidates': {
    title: 'Candidates',
    description: 'Candidates running for Congress, race by race, with their campaign finance.',
  },
  '/results': {
    title: 'Election Results',
    description:
      'Unofficial 2026 midterm results straight from state election offices: a live map, county breakdowns, turnout and the races that stand out.',
  },
  '/voting': {
    title: 'Voting Locations',
    description: 'Polling places, early voting sites and ballot drop-off locations for your address.',
  },
  '/privacy': {
    title: 'Privacy Policy',
    description: 'What information Politmus collects, how it is used and shared, and the choices you have.',
  },
  '/terms': { title: 'Terms of Service', description: 'The terms for using the Politmus website and apps.' },
  '/member/[id]': { title: 'Member profile' },
  '/member/[id]/pacs': { title: 'PAC contributions' },
  '/bill/[id]': { title: 'Bill' },
  '/bill/[id]/voters': { title: 'How members voted' },
  '+not-found': { title: 'Page not found' },
} satisfies Record<string, Page>

export type PagePath = keyof typeof PAGES

const fullTitle = (title: string | null) => (title ? `${title} · Politmus` : 'Politmus')

export function pageMetadata(path: PagePath): Metadata {
  const page: Page = PAGES[path]
  return { title: fullTitle(page.title), description: page.description ?? SITE_DESCRIPTION }
}

// The title for a URL path, matching [id] segments.
export function pageTitle(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  const pattern = path.replace(/^\/(member|bill)\/[^/]+/, '/$1/[id]')
  const page: Page | undefined = (PAGES as Record<string, Page>)[pattern]
  return fullTitle(page ? page.title : PAGES['+not-found'].title)
}
