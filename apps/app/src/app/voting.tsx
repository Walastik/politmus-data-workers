import { formatElectionDate } from '@politmus/core/calendar'
import { errorMessage } from '@politmus/core/happeningNow'
import { splitPollingHours } from '@politmus/core/pollingHours'
import { formatCivicAddress, getVoterResources, type AdminBody, type VoterInfo, type VoterLocation } from '@politmus/core/types'
import {
  INITIAL_LOCATIONS_SHOWN,
  UNAVAILABLE_MESSAGE,
  earlyVotingDates,
  electionOffices,
  locationGroups,
  registrationLinks,
  showStaticFallback,
  staticFallback,
  votingNotice,
  type LocationGroup,
  type NoticeIcon,
  type NoticeTone,
  type VotingNotice,
} from '@politmus/core/votingInfo'
import { directionsUrl, locationAddress } from '@politmus/core/votingSites'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { Icons } from '@/components/icons'
import { addToCalendar, CALENDAR_HINT, canAddToCalendar } from '@/lib/calendar'
import { useCivicLocation } from '@/lib/civicLocation'
import { openUrl } from '@/lib/links'
import { pageMetadata } from '@/lib/metadata'
import { useVoterInfo } from '@/lib/queries'

export function generateMetadata() {
  return pageMetadata('/voting')
}

// Every voting site for the visitor's address, their election office and the
// official fallbacks; native counterpart of the web VotingLocations.
export default function VotingScreen() {
  const { address, lookup } = useCivicLocation()
  const lookupData = lookup.status === 'ok' ? lookup.data : null
  const stateCode = lookupData?.normalized_input?.state ?? null
  const query = useVoterInfo(address, stateCode, Boolean(lookupData))
  const voterInfo = query.data ?? null

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Voting locations', headerBackTitle: 'Back' }} />
      <ScrollView className="flex-1 bg-slate-900" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="w-full md:max-w-[960px] md:self-center gap-6 px-4 py-5">
        {!address ? (
          <Text className="font-sans text-sm text-slate-400">Enter your street address on Happening Now to see your voting locations.</Text>
        ) : query.isPending ? (
          <Text className="font-sans text-sm text-slate-400">Loading voting and polling location information…</Text>
        ) : query.isError || !voterInfo || voterInfo.uiState === 'unavailable' ? (
          <>
            <NoticeBox
              notice={{
                tone: 'warning',
                icon: 'alert',
                title: 'Live voting location lookup is currently unavailable',
                body: (query.isError ? errorMessage(query.error, '') : voterInfo?.detail) || UNAVAILABLE_MESSAGE,
              }}
            />
            <StaticFallback stateCode={stateCode} />
          </>
        ) : (
          <VotingInfoView voterInfo={voterInfo} stateCode={stateCode} />
        )}
      </ScrollView>
    </>
  )
}

function VotingInfoView({ voterInfo, stateCode }: { voterInfo: VoterInfo; stateCode: string | null }) {
  const notice = votingNotice(voterInfo, stateCode)
  const offices = electionOffices(voterInfo.adminBodies)
  return (
    <>
      {voterInfo.election ? <ElectionCard voterInfo={voterInfo} stateCode={stateCode} /> : null}
      <RegistrationLinks voterInfo={voterInfo} />
      {notice ? <NoticeBox notice={notice} /> : null}
      {locationGroups(voterInfo).map((group) => (
        <LocationSection key={group.title} group={group} electionDate={voterInfo.election?.date} />
      ))}
      {showStaticFallback(voterInfo) ? <StaticFallback stateCode={stateCode} /> : null}
      {offices.length > 0 ? (
        <View>
          <Text className="mb-3 text-sm font-sans-semibold uppercase tracking-wider text-slate-400">Election Administration</Text>
          <View className="gap-4">
            {offices.map(({ body, role }) => (
              <OfficeCard key={role} body={body} role={role} />
            ))}
          </View>
        </View>
      ) : null}
      {voterInfo.uiState !== 'address_problem' ? (
        <View className="border-t border-slate-800 pt-4">
          <Text className="font-sans text-center text-xs text-slate-500">Polling places can change. Confirm with your local election office before you go.</Text>
          <Text className="font-sans mt-1 text-center text-xs text-slate-500">Voting information powered by the Civic Information API.</Text>
        </View>
      ) : null}
    </>
  )
}

