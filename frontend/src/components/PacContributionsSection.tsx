import { ListFilter } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import {
  EXPLAINERS,
  PAC_CATEGORY_COLORS,
  formatCompactMoney,
  formatMoney,
  formatShare,
  pacParams,
  pacTotalGap,
} from '../campaignFinance'
import type { FinanceElection, PacSummary } from '../types'
import { Explainer, LegendSwatch, StackedBar, SubHeading } from './financeParts'
import PacExplorer from './PacExplorer'

export default function PacContributionsSection({
  officialId,
  election,
}: {
  officialId: string
  election: FinanceElection
}) {
  const [summary, setSummary] = useState<PacSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [explorerOpen, setExplorerOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setSummary(null)
    setError(null)
    setExplorerOpen(false)
    fetch(
      apiUrl(
        `/api/officials/${encodeURIComponent(officialId)}/finance/pacs?${pacParams(election)}`,
      ),
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load PAC contributions (${res.status})`)
        }
        return res.json() as Promise<PacSummary>
      })
      .then(setSummary)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load PAC contributions')
      })
    return () => controller.abort()
  }, [officialId, election])

  if (error) {
    return (
      <div>
        <SubHeading>PAC contributions</SubHeading>
        <p className="mt-1 text-xs text-rose-300">{error}</p>
      </div>
    )
  }
  if (!summary) {
    return (
      <div>
        <SubHeading>PAC contributions</SubHeading>
        <p className="mt-1 text-xs text-slate-400">Loading…</p>
      </div>
    )
  }
  if (!summary.synced) {
    return (
      <div>
        <SubHeading>PAC contributions</SubHeading>
        <p className="mt-1 text-xs text-slate-400">
          PAC details haven't been loaded for this member yet (fec_client.py pacs).
        </p>
      </div>
    )
  }
  if (summary.gift_count === 0) {
    return (
      <div>
        <SubHeading>PAC contributions</SubHeading>
        <p className="mt-1 text-xs text-slate-400">No PAC gifts were reported for this election.</p>
      </div>
    )
  }

  const gap = pacTotalGap(summary.total, summary.reported_total)
  const color = (key: string) => PAC_CATEGORY_COLORS[key] ?? PAC_CATEGORY_COLORS.other

  return (
    <div>
      <SubHeading>PAC contributions</SubHeading>
      <p className="mt-1 text-sm text-slate-200">
        <span className="font-semibold">{formatCompactMoney(summary.total)}</span> from{' '}
        {summary.pac_count} PACs and committees ({summary.gift_count} gifts)
      </p>
      {gap ? (
        <p className="mt-0.5 text-[11px] text-amber-300">
          FEC reports {formatMoney(summary.reported_total)} in PAC money through{' '}
          {summary.reported_through ?? 'its latest report'}, {formatShare(gap)} different from the
          itemized gifts here, which run through {summary.itemized_through ?? 'an earlier date'}.
          FEC takes a few weeks to process the gifts in a new report; this catches up on its own.
        </p>
      ) : null}

      <StackedBar
        label={summary.categories.map((c) => `${c.label} ${formatShare(c.share)}`).join(', ')}
        segments={summary.categories.map((category) => ({
          key: category.key,
          share: category.share ?? 0,
          color: color(category.key),
          title: `${category.label}: ${formatMoney(category.total)} (${formatShare(category.share)})`,
        }))}
      />
      <ul className="mt-2 space-y-0.5 text-xs">
        {summary.categories.map((category) => (
          <li key={category.key} className="flex items-center gap-2">
            <LegendSwatch color={color(category.key)} />
            <span className="min-w-0 flex-1 text-slate-300">
              {category.label}{' '}
              <span className="text-slate-500">· {category.pac_count}</span>
            </span>
            <span className="tabular-nums text-slate-400">{formatShare(category.share)}</span>
            <span className="w-20 text-right tabular-nums text-slate-200">
              {formatCompactMoney(category.total)}
            </span>
          </li>
        ))}
      </ul>

      <h5 className="mt-3 text-[11px] font-semibold text-slate-400">Top {summary.top_pacs.length}</h5>
      <ol className="mt-1 space-y-1 text-xs">
        {summary.top_pacs.map((pac, index) => (
          <li key={pac.pac_key} className="flex items-start gap-2">
            <span className="w-4 shrink-0 text-right tabular-nums text-slate-500">{index + 1}</span>
            <LegendSwatch color={color(pac.category)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-200" title={pac.name ?? undefined}>
                {pac.name}
              </span>
              <span className="text-[10px] text-slate-500">
                {pac.category_label} · {pac.gift_count} {pac.gift_count === 1 ? 'gift' : 'gifts'}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-200">{formatMoney(pac.total)}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setExplorerOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/10"
      >
        <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
        View all {summary.pac_count} PACs
      </button>
      <Explainer>{EXPLAINERS.pacs}</Explainer>

      {explorerOpen ? (
        <PacExplorer
          officialId={officialId}
          election={election}
          summary={summary}
          onClose={() => setExplorerOpen(false)}
        />
      ) : null}
    </div>
  )
}
