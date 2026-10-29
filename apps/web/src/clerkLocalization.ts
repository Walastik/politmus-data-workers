import type { ComponentProps } from 'react'
import type { ClerkProvider } from '@clerk/clerk-react'

// Must match the password minimum length set in the Clerk dashboard.
// Clerk's stock "too short" error hardcodes "8 characters" no matter what
// the dashboard says, which is why we override it.
const PASSWORD_MIN_LENGTH = 12

const NOT_STRONG_ENOUGH =
  'Your password is too easy to guess. Try making it longer, or adding numbers and symbols (like ! or #).'

// Overrides for Clerk's sign-up and sign-in copy where the defaults are wrong
// or too vague to act on (issue #77).
export const clerkLocalization: ComponentProps<typeof ClerkProvider>['localization'] = {
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