function ElectionCard({ voterInfo, stateCode }: { voterInfo: VoterInfo; stateCode: string | null }) {
  const election = voterInfo.election!
  const resources = getVoterResources(stateCode)
  const infoUrl = resources.pollingPlaceUrl ?? resources.voteGovUrl
  const calendarElection = election.date ? { ...election, date: election.date } : null
  const canAdd = calendarElection ? canAddToCalendar(calendarElection, infoUrl) : false
  const dates = earlyVotingDates(voterInfo, stateCode)
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800/80 p-4">
      <Text className="text-xs font-sans-semibold uppercase tracking-wider text-blue-400">Election</Text>
      <Text className="text-lg font-display text-slate-100">{election.name}</Text>
      {election.date ? (
        <Pressable
          disabled={!canAdd}
          onPress={() => calendarElection && addToCalendar(calendarElection, infoUrl)}
          accessibilityRole="button"
          accessibilityLabel={`${formatElectionDate(election.date)}: add to calendar`}
          className="mt-2 flex-row items-center gap-1.5 self-start rounded border border-slate-600 px-2.5 py-1"
        >
          <Icons.CalendarPlus size={16} colorClassName="accent-blue-400" />
          <Text className="font-sans text-sm text-slate-200">{formatElectionDate(election.date)}</Text>
        </Pressable>
      ) : null}
      {election.date && CALENDAR_HINT ? <Text className="font-sans mt-1 text-xs text-slate-500">{CALENDAR_HINT}</Text> : null}
      {dates ? (
        <View className="mt-4 border-t border-slate-700 pt-4">
          <View className="flex-row flex-wrap items-start justify-between gap-2">
            <View>
              <Text className="text-xs font-sans-semibold uppercase tracking-wider text-blue-400">Early Voting in {dates.stateName}</Text>
              <Text className="mt-1 text-lg font-display text-slate-100">{dates.range}</Text>
            </View>
            <Text className={`rounded px-2 py-0.5 text-xs font-sans-semibold ${dates.open ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
              {dates.status}
            </Text>
          </View>
          {dates.note ? <Text className="font-sans mt-2 text-sm text-slate-300">{dates.note}</Text> : null}
          <Text className="font-sans mt-2 text-xs text-slate-500">
            Statewide dates. Your county sets the sites and daily hours. Source:{' '}
            <Text onPress={() => openUrl(dates.sourceUrl)} className="text-slate-400 underline">
              {dates.sourceName}
            </Text>
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const LINK_STYLES = {
  primary: { box: 'bg-blue-600', text: 'text-white', accent: 'accent-white' },
  accent: { box: 'border border-blue-700 bg-slate-800', text: 'text-blue-300', accent: 'accent-blue-300' },
  plain: { box: 'border border-slate-700 bg-slate-800', text: 'text-slate-300', accent: 'accent-slate-300' },
}

function LinkButton({ label, url, style }: { label: string; url: string; style: keyof typeof LINK_STYLES }) {
  const tone = LINK_STYLES[style]
  return (
    <Pressable onPress={() => openUrl(url)} accessibilityRole="link" className={`flex-row items-center gap-1.5 rounded px-3 py-2 ${tone.box}`}>
      <Text className={`text-xs font-sans-semibold ${tone.text}`}>{label}</Text>
      <Icons.ExternalLink size={14} colorClassName={tone.accent} />
    </Pressable>
  )
}

function RegistrationLinks({ voterInfo }: { voterInfo: VoterInfo }) {
  const links = registrationLinks(voterInfo.adminBodies)
  if (links.length === 0) return null
  return (
    <View className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
      <Text className="text-xs font-sans-semibold uppercase tracking-wider text-blue-400">Official Voter Registration & Information</Text>
      <View className="mt-3 flex-row flex-wrap gap-2.5">
        {links.map((link) => (
          <LinkButton key={link.label} {...link} />
        ))}
      </View>
    </View>
  )
}

const NOTICE_TONES: Record<NoticeTone, { box: string; title: string; body: string }> = {
  info: { box: 'border-blue-800/60 bg-blue-950/30', title: 'text-blue-200', body: 'text-blue-300/90' },
  warning: { box: 'border-amber-800/60 bg-amber-950/30', title: 'text-amber-200', body: 'text-amber-300/90' },
  error: { box: 'border-red-900/60 bg-red-950/30', title: 'text-red-200', body: 'text-red-300/90' },
  neutral: { box: 'border-slate-700 bg-slate-800/80', title: 'text-slate-200', body: 'text-slate-400' },
  done: { box: 'border-slate-700 bg-slate-800/80', title: 'text-slate-200', body: 'text-slate-400' },
}

const NOTICE_ICONS: Record<NoticeIcon, { Icon: (typeof Icons)[keyof typeof Icons]; accent: string }> = {
  mail: { Icon: Icons.Mail, accent: 'accent-blue-400' },
  clock: { Icon: Icons.Clock, accent: 'accent-amber-400' },
  help: { Icon: Icons.HelpCircle, accent: 'accent-blue-400' },
  alert: { Icon: Icons.AlertCircle, accent: 'accent-amber-400' },
  check: { Icon: Icons.FileCheck2, accent: 'accent-emerald-400' },
  calendar: { Icon: Icons.Calendar, accent: 'accent-slate-400' },
}

function NoticeBox({ notice }: { notice: VotingNotice }) {
  const tone = NOTICE_TONES[notice.tone]
  const { Icon, accent } = NOTICE_ICONS[notice.icon]
  return (
    <View className={`flex-row items-start gap-3 rounded-lg border p-4 ${tone.box}`}>
      <Icon size={20} colorClassName={notice.tone === 'error' ? 'accent-red-400' : accent} />
      <View className="flex-1">
        <Text className={`font-sans-semibold ${tone.title}`}>{notice.title}</Text>
        <Text className={`font-sans mt-1 text-sm ${tone.body}`}>{notice.body}</Text>
        {notice.action ? (
          <View className="mt-3 self-start">
            <LinkButton label={notice.action.label} url={notice.action.url} style="primary" />
          </View>
        ) : null}
      </View>
    </View>
  )
}

function LocationSection({ group, electionDate }: { group: LocationGroup; electionDate?: string | null }) {
  const [showAll, setShowAll] = useState(false)
  const { locations } = group
  const visible = showAll ? locations : locations.slice(0, INITIAL_LOCATIONS_SHOWN)
  const many = locations.length > INITIAL_LOCATIONS_SHOWN
  return (
    <View>
      <Text className="mb-3 text-sm font-sans-semibold uppercase tracking-wider text-slate-400">
        {group.title}
        {many ? <Text className="font-sans normal-case tracking-normal text-slate-500"> ({locations.length})</Text> : null}
      </Text>
      <View className="gap-4">
        {visible.map((location, index) => (
          <LocationCard key={index} location={location} typeLabel={group.typeLabel} electionDate={electionDate} />
        ))}
      </View>
      {many ? (
        <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button" accessibilityState={{ expanded: showAll }} className="mt-3">
          <Text className="text-sm font-sans-semibold text-blue-400">
            {showAll ? 'Show fewer' : `Show all ${locations.length} (${locations.length - visible.length} more)`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function LocationCard({ location, typeLabel, electionDate }: { location: VoterLocation; typeLabel: string; electionDate?: string | null }) {
  const address = locationAddress(location)
  const directions = directionsUrl(location)
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="rounded bg-slate-700 px-2 py-0.5 text-xs font-sans-medium text-slate-300">{typeLabel}</Text>
        {location.startDate && location.endDate ? (
          <Text className="font-sans text-xs text-slate-400">
            {location.startDate} – {location.endDate}
          </Text>
        ) : null}
      </View>
      <Text className="mt-2 text-base font-sans-semibold text-slate-100">{location.locationName || 'Polling Location'}</Text>
      {address ? (
        <View className="mt-1.5 flex-row items-start gap-1.5">
          <Icons.MapPin size={14} colorClassName="accent-slate-400" />
          <Text className="font-sans flex-1 text-xs text-slate-300">{address}</Text>
        </View>
      ) : null}
      {location.pollingHours ? <PollingHours hours={location.pollingHours} electionDate={electionDate} /> : null}
      {location.notes ? <Text className="font-sans mt-2 text-xs italic text-slate-400">{location.notes}</Text> : null}
      {directions ? (
        <Pressable onPress={() => openUrl(directions)} accessibilityRole="link" className="mt-4 flex-row items-center gap-1.5 border-t border-slate-700/60 pt-3">
          <Icons.Navigation size={14} colorClassName="accent-blue-400" />
          <Text className="text-xs font-sans-semibold text-blue-400">Directions</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function PollingHours({ hours, electionDate }: { hours: string; electionDate?: string | null }) {
  const { upcoming, passed } = splitPollingHours(hours, { electionDate })
  const [showPassed, setShowPassed] = useState(false)
  return (
    <View className="mt-2 flex-row items-start gap-1.5">
      <Icons.Clock size={14} colorClassName="accent-slate-500" />
      <View className="min-w-0 flex-1">
        {upcoming.length > 0 ? (
          upcoming.map((line, idx) => (
            <Text key={idx} className="font-sans text-xs text-slate-400">
              {line}
            </Text>
          ))
        ) : (
          <Text className="font-sans text-xs italic text-slate-500">No upcoming hours listed for this site.</Text>
        )}
        {passed.length > 0 ? (
          <>
            <Pressable onPress={() => setShowPassed(!showPassed)} accessibilityRole="button" accessibilityState={{ expanded: showPassed }} className="mt-1.5">
              <Text className="font-sans text-xs text-slate-500">
                {showPassed ? 'Hide' : 'Passed dates'} ({passed.length})
              </Text>
            </Pressable>
            {showPassed
              ? passed.map((line, idx) => (
                  <Text key={idx} className="font-sans mt-0.5 text-xs text-slate-500">
                    {line}
                  </Text>
                ))
              : null}
          </>
        ) : null}
      </View>
    </View>
  )
}

function OfficeCard({ body, role }: { body: AdminBody; role: string }) {
  const address = formatCivicAddress(body.physicalAddress)
  const rows = [
    address ? { Icon: Icons.Building2, text: address } : null,
    body.hoursOfOperation ? { Icon: Icons.Clock, text: body.hoursOfOperation } : null,
    body.phone ? { Icon: Icons.Phone, text: body.phone, url: `tel:${body.phone}` } : null,
    body.email ? { Icon: Icons.Mail, text: body.email, url: `mailto:${body.email}` } : null,
  ].filter((row) => row !== null)
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <Text className="text-xs font-sans-semibold uppercase tracking-wider text-blue-400">{role}</Text>
      <Text className="mt-1 text-base font-sans-semibold text-slate-100">{body.name || role}</Text>
      <View className="mt-3 gap-1.5">
        {rows.map(({ Icon, text, url }) => (
          <Pressable key={text} disabled={!url} onPress={() => url && openUrl(url)} accessibilityRole={url ? 'link' : undefined} className="flex-row items-start gap-1.5">
            <Icon size={14} colorClassName="accent-slate-400" />
            <Text className={`font-sans flex-1 text-xs ${url ? 'text-blue-300' : 'text-slate-300'}`}>{text}</Text>
          </Pressable>
        ))}
      </View>
      {body.electionInfoUrl ? (
        <Pressable onPress={() => openUrl(body.electionInfoUrl!)} accessibilityRole="link" className="mt-3 flex-row items-center gap-1 border-t border-slate-700/60 pt-2">
          <Text className="text-xs font-sans-semibold text-blue-400">Official Website</Text>
          <Icons.ExternalLink size={12} colorClassName="accent-blue-400" />
        </Pressable>
      ) : null}
    </View>
  )
}

function StaticFallback({ stateCode }: { stateCode: string | null }) {
  const fallback = staticFallback(stateCode)
  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800/80 p-5">
      <Text className="text-sm font-sans-semibold uppercase tracking-wider text-slate-300">{fallback.title}</Text>
      <Text className="font-sans mt-1 text-xs text-slate-400">{fallback.intro}</Text>
      <View className="mt-4 flex-row flex-wrap gap-3">
        {fallback.links.map((link) => (
          <LinkButton key={link.label} label={link.label} url={link.url} style={link.primary ? 'primary' : 'plain'} />
        ))}
      </View>
      {fallback.portalNote ? (
        <Text className="font-sans mt-3 text-xs text-slate-500">
          {fallback.portalNote.lead}
          <Text className="font-sans-medium text-slate-400">{fallback.portalNote.hosts}</Text>
          {fallback.portalNote.tail}
        </Text>
      ) : null}
    </View>
  )
}
