import { SignInButton } from '@clerk/expo/web'

export default function SignInLink({ label }: { label: string }) {
  return (
    <SignInButton mode="modal">
      <button type="button" className="text-xs font-sans-semibold text-slate-400 hover:text-blue-300">
        {label}
      </button>
    </SignInButton>
  )
}
