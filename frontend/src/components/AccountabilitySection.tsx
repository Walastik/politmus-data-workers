import { Scale } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  INITIAL_ALIGNMENTS_SHOWN,
  effectPhrase,
  formatPoints,
  plural,
  pointsBadgeClass,
  pointsToneClass,
  wantsPhrase,
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
  const areas = useMemo(
    () =>
      Object.entries(score.by_policy_area ?? {}).sort(
        ([, a], [, b]) => b.aligned + b.conflicting - (a.aligned + a.conflicting),
      ),
    [score.by_policy_area],
  )
  const visible = showAll ? alignments : alignments.slice(0, INITIAL_ALIGNMENTS_SHOWN)

  return (
    <section
      className="mb-6 rounded-xl border border-slate-700 bg-slate-800/40 p-4"
      aria-labelledby="accountability-title"
    >
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-slate-300" aria-hidden="true" />
        <h3
          id="accountability-title"
          className="text-xs font-semibold uppercase tracking-wider text-slate-300"
        >
          Says vs. votes
        </h3>
      </div>
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

      {alignments.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {visible.map((alignment) => (
            <AlignmentItem
              key={`${alignment.roll_call_id}-${alignment.target_name}-${alignment.mechanism}`}
              alignment={alignment}
              onSelectBill={onSelectBill}
            />
          ))}
        </ul>
      ) : null}

      {alignments.length > INITIAL_ALIGNMENTS_SHOWN ? (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mt-3 text-xs font-medium text-slate-300 hover:text-white"
        >
          {showAll ? 'Show fewer' : `Show all ${alignments.length}`}
        </button>
      ) : null}
    </section>
  )
}

function AlignmentItem({
  alignment,
  onSelectBill,
}: {
  alignment: VoteAlignment
  onSelectBill?: (alignment: VoteAlignment) => void
}) {
  const consistent = alignment.points > 0
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectBill?.(alignment)}
          className="min-w-0 text-left"
          aria-label={`Open details for ${alignment.bill_title || alignment.bill_id}`}
        >
          <p className="font-mono text-[11px] text-slate-400">
            {alignment.bill_id}
            {alignment.vote_date ? ` · ${alignment.vote_date}` : ''}
          </p>
          <p className="text-sm font-medium leading-snug text-slate-100 hover:underline">
            {alignment.bill_title || 'Untitled bill'}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${positionBadgeClass(alignment.vote_position)}`}
          >
            {alignment.vote_position}
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 text-xs font-bold ${pointsBadgeClass(alignment.points)}`}
            aria-label={consistent ? 'Consistent, plus one' : 'Contradicts, minus one'}
          >
            {formatPoints(alignment.points)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-300">
        Voted <strong>{alignment.vote_position}</strong> on a bill that{' '}
        {effectPhrase(alignment.effect_direction, alignment.target_name, alignment.mechanism)};{' '}
        {consistent ? 'consistent: ' : 'contradicts: '}
        {wantsPhrase(alignment.stance_direction)}.
      </p>
      {alignment.stance_evidence_quote ? (
        <blockquote className="mt-2 rounded-r border-l-2 border-purple-500/60 bg-purple-950/30 py-1 pr-2 pl-2.5">
          <p className="text-[11px] italic text-purple-200">
            &ldquo;{alignment.stance_evidence_quote}&rdquo;
          </p>
        </blockquote>
      ) : null}
      {alignment.stance_source_url ? (
        <a
          href={alignment.stance_source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block break-all text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Source: {sourceLabel(alignment.stance_source_url)}
        </a>
      ) : null}
    </li>
  )
}
