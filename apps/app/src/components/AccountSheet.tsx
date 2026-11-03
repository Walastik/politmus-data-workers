import { useAuth, useUser } from '@clerk/expo'
import { useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

import { LEGAL_CONTACT_EMAIL } from './Legal'
import { SafeAreaView } from './ui'

// The signed-in account on native: who you are, sign out, and delete the
// account (Apple requires deletion in the app). Web uses Clerk's own profile.
export default function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signOut } = useAuth()
  const { user } = useUser()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setError(null)
    onClose()
  }

  const deleteAccount = async () => {
    if (!user) return
    setDeleting(true)
    setError(null)
    try {
      await user.delete()
      close()
    } catch (err) {
      setError(clerkErrorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your Politmus account and your saved address. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    )

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView className="flex-1 bg-slate-900" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between border-b border-slate-800 px-5 py-3">
          <Text className="text-base font-semibold text-slate-100">Account</Text>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={8}>
            <Text className="text-base font-semibold text-blue-400">Done</Text>
          </Pressable>
        </View>

        <View className="gap-8 px-5 py-6">
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-slate-400">Signed in as</Text>
            <Text className="text-base text-slate-100">{user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? 'Your account'}</Text>
          </View>

          <Pressable
            onPress={() => {
              close()
              void signOut()
            }}
            accessibilityRole="button"
            className="items-center rounded-lg border border-slate-700 bg-slate-800 py-3 active:bg-slate-700"
          >
            <Text className="text-base font-semibold text-slate-100">Sign out</Text>
          </Pressable>

          <View className="gap-3 border-t border-slate-800 pt-6">
            <Text className="text-base font-semibold text-slate-100">Delete account</Text>
            <Text className="text-sm leading-relaxed text-slate-400">
              Deleting your account removes your sign-in and your saved address. You can keep using Politmus without an
              account.
            </Text>
            {user?.deleteSelfEnabled === false ? (
              <Text className="text-sm leading-relaxed text-slate-400">
                To delete your account, email us at{' '}
                <Text onPress={() => openUrl(`mailto:${LEGAL_CONTACT_EMAIL}`)} accessibilityRole="link" className="text-blue-400">
                  {LEGAL_CONTACT_EMAIL}
                </Text>
                .
              </Text>
            ) : (
              <Pressable
                onPress={confirmDelete}
                disabled={deleting}
                accessibilityRole="button"
                className="flex-row items-center justify-center gap-2 rounded-lg border border-rose-800 bg-rose-950/60 py-3 active:bg-rose-900/60"
              >
                {deleting ? <ActivityIndicator colorClassName="accent-rose-300" /> : null}
                <Text className="text-base font-semibold text-rose-300">{deleting ? 'Deleting…' : 'Delete account'}</Text>
              </Pressable>
            )}
            {error ? <Text className="text-sm text-rose-300">{error}</Text> : null}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// Clerk API errors carry a readable message in errors[0].
function clerkErrorMessage(err: unknown) {
  const first = (err as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]
  return first?.longMessage ?? first?.message ?? (err instanceof Error ? err.message : 'Could not delete the account. Try again.')
}
