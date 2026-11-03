import type { ComponentProps } from 'react'
import type { ClerkProvider } from '@clerk/clerk-react'
import { CLERK_LOCALIZATION } from '@politmus/core/site'

export const clerkLocalization: ComponentProps<typeof ClerkProvider>['localization'] = CLERK_LOCALIZATION
