// Site-wide routing and sign-in copy, shared by the web builds.

// Where the site's home (the landing page, or Happening Now once signed in) lives.
// While this isn't '/', the root keeps showing the Work in Progress page.
// To launch, set this to '/' and delete the WIP landing pages.
export const HOME_PATH: string = '/home'

const LEGACY_TABS: Record<string, string> = {
  now: '/now',
  lookup: '/reps',
  roster: '/congress?view=list',
  candidates: '/candidates',
  bills: '/bills',
}

// Old /dev-explorer?tab=… links, keeping any open drawer (?official=, ?bill=).
export function legacyExplorerPath(search: string) {
  const params = new URLSearchParams(search)
  const [path, query] = (LEGACY_TABS[params.get('tab') ?? ''] ?? '/now').split('?')
  const next = new URLSearchParams(query)
  for (const key of ['official', 'bill']) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  const nextSearch = next.toString()
  return `${path}${nextSearch ? `?${nextSearch}` : ''}`
}

// Must match the password minimum length set in the Clerk dashboard.
// Clerk's stock "too short" error hardcodes "8 characters" no matter what
// the dashboard says, which is why we override it.
const PASSWORD_MIN_LENGTH = 12

const NOT_STRONG_ENOUGH =
  'Your password is too easy to guess. Try making it longer, or adding numbers and symbols (like ! or #).'

// Overrides for Clerk's sign-up and sign-in copy where the defaults are wrong
// or too vague to act on (issue #77). Typed loosely: each app passes it to its
// own Clerk SDK's `localization` prop.
export const CLERK_LOCALIZATION = {
  unstable__errors: {
    form_password_length_too_short: `Your password is too short. It must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    form_password_not_strong_enough: NOT_STRONG_ENOUGH,
    form_password_pwned:
      "This password showed up in a public list of leaked passwords (from some other site, not necessarily one you use), so it can't be used here. Please pick a different one.",
    zxcvbn: {
      notEnough: NOT_STRONG_ENOUGH,
    },
  },
}
