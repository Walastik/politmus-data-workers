import { Image } from 'react-native'

// The full Politmus "P" (brand/politmus-monogram.svg). react-native-svg can't
// draw its watercolor filters, so native uses PNGs rendered from it at 1x-3x
// of 26pt tall, the largest header size. The website loads the SVG itself:
// Monogram.web.tsx.
const ASPECT = 660 / 860

export default function Monogram({ size = 24 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/monogram.png')}
      style={{ width: size * ASPECT, height: size }}
      accessibilityLabel="Politmus"
      accessibilityRole="image"
    />
  )
}
