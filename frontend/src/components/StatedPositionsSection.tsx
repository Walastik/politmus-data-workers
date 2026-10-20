import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  DIRECTION_LABELS,
  INITIAL_POSITIONS_SHOWN,
  groupPositions,
  positionsStatusMessage,
  sourceLabel,
  stanceLine,
} from '../positions'
import {
  directionBadgeClass,
  mechanismBadgeClass,
  type OfficialStance,
  type PositionsSync,
} from '../types'

export default function StatedPositionsSection({
  positions,
  sync,
}: {
  positions: OfficialStance[]
  sync: PositionsSync | null
}) {
  const [showAll, setShowAll] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [open, setOpen] = useState(false)

  // Display order, so "Show fewer" cuts at the same place the list reads.
  const ordered = useMemo(
    () =>
      groupPositions(positions).flatMap((group) =>
        group.blocks.flatMap((block) => block.positions),
      ),
    [positions],
  )
  const visibleGroups = useMemo(
    () => groupPositions(showAll ? ordered : ordered.slice(0, INITIAL_POSITIONS_SHOWN)),
    [ordered, showAll],
  )
  const models = useMemo(
    () => Array.from(new Set(positions.map((p) => p.model).filter(Boolean))) as string[],
    [positions],
  )
  const statusMessage = positionsStatusMessage(sync)

  return (
    <section
      className="mb-6 rounded-xl border border-purple-500/30 bg-purple-950/10 p-4"
      aria-labelledby="stated-positions-title"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="stated-positions-title">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="stated-positions-body"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-300 transition hover:text-purple-200"
          >
            {open ? (
              <ChevronDown className="h-4 w-4 text-purple-400" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 text-purple-400" aria-hidden="true" />
            )}
            <Sparkles className="h-4 w-4 text-purple-400" aria-hidden="true" />
            Stated Positions (AI)
          </button>
        </h3>
        {models.length > 0 ? (
          <span className="rounded bg-purple-900/50 px-1.5 py-0.5 text-[10px] font-mono font-medium text-purple-300">
            {models.join(', ')}
          </span>
        ) : null}
      </div>

      {open ? (
        <div id="stated-positions-body">
          <p
            className={`mt-2 text-xs ${sync?.status === 'failed' ? 'text-rose-300' : 'text-slate-400'}`}
            title={sync?.status === 'failed' ? (sync.last_error ?? undefined) : undefined}
          >
            {statusMessage}
          </p>

          {ordered.length > 0 ? (
            <div className="mt-3 space-y-4">
              {visibleGroups.map((group) => (
                <div key={group.area}>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.area}
                  </h4>
                  <div className="mt-2 space-y-2.5">
                    {group.blocks.map((block, idx) =>
                      block.positions.length > 1 ? (
                        <SharedEvidenceBlock key={idx} positions={block.positions} />
                      ) : (
                        <ul key={idx}>
                          <PositionItem position={block.positions[0]} />
                        </ul>
                      ),
                    )}
                  </div>
                </div>
              ))}

              {ordered.length > INITIAL_POSITIONS_SHOWN ? (
                <button
                  type="button"
                  onClick={() => setShowAll(!showAll)}
                  className="text-xs font-medium text-purple-300 hover:text-purple-200"
                >
                  {showAll ? 'Show fewer' : `Show all ${ordered.length}`}
                </button>
              ) : null}

              <div>
                <button
                  type="button"
                  onClick={() => setShowRaw(!showRaw)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-400 transition hover:text-purple-300"
                >
                  {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
                </button>
                {showRaw ? (
                  <pre className="mt-2 max-h-52 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-purple-200">
                    {JSON.stringify({ positions_sync: sync, stated_positions: positions }, null, 2)}
                  </pre>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

// Several positions drawn from one passage: the quote and source once, then the
// positions as compact items.
function SharedEvidenceBlock({ positions }: { positions: OfficialStance[] }) {
  const [first] = positions
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3 shadow-inner">
      <EvidenceQuote quote={first.evidence_quote} />
      <SourceLine sourceUrl={first.source_url} />
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Supports {positions.length} positions
      </p>
      <ul className="mt-2 space-y-2 border-l border-slate-800 pl-3">
        {positions.map((position, idx) => (
          <PositionItem
            key={`${position.target_name}-${position.mechanism}-${idx}`}
            position={position}
            compact
          />
        ))}
      </ul>
    </div>
  )
}

function PositionItem({
  position,
  compact = false,
}: {
  position: OfficialStance
  compact?: boolean
}) {
  const line = stanceLine(position)
  const direction = position.direction?.toLowerCase()
  return (
    <li
      className={
        compact ? '' : 'rounded-lg border border-slate-800 bg-slate-900/90 p-3 shadow-inner'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-sm font-semibold text-slate-100">
          {position.target_name || 'Unnamed target'}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${directionBadgeClass(
              direction,
            )}`}
          >
            wants {DIRECTION_LABELS[direction] ?? direction}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${mechanismBadgeClass(
              position.mechanism,
            )}`}
          >
            {position.mechanism}
          </span>
          {position.emphasis ? (
            <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">
              {position.emphasis}
            </span>
          ) : null}
        </div>
      </div>
      {line ? <p className="mt-1 text-[11px] text-slate-400">{line}</p> : null}
      {position.summary ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{position.summary}</p>
      ) : null}
      {compact ? (
        position.issue_label ? (
          <p className="mt-1 text-[11px] text-slate-500">{position.issue_label}</p>
        ) : null
      ) : (
        <>
          <EvidenceQuote quote={position.evidence_quote} />
          <SourceLine sourceUrl={position.source_url} issueLabel={position.issue_label} />
        </>
      )}
    </li>
  )
}

function EvidenceQuote({ quote }: { quote: string | null }) {
  return quote ? (
    <blockquote className="mt-2 rounded-r border-l-2 border-purple-500/60 bg-purple-950/30 py-1 pr-2 pl-2.5">
      <p className="text-[11px] italic text-purple-200">&ldquo;{quote}&rdquo;</p>
    </blockquote>
  ) : null
}

function SourceLine({
  sourceUrl,
  issueLabel,
}: {
  sourceUrl: string | null
  issueLabel?: string | null
}) {
  return sourceUrl || issueLabel ? (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
      {issueLabel ? <span>{issueLabel}</span> : null}
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 break-all text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
        >
          Source: {sourceLabel(sourceUrl)}
        </a>
      ) : null}
    </p>
  ) : null
}
