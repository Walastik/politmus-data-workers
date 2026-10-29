import { HOME_PATH } from '@politmus/core/site'
import { Redirect, type Href } from 'expo-router'

export default function OldLanding() {
  return <Redirect href={HOME_PATH as Href} />
}
