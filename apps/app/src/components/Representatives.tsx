import {
  lookupSections,
  representativeDistrict,
  representativeKey,
  representativeState,
  websiteLabel,
} from '@politmus/core/representatives'
import {
  civicRepresentativeToOfficial,
  isCivicStateLevel,
  officialName,
  partyBadgeClass,
  partyShort,
  type CivicLookup,
  type CivicRepresentative,
} from '@politmus/core/types'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

import { openProfile, openUrl } from '@/lib/links'

import { Icons } from './icons'
import OfficialPhoto from './OfficialPhoto'
import { ScoreChip, ScoreHeadline } from './Score'

// Everyone who represents a looked-up place: Congress first, then the state.
export default function LookupResults({ lookup }: { lookup: CivicLookup }) {
  const { fallbackState, federal, state, other } = lookupSections(lookup)

  return (
    <View className="gap-8">
      <OfficeSection
        title="In Washington"
        description="Your two U.S. senators and your member of the House. Their Politmus Score compares how they vote with what they say they stand for."
      >
        {federal.length ? (
          <RepresentativeList representatives={federal} fallbackState={fallbackState} />
        ) : (
          <Text className="font-sans text-sm text-slate-500">No members of Congress found for this address.</Text>
        )}
      </OfficeSection>

      {state.length ? (
        <OfficeSection
          title={`In ${fallbackState || 'your state'}`}
          description="Your governor and state legislators. We don’t score state officials yet."
        >
          <RepresentativeList representatives={state} fallbackState={fallbackState} />
        </OfficeSection>
      ) : null}

      {other.length ? (
        <OfficeSection title="Other offices">
          <RepresentativeList representatives={other} fallbackState={fallbackState} />
        </OfficeSection>
      ) : null}
    </View>
  )
}

// One row per federal member, for a quick look on Happening Now.
export function FederalRepsStrip({ lookup }: { lookup: CivicLookup }) {
  const { fallbackState, federal } = lookupSections(lookup)
  if (federal.length === 0) return null
  return (
    <View className="gap-2">
      {federal.map((rep) => {
        const official = civicRepresentativeToOfficial(rep, representativeState(rep, fallbackState))
        const name = officialName(rep)
        return (
          <Pressable
            key={representativeKey(rep)}
            disabled={!official}
            onPress={() => official && openProfile(official)}
            accessibilityRole="button"
            accessibilityLabel={`${name}, ${rep.office}`}
            className="flex-row items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 active:border-slate-500"
          >
            <OfficialPhoto url={rep.photo_url} name={name} party={rep.party} size="sm" />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-sans-medium text-slate-100" numberOfLines={1}>
                {name}
              </Text>
              <Text className="font-sans text-[11px] text-slate-400" numberOfLines={1}>
                {rep.party ? `${partyShort(rep.party)} · ` : ''}
                {rep.office}
              </Text>
            </View>
            <ScoreChip official={rep} />
          </Pressable>
        )
      })}
    </View>
  )
}

function OfficeSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View>
      <Text className="text-sm font-sans-semibold uppercase tracking-wider text-slate-300">{title}</Text>
      {description ? <Text className="font-sans mt-1 text-sm text-slate-400">{description}</Text> : null}
      <View className="mt-4">{children}</View>
    </View>
  )
}

function RepresentativeList({
  representatives,
  fallbackState,
}: {
  representatives: CivicRepresentative[]
  fallbackState: string
}) {
  return (
    <View className="gap-4">
      {representatives.map((representative) => (
        <RepresentativeCard
          key={representativeKey(representative)}
          representative={representative}
          fallbackState={fallbackState}
        />
      ))}
    </View>
  )
}

function RepresentativeCard({
  representative,
  fallbackState,
}: {
  representative: CivicRepresentative
  fallbackState: string
}) {
  const party = representative.party || ''
  const phone = representative.phones[0]
  const website = representative.urls[0]
  const stateLabel = representativeState(representative, fallbackState)
  const official = civicRepresentativeToOfficial(representative, stateLabel)
  const name = officialName(representative)
  const district = representativeDistrict(representative)
  const stateLevel = isCivicStateLevel(representative)

  return (
    <View className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <View className="flex-row items-center gap-3">
        <OfficialPhoto url={representative.photo_url} name={name} party={party} size="md" />
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            {party ? (
              <View className={`rounded px-2 py-0.5 ${partyBadgeClass(party)}`}>
                <Text className={`text-xs font-sans-bold ${partyBadgeClass(party)}`}>{partyShort(party)}</Text>
              </View>
            ) : null}
            <Text className="text-base font-sans-semibold text-slate-100">{name}</Text>
          </View>
          <Text className="font-sans mt-1 text-xs text-slate-400">
            {representative.office}
            {district ? ` · ${district}` : stateLabel ? ` · ${stateLabel}` : ''}
          </Text>
        </View>
      </View>

      {stateLevel ? null : (
        <ScoreHeadline
          points={representative.score_points}
          pct={representative.score_pct}
          matches={representative.score_matches}
        />
      )}
      {!stateLevel && representative.score_matches == null ? (
        <Text className="font-sans mt-3 text-[11px] text-slate-500">Politmus Score: no stated positions to score yet</Text>
      ) : null}

      <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-2">
        {phone ? (
          <Pressable onPress={() => openUrl(`tel:${phone}`)} accessibilityRole="link" className="flex-row items-center gap-1.5">
            <Icons.Phone size={14} colorClassName="accent-slate-300" />
            <Text className="font-sans text-xs text-slate-300">{phone}</Text>
          </Pressable>
        ) : null}
        {website ? (
          <Pressable onPress={() => openUrl(website)} accessibilityRole="link" className="flex-row items-center gap-1.5">
            <Icons.Globe size={14} colorClassName="accent-slate-300" />
            <Text className="font-sans text-xs text-slate-300" numberOfLines={1}>
              {websiteLabel(website)}
            </Text>
          </Pressable>
        ) : null}
        {official ? (
          <Pressable
            onPress={() => openProfile(official)}
            accessibilityRole="button"
            accessibilityLabel={`Full profile: ${name}`}
            className="ml-auto flex-row items-center gap-0.5"
          >
            <Text className="text-xs font-sans-semibold text-blue-400">Full profile</Text>
            <Icons.ChevronRight size={14} colorClassName="accent-blue-400" />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
