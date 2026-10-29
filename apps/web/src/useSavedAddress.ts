import { useUser } from '@clerk/clerk-react'
import { useCallback } from 'react'

// The signed-in user's lookup address, kept in Clerk unsafeMetadata. Signed-out
// users have none and can't save one.
export function useSavedAddress() {
  const { user, isLoaded } = useUser()
  const raw = user?.unsafeMetadata?.savedAddress
  const savedAddress = typeof raw === 'string' && raw.trim() ? raw.trim() : null

  const saveAddress = useCallback(
    async (address: string) => {
      if (!user) return
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          savedAddress: address,
        },
      })
    },
    [user],
  )

  return { isLoaded, canSave: Boolean(user), savedAddress, saveAddress }
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined) {
  const normalize = (value: string | null | undefined) =>
    (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return normalize(a) === normalize(b)
}
