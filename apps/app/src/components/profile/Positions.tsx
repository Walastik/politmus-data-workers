import {
  INITIAL_ALIGNMENTS_SHOWN,
  effectPhrase,
  formatPoints,
  groupByVote,
  notCountedReason,
  plural,
  pointsBadgeClass,
  pointsToneClass,
  wantsPhrase,
  type VoteGroup,
} from '@politmus/core/accountability'
import { alignmentResultLabel } from '@politmus/core/memberProfile'
import {
  DIRECTION_LABELS,
  INITIAL_ISSUES_SHOWN,
  groupPositions,
  positionsStatusMessage,
  sourceLabel,
  stanceLine,
  targetPreview,
  type PositionGroup,
} from '@politmus/core/positions'
import {
  directionBadgeClass,
  mechanismBadgeClass,
  positionBadgeClass,
  type AccountabilityScore,
  type OfficialStance,
  type PositionsSync,
  type VoteAlignment,
} from '@politmus/core/types'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

import { Icons } from '../icons'
import { Collapsible, Pill, Quote } from './parts'

// The Politmus Report and Stated Positions sections of the member profile;
// native counterparts of the web AccountabilitySection and StatedPositionsSection.

export function AccountabilityReport({
  score,
  alignments,
  onSelectAlignment,
}: {
  score: AccountabilityScore
  alignments: VoteAlignment[]
  onSelectAlignment: (alignment: VoteAlignment) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const areas = useMemo(
    () =>
      Object.entries(score.by_policy_area ?? {}).sort(
        ([, a], [, b]) => b.aligned + b.conflicting - (a.aligned + a.conflicting),
      ),
    [score.by_policy_area],
  )
  const votes = useMemo(() => groupByVote(alignments), [alignments])
  const visible = showAll ? votes : votes.slice(0, INITIAL_ALIGNMENTS_SHOWN)

  return (
    <Collapsible title="Politmus Report" icon={<Icons.Scale size={16} colorClassName="accent-slate-300" />}>
      <Text className="font-sans mt-2 text-xs text-slate-400">
        {score.aligned + score.conflicting === 0
          ? 'None of their passage votes touch what they say they want yet.'
          : `${plural(score.aligned, 'vote')} matched and ${score.conflicting} contradicted their stated positions, across ${plural(score.bills_scored, 'bill')}.`}
      </Text>

      {areas.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {areas.map(([area, totals]) => (
            <Text key={area} className="font-sans rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
              {area} <Text className={`font-sans-semibold ${pointsToneClass(totals.points)}`}>{formatPoints(totals.points)}</Text>
            </Text>
          ))}
        </View>
      ) : null}

      {votes.length > 0 ? (
        <View className="mt-4 gap-2.5">
          {visible.map((vote) => (
            <VoteItem key={vote.key} vote={vote} onSelect={onSelectAlignment} />
          ))}
        </View>
      ) : null}

      {votes.length > INITIAL_ALIGNMENTS_SHOWN ? (
        <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button" className="mt-3">
          <Text className="text-xs font-sans-medium text-slate-300">{showAll ? 'Show fewer' : `Show all ${votes.length}`}</Text>
        </Pressable>
      ) : null}
    </Collapsible>
  )
}

function VoteItem({ vote, onSelect }: { vote: VoteGroup; onSelect: (alignment: VoteAlignment) => void }) {
  const first = vote.matches[0]
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
      <View className="flex-row items-start justify-between gap-2">
        <Pressable
          onPress={() => onSelect(first)}
          accessibilityRole="button"
          accessibilityLabel={`Open details for ${first.bill_title || first.bill_id}`}
          className="min-w-0 flex-1"
        >
          <Text className="font-mono text-[11px] text-slate-400">
            {first.bill_id}
            {first.vote_date ? ` · ${first.vote_date}` : ''}
          </Text>
          <Text className="text-sm font-sans-medium leading-snug text-slate-100">{first.bill_title || 'Untitled bill'}</Text>
        </Pressable>
        <View className="flex-row items-center gap-1.5">
          <Pill rounded="rounded" className={positionBadgeClass(first.vote_position)}>
            {first.vote_position}
          </Pill>
          <View accessibilityLabel={alignmentResultLabel(vote.result)} className={`rounded border px-1.5 py-0.5 ${pointsBadgeClass(vote.result ?? 0)}`}>
            <Text className={`text-xs font-sans-bold ${pointsBadgeClass(vote.result ?? 0)}`}>
              {vote.result === null ? '—' : formatPoints(vote.result)}
            </Text>
          </View>
        </View>
      </View>
      <View className="mt-2 gap-2">
        {vote.matches.map((match) => (
          <MatchItem key={`${match.target_name}-${match.mechanism}`} match={match} />
        ))}
      </View>
    </View>
  )
}

