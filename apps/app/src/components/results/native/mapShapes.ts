import { STATE_FIPS } from '@politmus/core/electionResults'
import type { MapBounds, MapPoint } from '@politmus/core/resultsMap'
import { geoPath } from 'd3-geo'
import type { Feature, Geometry } from 'geojson'
import { feature, mesh } from 'topojson-client'
import statesTopo from 'us-atlas/states-albers-10m.json'

// The state shapes, bundled (82 KB) so the map draws without a request.
// They're already projected (Albers USA) into the 975 × 610 frame, so a
// geoPath with no projection turns them straight into SVG path strings.

export type MapFeature = Feature<Geometry, { name: string }> & { id: string }

export interface StateShape {
  postal: string
  name: string
  d: string
  centroid: MapPoint
  bounds: MapBounds
  feature: MapFeature
}

export const path = geoPath()

let cached: { states: StateShape[]; byPostal: Map<string, StateShape>; nation: string } | null = null

// Computed once, the first time the map draws.
export function stateShapes() {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = statesTopo as any
  const features = (feature(topo, topo.objects.states) as unknown as { features: MapFeature[] }).features
  const states = features
    .filter((f) => STATE_FIPS[f.id])
    .map((f) => ({
      postal: STATE_FIPS[f.id],
      name: f.properties.name,
      d: path(f) ?? '',
      centroid: path.centroid(f) as MapPoint,
      bounds: path.bounds(f) as MapBounds,
      feature: f,
    }))
  cached = {
    states,
    byPostal: new Map(states.map((s) => [s.postal, s])),
    nation: path(mesh(topo, topo.objects.nation)) ?? '',
  }
  return cached
}
