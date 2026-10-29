import type { ReactNode } from 'react'

// Signed-in state the Clerk mocks in each test file read. Tests set it before rendering.
export const clerkState = { signedIn: true, savedAddress: null as string | null }

export function resetClerkState() {
  clerkState.signedIn = true
  clerkState.savedAddress = null
}

// The parts of @clerk/clerk-react the app uses, driven by clerkState. Use as
// vi.mock('@clerk/clerk-react', async () => (await import('./clerkMock')).clerkMock()).
export function clerkMock() {
  const UserButton = () => null
  UserButton.UserProfilePage = () => null
  return {
    SignedIn: ({ children }: { children: ReactNode }) => (clerkState.signedIn ? <>{children}</> : null),
    SignedOut: ({ children }: { children: ReactNode }) => (clerkState.signedIn ? null : <>{children}</>),
    SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
    SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
    UserButton,
    useAuth: () => ({ isSignedIn: clerkState.signedIn }),
    useUser: () => ({
      user:
        clerkState.signedIn
          ? {
              unsafeMetadata: clerkState.savedAddress ? { savedAddress: clerkState.savedAddress } : {},
              update: async ({ unsafeMetadata }: { unsafeMetadata: { savedAddress?: string } }) => {
                clerkState.savedAddress = unsafeMetadata.savedAddress ?? null
              },
            }
          : null,
      isLoaded: true,
    }),
  }
}
