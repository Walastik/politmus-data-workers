import { HOME_PATH } from '@politmus/core/site'
import { Redirect, type Href } from 'expo-router'

// Unknown paths go home, as on the Vite site.
export default function NotFound() {
  return <Redirect href={HOME_PATH as Href} />
}