function MatchItem({ match }: { match: VoteAlignment }) {
  const counted = match.counted !== false
  const consistent = match.points > 0
  return (
    <View className={counted ? '' : 'opacity-70'}>
      <Text className="font-sans text-xs text-slate-300">
        Voted <Text className="font-sans-bold">{match.vote_position}</Text> on a bill that{' '}
        {effectPhrase(match.effect_direction, match.target_name, match.mechanism)}
        {counted && match.effect_relation === 'secondary' ? ' (via an unrelated provision)' : ''};{' '}
        {consistent ? 'consistent: ' : 'contradicts: '}
        {wantsPhrase(match.stance_direction)}
        {match.match_similarity != null && match.stance_target_name
          ? match.match_inverse
            ? ` (their position is on ${match.stance_target_name}, which moves the opposite way)`
            : ` (their position is on ${match.stance_target_name})`
          : ''}
        .
      </Text>
      {counted ? null : <Text className="font-sans mt-0.5 text-[11px] text-slate-400">Not counted: {notCountedReason(match.reason)}.</Text>}
      {match.stance_evidence_quote ? <Quote text={match.stance_evidence_quote} /> : null}
      {match.stance_source_url ? <SourceLink url={match.stance_source_url} /> : null}
    </View>
  )
}

function SourceLink({ url }: { url: string }) {
  return (
    <Text onPress={() => openUrl(url)} accessibilityRole="link" className="font-sans mt-1 text-[11px] text-slate-500 underline">
      Source: {sourceLabel(url)}
    </Text>
  )
}

