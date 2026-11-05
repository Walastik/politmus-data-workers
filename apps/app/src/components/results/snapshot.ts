import { RESULTS_SNAPSHOT_URL, snapshotRequestUrl, type ResultsSnapshot } from '@politmus/core/electionResults'
import { useQuery } from '@tanstack/react-query'

// The results snapshot, shared by the web page and the native screen.

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return (await response.json()) as T
}

// EXPO_PUBLIC_RESULTS_URL=/dev-results.json in .env.local reads a snapshot
// written locally by backend/election_results.py instead. The native app
// needs a full URL on the dev server (http://localhost:8081/dev-results.json
// from the iOS simulator), since it has no page to resolve a path against.
export const SNAPSHOT_URL = process.env.EXPO_PUBLIC_RESULTS_URL || RESULTS_SNAPSHOT_URL

export function useSnapshot() {
  return useQuery({
    queryKey: ['election-results', SNAPSHOT_URL],
    queryFn: () => getJson<ResultsSnapshot>(snapshotRequestUrl(SNAPSHOT_URL)),
    // State sites post new counts every few minutes while counting goes on.
    refetchInterval: 60_000,
  })
}
