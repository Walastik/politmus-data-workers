import LookupResults from '../LookupResults'
import LocationBar from '../components/LocationBar'
import PageHeader, { PageContainer } from '../components/PageHeader'
import { useCivicLocation } from '../useCivicLocation'
import { useDrawerLinks } from '../useDrawerLinks'

export default function Reps() {
  const { openOfficial } = useDrawerLinks()
  const { ready, place, lookup } = useCivicLocation()

  return (
    <PageContainer>
      <PageHeader
        title="Who represents me"
        description="Your members of Congress and state officials, how they score, and how to reach them."
      />
      {!ready ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-8">
          <LocationBar
            prompt="Enter your address, or use your location, to see who represents you."
            submitLabel="Find my representatives"
          />
          <div aria-live="polite">
            {!place ? null : lookup.status === 'loading' || lookup.status === 'idle' ? (
              <p className="text-slate-400">Looking up your representatives…</p>
            ) : lookup.status === 'error' ? (
              <p className="text-red-400">{lookup.message}</p>
            ) : (
              <LookupResults lookup={lookup.data} onSelectOfficial={openOfficial} />
            )}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
