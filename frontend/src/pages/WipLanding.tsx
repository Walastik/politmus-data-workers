import { SignInButton, UserButton, SignedIn, SignedOut } from '@clerk/clerk-react'
import { MapPin } from 'lucide-react'
import LocationSettings from '../components/LocationSettings'
import AsciiAnimation from './AsciiAnimation'
import { LegalLinks } from './Legal'

export default function WipLanding() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-8 py-16 text-center text-slate-100">
      <AsciiAnimation />
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Politmus
      </h1>
      <p className="text-xl text-slate-400">Work in Progress</p>
      
      <div className="absolute right-4 top-4">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-md bg-blue-600 px-6 py-2.5 font-semibold text-white transition-colors hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity duration-300">
              Sign In
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton>
            <UserButton.UserProfilePage 
              label="Location Settings" 
              url="location" 
              labelIcon={<MapPin className="h-4 w-4" />}
            >
              <LocationSettings />
            </UserButton.UserProfilePage>
          </UserButton>
        </SignedIn>
      </div>

      <LegalLinks className="absolute inset-x-0 bottom-4" />
    </div>
  )
}