export function StatedPositions({ positions, sync }: { positions: OfficialStance[]; sync: PositionsSync | null }) {
  const [showAll, setShowAll] = useState(false)
  const issues = useMemo(() => groupPositions(positions), [positions])
  const visible = showAll ? issues : issues.slice(0, INITIAL_ISSUES_SHOWN)
  const maxCount = issues[0]?.count ?? 0
  const models = useMemo(() => Array.from(new Set(positions.map((p) => p.model).filter(Boolean))) as string[], [positions])

  return (
    <Collapsible
      title="Stated Positions (AI)"
      icon={<Icons.Sparkles size={16} colorClassName="accent-purple-400" />}
      tone="text-purple-300"
      chevronAccent="accent-purple-400"
      boxClassName="rounded-xl border border-purple-500/30 bg-purple-950/10 p-4"
      right={
        models.length > 0 ? (
          <Text className="rounded bg-purple-900/50 px-1.5 py-0.5 font-mono text-[10px] text-purple-300">{models.join(', ')}</Text>
        ) : null
      }
    >
      <Text className={`font-sans mt-2 text-xs ${sync?.status === 'failed' ? 'text-rose-300' : 'text-slate-400'}`}>{positionsStatusMessage(sync)}</Text>

      {issues.length > 0 ? (
        <View className="mt-3 gap-4">
          <View>
            <Text className="text-[11px] font-sans-semibold uppercase tracking-wider text-slate-400">Top issues</Text>
            <Text className="font-sans mt-0.5 text-[11px] text-slate-500">Ranked by how many positions they state on each. Tap an issue for the details.</Text>
            <View className="mt-2 gap-1.5">
              {visible.map((group, idx) => (
                <IssueItem key={group.area} rank={idx + 1} group={group} maxCount={maxCount} />
              ))}
            </View>
          </View>
          {issues.length > INITIAL_ISSUES_SHOWN ? (
            <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button">
              <Text className="text-xs font-sans-medium text-purple-300">{showAll ? 'Show fewer' : `Show all ${issues.length} issues`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Collapsible>
  )
}

function IssueItem({ rank, group, maxCount }: { rank: number; group: PositionGroup; maxCount: number }) {
  const [open, setOpen] = useState(false)
  const preview = targetPreview(group)
  const Chevron = open ? Icons.ChevronDown : Icons.ChevronRight
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-900/60">
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} className="px-3 py-2 active:bg-slate-800/60">
        <View className="flex-row items-center gap-2">
          <Text className="w-5 text-right font-mono text-xs text-slate-500">{rank}.</Text>
          <Text className="min-w-0 flex-1 text-sm font-sans-semibold text-slate-100">
            {group.area} <Text className="font-sans text-slate-400">({group.count})</Text>
          </Text>
          <Chevron size={16} colorClassName="accent-slate-500" />
        </View>
        <View className="mt-1.5 ml-7 h-1 rounded-full bg-slate-800">
          <View className="h-1 rounded-full bg-purple-500/70" style={{ width: `${maxCount ? (group.count / maxCount) * 100 : 0}%` }} />
        </View>
        {preview ? (
          <Text className="font-sans mt-1 ml-7 text-[11px] text-slate-500" numberOfLines={1}>
            {preview}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View className="gap-2.5 border-t border-slate-800 p-3">
          {group.blocks.map((block, idx) =>
            block.positions.length > 1 ? (
              <SharedEvidenceBlock key={idx} positions={block.positions} />
            ) : (
              <PositionItem key={idx} position={block.positions[0]} />
            ),
          )}
        </View>
      ) : null}
    </View>
  )
}

function SharedEvidenceBlock({ positions }: { positions: OfficialStance[] }) {
  const [first] = positions
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
      {first.evidence_quote ? <Quote text={first.evidence_quote} /> : null}
      {first.source_url ? <SourceLink url={first.source_url} /> : null}
      <Text className="mt-2 text-[10px] font-sans-semibold uppercase tracking-wider text-slate-500">Supports {positions.length} positions</Text>
      <View className="mt-2 gap-2 border-l border-slate-800 pl-3">
        {positions.map((position, idx) => (
          <PositionItem key={`${position.target_name}-${position.mechanism}-${idx}`} position={position} compact />
        ))}
      </View>
    </View>
  )
}

function PositionItem({ position, compact = false }: { position: OfficialStance; compact?: boolean }) {
  const line = stanceLine(position)
  const direction = position.direction?.toLowerCase()
  return (
    <View className={compact ? '' : 'rounded-lg border border-slate-800 bg-slate-900/90 p-3'}>
      <Text className="text-sm font-sans-semibold text-slate-100">{position.target_name || 'Unnamed target'}</Text>
      <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
        <Pill rounded="rounded border" className={directionBadgeClass(direction)}>
          wants {DIRECTION_LABELS[direction] ?? direction}
        </Pill>
        <Pill rounded="rounded border" className={mechanismBadgeClass(position.mechanism)}>
          {position.mechanism}
        </Pill>
        {position.emphasis ? (
          <Pill rounded="rounded border" className="border-slate-700 bg-slate-800 text-slate-400">
            {position.emphasis}
          </Pill>
        ) : null}
        {position.scope === 'local' ? (
          <Pill rounded="rounded border" className="border-slate-700 bg-slate-800 text-slate-400">
            local
          </Pill>
        ) : null}
      </View>
      {line ? <Text className="font-sans mt-1 text-[11px] text-slate-400">{line}</Text> : null}
      {position.summary ? <Text className="font-sans mt-2 text-xs leading-relaxed text-slate-300">{position.summary}</Text> : null}
      {compact ? (
        position.issue_label ? <Text className="font-sans mt-1 text-[11px] text-slate-500">{position.issue_label}</Text> : null
      ) : (
        <>
          {position.evidence_quote ? <Quote text={position.evidence_quote} /> : null}
          {position.issue_label ? <Text className="font-sans mt-2 text-[11px] text-slate-500">{position.issue_label}</Text> : null}
          {position.source_url ? <SourceLink url={position.source_url} /> : null}
        </>
      )}
    </View>
  )
}
