// The full Politmus "P" as a vector file (public/monogram.svg, written by
// brand/generate.py), so the browser draws its filters sharp at any zoom.
const ASPECT = 660 / 860

export default function Monogram({ size = 24 }: { size?: number }) {
  return <img src="/monogram.svg" alt="Politmus" width={size * ASPECT} height={size} style={{ display: 'block' }} />
}
