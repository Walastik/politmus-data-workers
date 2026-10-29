import {
  LEGAL_FORCE_LABELS,
  VOTE_KIND_CHIPS,
  amendmentLabel,
  bipartisanTag,
  breadthNote,
  crsSummaryBlocks,
  legalForceNote,
  partyCounts,
  partyStateLabel,
  rollCallMeta,
  voteKindChipClass,
} from '@politmus/core/billProfile'
import {
  billStatusClass,
  committeeReportUrl,
  directionBadgeClass,
  formatBillDate,
  mechanismBadgeClass,
  partyBadgeClass,
  type Bill,
  type BillAmendment,
  type BillDebate,
  type BillDocuments,
  type BillRollCall,
  type BillSourceSummary,
  type ClassificationIntent,
  type ClassificationMetadata,
  type DebatePoint,
} from '@politmus/core/types'
import { chamberDivergenceNote } from '@politmus/core/voteContext'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

import { Icons } from '../icons'
import { Collapsible, Pill, Quote, SectionHeading } from './parts'

// Sections of the bill profile; native counterparts of the web BillDrawer and
// BillContextSections pieces.

export function BillTags({ bill }: { bill: Bill }) {
  const bipartisan = bipartisanTag(bill)
  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-2">
      {bill.status ? <Pill className={billStatusClass(bill.status)}>{bill.status}</Pill> : null}
      {bill.policy_area ? <Pill className="bg-blue-900/50 text-blue-300">{bill.policy_area}</Pill> : null}
      {bipartisan ? <Pill className={bipartisan.className}>{bipartisan.label}</Pill> : null}
    </View>
  )
}

export function ChamberDivergence({ bill }: { bill: Bill }) {
  const note = chamberDivergenceNote(bill)
  if (!note) return null
  return (
    <Text className="mt-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs text-slate-200">
      <Text className="font-semibold">The chambers voted differently.</Text> {note}
    </Text>
  )
}

export function RollCalls({ rollCalls }: { rollCalls?: BillRollCall[] }) {
  if (!rollCalls || rollCalls.length === 0) return null
  return (
    <View>
      <SectionHeading>Roll calls</SectionHeading>
      <View className="mt-3 gap-2">
        {rollCalls.map((rollCall) => {
          const meta = rollCallMeta(rollCall)
          const kind = rollCall.vote_kind && VOTE_KIND_CHIPS[rollCall.vote_kind] ? rollCall.vote_kind : null
          return (
            <View key={rollCall.id} className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-medium text-slate-100">{rollCall.result || 'Recorded vote'}</Text>
                {kind ? (
                  <Pill rounded="rounded border" className={voteKindChipClass(kind)}>
                    {VOTE_KIND_CHIPS[kind]}
                  </Pill>
                ) : null}
              </View>
              {rollCall.question ? <Text className="mt-0.5 text-xs text-slate-300">{rollCall.question}</Text> : null}
              {meta ? <Text className="mt-1 text-[11px] text-slate-500">{meta}</Text> : null}
            </View>
          )
        })}
      </View>
    </View>
  )
}

export function CrsSummary({ text }: { text: string }) {
  const blocks = crsSummaryBlocks(text)
  return (
    <View className="mt-3 gap-2">
      {blocks.map((block, index) => (
        <View key={index} className={block.kind === 'item' ? 'flex-row gap-2 pl-2' : ''}>
          {block.kind === 'item' ? <Text className="text-sm text-slate-400">•</Text> : null}
          <Text className="flex-1 text-sm leading-relaxed text-slate-300">
            {block.runs.map((run, i) =>
              run.strong ? (
                <Text key={i} className="font-semibold text-slate-100">
                  {run.text}
                </Text>
              ) : (
                run.text
              ),
            )}
          </Text>
        </View>
      ))}
    </View>
  )
}

