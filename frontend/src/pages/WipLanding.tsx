import { SignInButton, UserButton, SignedIn, SignedOut } from '@clerk/clerk-react'
import AsciiAnimation from './AsciiAnimation'

export default function WipLanding() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-8 py-16 text-center text-slate-100">
      <AsciiAnimation />
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Politmus
      </h1>
      <p className="text-xl text-slate-400">Work in Progress</p>
      
      <div className="mt-8">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-md bg-blue-600 px-6 py-2.5 font-semibold text-white transition-colors hover:bg-blue-500">
              Sign In
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </div>
  )
}
