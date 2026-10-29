import { googleCalendarUrl, type CalendarElection } from '@politmus/core/calendar'

import { openUrl } from './links'

// Native has no .ics download; Google Calendar's template link works on every
// phone. The web build downloads an .ics with reminders (calendar.web.ts).
export const CALENDAR_HINT: string | null = null

export function canAddToCalendar(election: CalendarElection, infoUrl: string) {
  return googleCalendarUrl(election, { infoUrl }) !== null
}

export function addToCalendar(election: CalendarElection, infoUrl: string) {
  const url = googleCalendarUrl(election, { infoUrl })
  if (url) openUrl(url)
}
