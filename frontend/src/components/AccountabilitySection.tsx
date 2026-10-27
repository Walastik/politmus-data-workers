import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { useMemo, useState } from 'react'

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
} from '../accountability'
import { sourceLabel } from '../positions'
import { positionBadgeClass, type AccountabilityScore, type VoteAlignment } from '../types'

export default function AccountabilitySection({
  score,
  alignments,
  onSelectBill,
}: {
  score: AccountabilityScore
  alignments: VoteAlignment[]
  onSelectBill?: (alignment: VoteAlignment) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState(false)
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
    <section
      className="mb-6 rounded-xl border border-slate-700 bg-slate-800/40 p-4"
      aria-labelledby="accountability-title"
    >
      <h3 id="accountability-title">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="accountability-body"
          className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300 transition hover:text-white"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
          )}
          <Scale className="h-4 w-4 text-slate-300" aria-hidden="true" />
          Politmus Report
        </button>
      </h3>

      {open ? (
        <div id="accountability-body">
          <p className="mt-2 text-xs text-slate-400">
            {score.aligned + score.conflicting === 0
              ? 'None of their passage votes touch what they say they want yet.'
              : `${plural(score.aligned, 'vote')} matched and ${score.conflicting} contradicted their stated positions, across ${plural(score.bills_scored, 'bill')}.`}
          </p>

          {areas.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Score by policy area">
              {areas.map(([area, totals]) => (
                <li
                  key={area}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300"
                >
                  {area}{' '}
                  <span className={`font-semibold ${pointsToneClass(totals.points)}`}>
                    {formatPoints(totals.points)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {votes.length > 0 ? (
            <ul className="mt-4 space-y-2.5">
              {visible.map((vote) => (
                <VoteItem key={vote.key} vote={vote} onSelectBill={onSelectBill} />
              ))}
            </ul>
          ) : null}

          {votes.length > INITIAL_ALIGNMENTS_SHOWN ? (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="mt-3 text-xs font-medium text-slate-300 hover:text-white"
            >
              {showAll ? 'Show fewer' : `Show all ${votes.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function resultLabel(result: number | null) {
  if (result === null) return 'Not scored'
  if (result > 0) return 'Consistent, plus one'
  if (result < 0) return 'Contradicts, minus one'
  return 'Mixed, no points'
}

function VoteItem({
  vote,
  onSelectBill,
}: {
  vote: VoteGroup
  onSelectBill?: (alignment: VoteAlignment) => void
}) {
  const first = vote.matches[0]
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectBill?.(first)}
          className="min-w-0 text-left"
          aria-label={`Open details for ${first.bill_title || first.bill_id}`}
        >
          <p className="font-mono text-[11px] text-slate-400">
            {first.bill_id}
            {first.vote_date ? ` · ${first.vote_date}` : ''}
          </p>
          <p className="text-sm font-medium leading-snug text-slate-100 hover:underline">
            {first.bill_title || 'Untitled bill'}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${positionBadgeClass(first.vote_position)}`}
          >
            {first.vote_position}
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-xs font-bold ${pointsBadgeClass(vote.result ?? 0)}`}
            aria-label={resultLabel(vote.result)}
          >
            {vote.result === null ? 'N/A' : formatPoints(vote.result)}
          </span>
        </div>
      </div>
      <ul className="mt-2 space-y-2">
        {vote.matches.map((match) => (
          <MatchItem key={`${match.target_name}-${match.mechanism}`} match={match} />
        ))}
      </ul>
    </li>
  )
}

function MatchItem({ match }: { match: VoteAlignment }) {
  const counted = match.counted !== false
  const consistent = match.points > 0
  return (
    <li className={counted ? '' : 'opacity-70'}>
      <p className="text-xs text-slate-300">
        Voted <strong>{match.vote_position}</strong> on a bill that{' '}
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
      </p>
      {counted ? null : (
        <p className="mt-0.5 text-[11px] text-slate-400">
          Not counted: {notCountedReason(match.reason)}.
        </p>
      )}
      {match.stance_evidence_quote ? (
        <blockquote className="mt-1.5 rounded-r border-l-2 border-purple-500/60 bg-purple-950/30 py-1 pr-2 pl-2.5">
          <p className="text-[11px] italic text-purple-200">
            &ldquo;{match.stance_evidence_quote}&rdquo;
          </p>
        </blockquote>
      ) : null}
      {match.stance_source_url ? (
        <a
          href={match.stance_source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Source: {sourceLabel(match.stance_source_url)}
        </a>
      ) : null}
    </li>
  )
}
