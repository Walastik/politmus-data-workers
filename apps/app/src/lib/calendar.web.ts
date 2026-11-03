import { buildElectionIcs, type CalendarElection } from '@politmus/core/calendar'

// Same as the Vite site: an .ics file with reminders the day before and the morning of.
export const CALENDAR_HINT: string | null = 'Adds reminders at 9 am the day before and 8 am on Election Day.'

export function canAddToCalendar(election: CalendarElection, infoUrl: string) {
  return buildElectionIcs(election, { infoUrl }) !== null
}

export function addToCalendar(election: CalendarElection, infoUrl: string) {
  const ics = buildElectionIcs(election, { infoUrl })
  if (!ics) return
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `election-${election.date}.ics`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
