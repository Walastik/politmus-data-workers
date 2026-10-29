import { Redirect } from 'expo-router'

// Happening Now is the home screen, as on the web app.
export default function Index() {
  return <Redirect href="/now" />
}