function PartyChip({ party, state }: { party?: string | null; state?: string | null }) {
  if (!party && !state) return null
  const cls = party ? partyBadgeClass(party) : 'bg-slate-800 text-slate-300'
  return (
    <View className={`rounded px-1.5 py-0.5 ${cls}`}>
      <Text className={`text-[10px] font-semibold ${cls}`}>{partyStateLabel(party, state)}</Text>
    </View>
  )
}

// -- debate --------------------------------------------------------------------

function DebatePointItem({ point }: { point: DebatePoint }) {
  const who = point.kind === 'committee_views' ? point.title : point.speaker
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
      <Text className="text-xs leading-relaxed text-slate-100">{point.point}</Text>
      <Quote text={point.quote} border="border-slate-600" tone="text-slate-300" />
      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
        <Text className="text-[11px] font-medium text-slate-300">
          {point.chamber && point.kind !== 'committee_views' ? `${point.chamber === 'Senate' ? 'Sen.' : 'Rep.'} ` : ''}
          {who || 'Unknown speaker'}
        </Text>
        <PartyChip party={point.party} state={point.state} />
        {point.date ? <Text className="text-[11px] text-slate-400">{formatBillDate(point.date)}</Text> : null}
        {point.url ? (
          <Text onPress={() => openUrl(point.url!)} className="text-[11px] text-sky-300 underline">
            {point.kind === 'committee_views' ? 'Committee report' : 'Congressional Record'}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function DebateColumn({ label, points, empty }: { label: string; points: DebatePoint[]; empty: string }) {
  return (
    <View>
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</Text>
      {points.length > 0 ? (
        <View className="mt-2 gap-2">
          {points.map((point) => (
            <DebatePointItem key={`${point.source_id}-${point.quote}`} point={point} />
          ))}
        </View>
      ) : (
        <Text className="mt-2 text-xs text-slate-500">{empty}</Text>
      )}
    </View>
  )
}

// Each side's main arguments, in members' own words (quotes verified against
// the Congressional Record). Sides are by argument, not party.
export function Debate({ debate }: { debate?: BillDebate | null }) {
  if (!debate || (debate.supporters.length === 0 && debate.opponents.length === 0)) return null
  return (
    <View className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <View className="flex-row items-center gap-2">
        <Icons.MessagesSquare size={16} colorClassName="accent-slate-300" />
        <Text className="text-xs font-semibold uppercase tracking-wider text-slate-300">Where the sides disagree</Text>
      </View>
      {debate.key_dispute ? <Text className="mt-2 text-sm leading-relaxed text-slate-100">{debate.key_dispute}</Text> : null}
      <View className="mt-3 gap-4">
        <DebateColumn label="Supporters say" points={debate.supporters} empty="No arguments for the bill were found in the stored floor statements." />
        <DebateColumn label="Opponents say" points={debate.opponents} empty="No arguments against the bill were found in the stored floor statements." />
      </View>
      <Text className="mt-3 text-[10px] leading-relaxed text-slate-500">
        AI summary of {debate.sources_considered ?? 'the'} stored floor statement{debate.sources_considered === 1 ? '' : 's'} and committee
        views. Every quote is checked word for word against its source. Sides are assigned by what members argued, not by party, and each side
        shows the same number of points.
      </Text>
    </View>
  )
}

// -- AI classification ---------------------------------------------------------------

function ExplainerCard({ tag, tagTone, title, text }: { tag: string; tagTone: string; title: string; text: string }) {
  return (
    <View className="mt-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3">
      <View className="flex-row items-center gap-1.5">
        <Text className={`rounded border bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold ${tagTone}`}>{tag}</Text>
        <Text className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</Text>
      </View>
      <Text className="mt-1.5 text-xs leading-relaxed text-slate-200">{text}</Text>
    </View>
  )
}

function IntentCard({ intent }: { intent: ClassificationIntent }) {
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
      <Text className="text-sm font-semibold text-slate-100">{intent.target}</Text>
      <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
        <Pill rounded="rounded border" className={mechanismBadgeClass(intent.mechanism)}>
          {intent.mechanism}
        </Pill>
        <Pill rounded="rounded border" className={directionBadgeClass(intent.direction)}>
          {intent.direction}
        </Pill>
        {intent.magnitude ? (
          <Pill rounded="rounded border" className="border-slate-700 bg-slate-800 text-slate-400">
            {intent.magnitude}
          </Pill>
        ) : null}
        {intent.legal_force && LEGAL_FORCE_LABELS[intent.legal_force] ? (
          <Pill rounded="rounded border" className="border-sky-600/50 bg-sky-950/40 text-sky-300">
            {LEGAL_FORCE_LABELS[intent.legal_force]}
          </Pill>
        ) : null}
        {intent.relation === 'secondary' ? (
          <Pill rounded="rounded border" className="border-amber-600/50 bg-amber-950/40 text-amber-300">
            Unrelated
          </Pill>
        ) : null}
      </View>
      {intent.rationale ? <Text className="mt-2 text-xs leading-relaxed text-slate-300">{intent.rationale}</Text> : null}
      {intent.citation ? <Quote text={intent.citation} /> : null}
    </View>
  )
}

export function AiClassification({ metadata, model }: { metadata?: ClassificationMetadata | null; model?: string | null }) {
  const intents = metadata?.intents ?? []
  const breadth = breadthNote(intents)
  const legal = legalForceNote(intents)
  return (
    <View className="rounded-xl border border-purple-500/30 bg-purple-950/10 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Icons.Sparkles size={16} colorClassName="accent-purple-400" />
          <Text className="text-xs font-semibold uppercase tracking-wider text-purple-300">AI Policy Classification</Text>
        </View>
        {model ? <Text className="rounded bg-purple-900/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-purple-300">{model}</Text> : null}
      </View>

      {metadata?.tldr ? <ExplainerCard tag="TL;DR" tagTone="border-purple-500/30 text-purple-300" title="Quick Summary" text={metadata.tldr} /> : null}
      {metadata?.eli5 ? <ExplainerCard tag="ELI5" tagTone="border-amber-500/30 text-amber-300" title="Explain Like I'm 5" text={metadata.eli5} /> : null}

      {breadth ? (
        <View className="mt-3 gap-1.5 rounded-lg border border-amber-600/40 bg-amber-950/20 p-3">
          {breadth.broad ? (
            <Text className="text-xs text-amber-100">
              <Text className="font-bold">Broad bill:</Text> {breadth.broad}
            </Text>
          ) : null}
          {breadth.unrelatedLabel ? (
            <Text className="text-xs text-amber-100">
              <Text className="font-bold">{breadth.unrelatedLabel}</Text> {breadth.unrelatedList}
            </Text>
          ) : null}
        </View>
      ) : null}
      {legal ? (
        <Text className="mt-3 rounded-lg border border-sky-600/40 bg-sky-950/20 p-3 text-xs text-sky-100">
          <Text className="font-bold">{legal.label}</Text> {legal.text}
        </Text>
      ) : null}

      {intents.length > 0 ? (
        <View className="mt-3 gap-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Policy Targets & Levers ({intents.length})</Text>
          {intents.map((intent, idx) => (
            <IntentCard key={idx} intent={intent} />
          ))}
        </View>
      ) : (
        <Text className="mt-2 text-xs text-slate-400">
          {metadata ? 'Metadata recorded, but no intents parsed.' : 'No AI classification metadata recorded for this bill yet.'}
        </Text>
      )}
    </View>
  )
}

// -- amendments, floor statements, documents ----------------------------------------------

function AmendmentItem({ amendment }: { amendment: BillAmendment }) {
  const [expanded, setExpanded] = useState(false)
  const description = amendment.purpose || amendment.text_excerpt
  return (
    <View className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Text className="text-xs font-medium text-slate-100">{amendmentLabel(amendment)}</Text>
        <Text className="text-xs text-slate-400">{amendment.sponsor_name || 'Unknown sponsor'}</Text>
        <PartyChip party={amendment.sponsor_party} />
        {amendment.submitted_date ? <Text className="text-[11px] text-slate-500">{formatBillDate(amendment.submitted_date)}</Text> : null}
      </View>
      <Text className="mt-1 text-[11px] text-slate-400">{amendment.latest_action_text || 'Filed; no vote or other action recorded.'}</Text>
      {description ? (
        <Text className="mt-1 text-[11px] text-slate-300" numberOfLines={expanded ? undefined : 2}>
          {description}
        </Text>
      ) : null}
      <View className="mt-1 flex-row gap-3">
        {description && description.length > 160 ? (
          <Text onPress={() => setExpanded(!expanded)} className="text-[11px] text-sky-300">
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        ) : null}
        {amendment.text_url ? (
          <Text onPress={() => openUrl(amendment.text_url!)} className="text-[11px] text-sky-300">
            Full text
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function FloorStatement({ source }: { source: BillSourceSummary }) {
  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      <Text className="text-[11px] text-slate-500">
        {source.date ? formatBillDate(source.date) : ''} {source.chamber ?? ''}
      </Text>
      <Text className="text-xs font-medium text-slate-100">{source.kind === 'committee_views' ? source.title : source.speaker_name}</Text>
      <PartyChip party={source.speaker_party} state={source.speaker_state} />
      <Text className="text-[11px] text-slate-500">{source.words.toLocaleString()} words</Text>
      {source.url ? (
        <Text onPress={() => openUrl(source.url!)} className="text-[11px] text-sky-300">
          Read
        </Text>
      ) : null}
    </View>
  )
}

function Documents({ documents }: { documents?: BillDocuments | null }) {
  const reports = documents?.committee_reports ?? []
  const estimates = documents?.cbo_cost_estimates ?? []
  if (reports.length === 0 && estimates.length === 0) return null
  return (
    <View>
      <SectionHeading>Documents</SectionHeading>
      <View className="mt-2 gap-1">
        {reports.map((report) => {
          const url = committeeReportUrl(report.citation)
          return url ? (
            <Text key={report.citation} onPress={() => openUrl(url)} className="text-xs text-sky-300">
              Committee report {report.citation}
            </Text>
          ) : (
            <Text key={report.citation} className="text-xs text-slate-300">
              Committee report {report.citation}
            </Text>
          )
        })}
        {estimates.map((estimate) => (
          <Text key={estimate.url} className="text-xs text-slate-500">
            <Text onPress={() => openUrl(estimate.url)} className="text-sky-300">
              CBO cost estimate
            </Text>
            {estimate.description ? ` · ${estimate.description}` : ''}
          </Text>
        ))}
      </View>
    </View>
  )
}

export function BillContext({ bill }: { bill: Bill }) {
  const amendments = bill.amendments ?? []
  const sources = bill.sources ?? []
  const plain = { boxClassName: '', tone: 'text-slate-400' }
  return (
    <>
      {amendments.length > 0 ? (
        <Collapsible {...plain} title={`Amendments filed (${amendments.length}: ${partyCounts(amendments.map((a) => a.sponsor_party))})`}>
          <View className="mt-3 gap-2">
            {amendments.map((amendment) => (
              <AmendmentItem key={amendment.id} amendment={amendment} />
            ))}
          </View>
        </Collapsible>
      ) : null}
      {sources.length > 0 ? (
        <Collapsible {...plain} title={`Floor statements (${sources.length}: ${partyCounts(sources.map((s) => s.speaker_party))})`}>
          <View className="mt-3 gap-1.5">
            {sources.map((source) => (
              <FloorStatement key={source.id} source={source} />
            ))}
          </View>
        </Collapsible>
      ) : null}
      <Documents documents={bill.documents} />
    </>
  )
}
