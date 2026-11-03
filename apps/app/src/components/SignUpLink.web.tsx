import { SignUpButton } from '@clerk/expo/web'

export default function SignUpLink() {
  return (
    <SignUpButton mode="modal">
      <button type="button" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500">
        Create a free account
      </button>
    </SignUpButton>
  )
}
