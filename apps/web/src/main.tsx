import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { HOME_PATH } from './homePath'
import { clerkLocalization } from './clerkLocalization'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Publishable Key')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY} 
      afterSignOutUrl={HOME_PATH}
      signInFallbackRedirectUrl="/now"
      signUpFallbackRedirectUrl="/now"
      localization={clerkLocalization}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
