import { useAuth } from '@clerk/expo'
import {
  activeCandidacies,
  billFromAlignment,
  billFromVote,
  bioRows,
  candidacyLines,
  telHref,
  voteKey,
  voteMatchesSearch,
  voteMeta,
} from '@politmus/core/memberProfile'
import { websiteLabel } from '@politmus/core/representatives'
import {
  isCandidate,
  officeLine,
  officialName,
  partyBadgeClass,
  partyShort,
  positionBadgeClass,
  rosterStatusLabel,
  stateNameFromAbbr,
  type Candidacy,
  type Official,
  type OfficialBio,
} from '@politmus/core/types'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

import { Icons } from '@/components/icons'
import OfficialPhoto from '@/components/OfficialPhoto'
import FinanceSection from '@/components/profile/Finance'
import { SectionHeading, ShareButton } from '@/components/profile/parts'
import { AccountabilityReport, StatedPositions } from '@/components/profile/Positions'
import { ScoreHeadline } from '@/components/Score'
import { openBill, openUrl, profileShareUrl } from '@/lib/links'
import { useOfficial } from '@/lib/queries'

// The member (or candidate) profile; native counterpart of the web MemberDrawer.
export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isSignedIn } = useAuth()
  const official = useOfficial(id)
  const detail = official.data
  const [voteQuery, setVoteQuery] = useState('')
  const votes = useMemo(() => detail?.votes ?? [], [detail])
  const filteredVotes = useMemo(() => votes.filter((vote) => voteMatchesSearch(vote, voteQuery)), [votes, voteQuery])
  const name = detail ? officialName(detail) : ''

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: name || 'Profile',
          headerBackTitle: 'Back',
          headerRight: () => <ShareButton url={profileShareUrl('official', id)} title={name || 'Politmus profile'} />,
        }}
      />
      <ScrollView className="flex-1 bg-slate-900" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="w-full md:max-w-[960px] md:self-center gap-6 px-5 py-5" keyboardShouldPersistTaps="handled">
        {!detail ? (
          <Text className={`text-sm ${official.isError ? 'text-red-400' : 'text-slate-400'}`}>
            {official.isError ? official.error.message : 'Loading…'}
          </Text>
        ) : (
          <>
            <View className="flex-row items-center gap-4 border-b border-slate-800 pb-5">
              {detail.photo_url ? <OfficialPhoto url={detail.photo_url} name={name} party={detail.party} size="lg" /> : null}
              <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                  {detail.party ? (
                    <View className={`rounded px-2 py-0.5 ${partyBadgeClass(detail.party)}`}>
                      <Text className={`text-xs font-bold ${partyBadgeClass(detail.party)}`}>{partyShort(detail.party)}</Text>
                    </View>
                  ) : null}
                  <Text accessibilityRole="header" className="text-xl font-semibold text-slate-100">
                    {name || id}
                  </Text>
                  {detail.party ? (
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{rosterStatusLabel(detail)}</Text>
                  ) : null}
                </View>
                {detail.party ? (
                  <Text className="mt-1 text-sm text-slate-400">
                    {[stateNameFromAbbr(detail.state), officeLine(detail)].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {isSignedIn ? <ScoreHeadline points={detail.score_points} pct={detail.score_pct} matches={detail.score_matches} /> : null}
              </View>
            </View>

            {detail.candidacies?.length ? <Candidacies candidacies={detail.candidacies} /> : null}
            <Contact official={detail} />
            {detail.bio ? <Background bio={detail.bio} wikipediaUrl={detail.wikipedia_url ?? null} /> : null}

            {isSignedIn && detail.accountability ? (
              <AccountabilityReport
                score={detail.accountability}
                alignments={detail.alignments ?? []}
                onSelectAlignment={(alignment) => openBill(billFromAlignment(alignment, detail.votes))}
              />
            ) : null}
            {isSignedIn ? <StatedPositions positions={detail.stated_positions ?? []} sync={detail.positions_sync ?? null} /> : null}
            {isSignedIn && ((detail.level ?? 'federal') === 'federal' || isCandidate(detail)) ? <FinanceSection officialId={id} /> : null}

            {isCandidate(detail) ? null : (
              <View>
                <SectionHeading>Recorded votes</SectionHeading>
                {votes.length === 0 ? (
                  <Text className="mt-3 text-sm text-slate-400">No recorded votes in the ingested bills.</Text>
                ) : (
                  <>
                    <View className="mt-3 flex-row items-center gap-2 rounded border border-slate-700 bg-slate-800 px-3">
                      <Icons.Search size={16} colorClassName="accent-slate-500" />
                      <TextInput
                        value={voteQuery}
                        onChangeText={setVoteQuery}
                        placeholder="Title, summary, bill ID, or yes/no"
                        placeholderTextColorClassName="accent-slate-500"
                        accessibilityLabel="Search recorded votes by bill title, CRS summary, bill ID, or yes/no"
                        autoCorrect={false}
                        returnKeyType="search"
                        clearButtonMode="while-editing"
                        className="flex-1 py-2 text-sm text-slate-100"
                      />
                    </View>
                    {voteQuery.trim() ? (
                      <Text className="mt-2 text-xs text-slate-500">
                        Showing {filteredVotes.length} of {votes.length} {votes.length === 1 ? 'vote' : 'votes'}
                      </Text>
                    ) : null}
                    {filteredVotes.length === 0 ? (
                      <Text className="mt-3 text-sm text-slate-400">No recorded votes match this search.</Text>
                    ) : (
                      <View className="mt-3 gap-3">
                        {filteredVotes.map((vote) => (
                          <Pressable
                            key={voteKey(vote)}
                            onPress={() => openBill(billFromVote(vote))}
                            accessibilityRole="button"
                            accessibilityLabel={`Open details for ${vote.bill_title || vote.bill_id}`}
                            className="rounded-lg border border-slate-800 bg-slate-800/60 p-3 active:border-slate-500"
                          >
                            <View className="flex-row items-start justify-between gap-3">
                              <Text className="font-mono text-xs text-slate-400">{vote.bill_id}</Text>
                              <View className={`rounded px-2 py-0.5 ${positionBadgeClass(vote.position)}`}>
                                <Text className={`text-xs font-bold ${positionBadgeClass(vote.position)}`}>{vote.position ?? 'Unknown'}</Text>
                              </View>
                            </View>
                            <Text className="mt-1 text-sm font-medium leading-snug text-slate-100">{vote.bill_title || 'Untitled bill'}</Text>
                            {voteMeta(vote) ? <Text className="mt-1 text-xs text-slate-400">{voteMeta(vote)}</Text> : null}
                            {vote.sponsor_name ? <Text className="mt-1 text-xs text-slate-500">Sponsor: {vote.sponsor_name}</Text> : null}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  )
}

function Contact({ official }: { official: Official }) {
  const { phone, office_address: officeAddress, website_url: websiteUrl } = official
  if (!phone && !officeAddress && !websiteUrl) return null
  const tel = phone ? telHref(phone) : undefined
  return (
    <View>
      <SectionHeading>Contact</SectionHeading>
      <View className="mt-3 gap-3">
        {phone ? (
          <Pressable
            disabled={!tel}
            onPress={() => tel && openUrl(tel)}
            accessibilityRole="link"
            accessibilityLabel={`Call ${phone}`}
            className="flex-row items-start gap-2"
          >
            <Icons.Phone size={16} colorClassName="accent-slate-500" />
            <Text className="text-sm text-slate-200">{phone}</Text>
          </Pressable>
        ) : null}
        {officeAddress ? (
          <View className="flex-row items-start gap-2">
            <Icons.MapPin size={16} colorClassName="accent-slate-500" />
            <Text className="flex-1 text-sm text-slate-200">{officeAddress}</Text>
          </View>
        ) : null}
        {websiteUrl ? (
          <Pressable
            onPress={() => openUrl(websiteUrl)}
            accessibilityRole="link"
            accessibilityLabel={`${isCandidate(official) ? 'Campaign' : 'Official'} website, ${websiteLabel(websiteUrl)}`}
            className="flex-row items-start gap-2"
          >
            <Icons.Globe size={16} colorClassName="accent-slate-500" />
            <Text className="text-sm text-slate-200 underline">{websiteLabel(websiteUrl)}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function Candidacies({ candidacies }: { candidacies: Candidacy[] }) {
  const running = activeCandidacies(candidacies)
  if (running.length === 0) return null
  return (
    <View className="gap-3">
      {running.map((candidacy) => {
        const lines = candidacyLines(candidacy)
        return (
          <View key={`${candidacy.fec_candidate_id}-${candidacy.election_year}`} className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4">
            <View className="flex-row items-center gap-2">
              <Icons.Vote size={16} colorClassName="accent-amber-300" />
              <Text className="flex-1 text-xs font-semibold uppercase tracking-wider text-amber-300">{lines.title}</Text>
            </View>
            <Text className="mt-1 text-sm text-slate-300">{lines.status}</Text>
            <Text className="mt-1 text-xs text-slate-400">{lines.money}</Text>
          </View>
        )
      })}
    </View>
  )
}

function Background({ bio, wikipediaUrl }: { bio: OfficialBio; wikipediaUrl: string | null }) {
  const rows = bioRows(bio)
  if (!bio.description && rows.length === 0) return null
  return (
    <View>
      <SectionHeading>Background</SectionHeading>
      {bio.description ? <Text className="mt-2 text-sm text-slate-300">{bio.description}</Text> : null}
      <View className="mt-2 gap-1.5">
        {rows.map(([label, value]) => (
          <View key={label}>
            <Text className="text-xs text-slate-500">{label}</Text>
            <Text className="text-sm text-slate-200">{value}</Text>
          </View>
        ))}
      </View>
      <Text className="mt-2 text-[11px] text-slate-500">
        Source: Wikidata
        {wikipediaUrl ? (
          <>
            {' · '}
            <Text onPress={() => openUrl(wikipediaUrl)} className="text-blue-400">
              Wikipedia
            </Text>
          </>
        ) : null}
      </Text>
    </View>
  )
}
