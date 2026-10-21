import { ChevronDown, ChevronRight, DollarSign } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiUrl } from '../api'
import {
  EXPLAINERS,
  FUNDING_MIX_COLORS,
  HOME_STATE_COLOR,
  OUT_OF_STATE_COLOR,
  defaultElection,
  electionKey,
  formatCompactMoney,
  formatMoney,
  formatShare,
  peerLines,
} from '../campaignFinance'
import type { FinanceElection, OfficialFinance, OutsideSpender, PeerComparison } from '../types'
import { Explainer, LegendSwatch, StackedBar, SubHeading } from './financeParts'
import PacContributionsSection from './PacContributionsSection'

// Preview of OpenFEC data (fec_client.py). Shown only to signed-in users in
// the dev explorer until there is a real design for it.

const SIZE_LABELS: Record<number, string> = {
  0: '$200 and under',
  200: '$200–499',
  500: '$500–999',
  1000: '$1,000–1,999',
  2000: '$2,000+',
}

export default function CampaignFinanceSection({ officialId }: { officialId: string }) {
  const [finance, setFinance] = useState<OfficialFinance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setFinance(null)
    setError(null)
    setSelectedKey(null)
    fetch(apiUrl(`/api/officials/${encodeURIComponent(officialId)}/finance`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load campaign finance (${res.status})`)
        }
        return res.json() as Promise<OfficialFinance>
      })
      .then(setFinance)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load campaign finance')
      })
    return () => controller.abort()
  }, [officialId])

  const elections = finance?.elections ?? []
  const selected =
    elections.find((election) => electionKey(election) === selectedKey) ??
    (finance ? defaultElection(finance) : null)
  const comparison = finance?.peer_comparison ?? null
  // Peer figures belong to one election; only show them on that one.
  const compared =
    selected &&
    comparison &&
    comparison.election_year === selected.election_year &&
    comparison.fec_candidate_id === selected.fec_candidate_id
      ? comparison
      : null
  const sharesYear = (year: number) => elections.filter((e) => e.election_year === year).length > 1

  return (
    <section
      className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4"
      aria-labelledby="campaign-finance-title"
    >
      <h3 id="campaign-finance-title">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="campaign-finance-body"
          className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300 transition hover:text-emerald-200"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          )}
          <DollarSign className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Campaign Finance (preview)
        </button>
      </h3>

      {open ? (
        <div id="campaign-finance-body">
          {error ? (
            <p className="mt-2 text-xs text-rose-300">{error}</p>
          ) : !finance ? (
            <p className="mt-2 text-xs text-slate-400">Loading…</p>
          ) : !selected ? (
            <p className="mt-2 text-xs text-slate-400">
              {finance.fec_candidate_ids.length === 0
                ? 'No FEC candidate ID. Run fec_client.py crosswalk.'
                : `No totals loaded yet. Run fec_client.py totals --official-id ${officialId}.`}
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Election">
                {elections.map((election) => {
                  const active = electionKey(election) === electionKey(selected)
                  return (
                    <button
                      key={electionKey(election)}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedKey(electionKey(election))}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                        active
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                          : 'border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {election.election_year}
                      {sharesYear(election.election_year) ? ` · ${election.fec_candidate_id}` : ''}
                    </button>
                  )
                })}
              </div>
              <ElectionView officialId={officialId} election={selected} comparison={compared} />
            </>
          )}

          {finance ? (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="text-[11px] text-slate-500">
                Source: {finance.source}
                {finance.opensecrets_url ? (
                  <>
                    {' · '}
                    <a
                      href={finance.opensecrets_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      OpenSecrets
                    </a>
                  </>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 transition hover:text-emerald-300"
              >
                {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
              </button>
              {showRaw ? (
                <pre className="mt-2 max-h-72 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-emerald-200">
                  {JSON.stringify(finance, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ElectionView({
  officialId,
  election,
  comparison,
}: {
  officialId: string
  election: FinanceElection
  comparison: PeerComparison | null
}) {
  const peers = (key: string) =>
    comparison
      ? peerLines(
          comparison.metrics.find((metric) => metric.key === key),
          comparison,
        )
      : []
  const inProgress = election.election_year >= new Date().getFullYear()

  return (
    <div className="mt-3 space-y-5">
      <div>
        <p className="text-[11px] text-slate-500">
          {inProgress ? 'Race in progress · ' : ''}
          {election.coverage_start_date ?? '?'} → {election.coverage_end_date ?? '?'} ·{' '}
          <a
            href={election.fec_url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-emerald-400 hover:text-emerald-300"
          >
            {election.fec_candidate_id}
          </a>
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <StatTile
            label="Raised"
            value={formatCompactMoney(election.receipts)}
            peers={peers('receipts')}
          />
          <StatTile
            label="From small donors"
            value={formatShare(election.small_donor_share)}
            peers={peers('small_donor_share')}
          />
          <StatTile
            label={`From ${election.home_state ?? 'home state'}`}
            value={formatShare(election.in_state_share)}
            peers={peers('in_state_share')}
          />
        </div>
        {comparison ? (
          <Explainer label="How are these compared?">{EXPLAINERS.peers}</Explainer>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">
            {inProgress
              ? 'Comparisons with other members use finished elections; pick an earlier year to see them.'
              : 'Comparisons with other members are shown for the most recent finished election.'}
          </p>
        )}
      </div>

      <FundingMix election={election} />
      <PacContributionsSection officialId={officialId} election={election} />
      <HomeState election={election} />
      <OutsideSpendingView election={election} />
      <SpendingAndSizes election={election} />
    </div>
  )
}

function StatTile({ label, value, peers }: { label: string; value: string; peers: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {peers.map((line) => (
        <p key={line} className="text-[10px] leading-tight text-slate-400">
          {line}
        </p>
      ))}
    </div>
  )
}

function FundingMix({ election }: { election: FinanceElection }) {
  const slices = (election.funding_mix ?? []).filter((slice) => slice.amount > 0)
  if (slices.length === 0) {
    return null
  }
  const color = (key: string) => FUNDING_MIX_COLORS[key] ?? FUNDING_MIX_COLORS.other
  return (
    <div>
      <SubHeading>Where the money came from</SubHeading>
      <StackedBar
        label={slices.map((slice) => `${slice.label} ${formatShare(slice.share)}`).join(', ')}
        segments={slices.map((slice) => ({
          key: slice.key,
          share: slice.share ?? 0,
          color: color(slice.key),
          title: `${slice.label}: ${formatMoney(slice.amount)} (${formatShare(slice.share)})`,
        }))}
      />
      <ul className="mt-2 space-y-0.5 text-xs">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2">
            <LegendSwatch color={color(slice.key)} />
            <span className="min-w-0 flex-1 text-slate-300">{slice.label}</span>
            <span className="tabular-nums text-slate-400">{formatShare(slice.share)}</span>
            <span className="w-24 text-right tabular-nums text-slate-200">
              {formatMoney(slice.amount)}
            </span>
          </li>
        ))}
      </ul>
      <Explainer>{EXPLAINERS.fundingMix}</Explainer>
    </div>
  )
}

function HomeState({ election }: { election: FinanceElection }) {
  const share = election.in_state_share
  if (share == null) {
    return null
  }
  const home = election.home_state ?? 'their home state'
  const outOfState = (election.top_states ?? []).filter((state) => state.state !== election.home_state)
  return (
    <div>
      <SubHeading>Home state vs. out of state</SubHeading>
      <p className="mt-1 text-sm text-slate-200">
        <span className="font-semibold">{formatShare(share)}</span> of itemized individual money
        came from {home}; <span className="font-semibold">{formatShare(1 - share)}</span> came from
        out of state.
      </p>
      <StackedBar
        label={`${home} ${formatShare(share)}, out of state ${formatShare(1 - share)}`}
        segments={[
          { key: 'home', share, color: HOME_STATE_COLOR, title: `${home}: ${formatShare(share)}` },
          {
            key: 'out',
            share: 1 - share,
            color: OUT_OF_STATE_COLOR,
            title: `Out of state: ${formatShare(1 - share)}`,
          },
        ]}
      />
      <div className="mt-1.5 flex gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <LegendSwatch color={HOME_STATE_COLOR} />
          {home}
        </span>
        <span className="flex items-center gap-1.5">
          <LegendSwatch color={OUT_OF_STATE_COLOR} />
          Out of state
        </span>
      </div>
      {outOfState.length > 0 ? (
        <p className="mt-2 text-xs text-slate-300">
          Biggest out-of-state sources:{' '}
          {outOfState.map((state) => `${state.state} ${formatCompactMoney(state.total)}`).join(' · ')}
        </p>
      ) : null}
      <Explainer>{EXPLAINERS.homeState}</Explainer>
    </div>
  )
}

function OutsideSpendingView({ election }: { election: FinanceElection }) {
  const outside = election.outside_spending
  if (!outside) {
    return null
  }
  const none = outside.support_total === 0 && outside.oppose_total === 0
  return (
    <div>
      <SubHeading>Outside spending</SubHeading>
      {none ? (
        <p className="mt-1 text-xs text-slate-400">
          No outside spending was reported for or against this candidate in this election.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-400">
            Spent by independent groups, separate from the {formatCompactMoney(election.receipts)}{' '}
            the campaign raised.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SpendingSide
              title="Supporting"
              total={outside.support_total}
              count={outside.support_count}
              spenders={outside.top_support}
            />
            <SpendingSide
              title="Opposing"
              total={outside.oppose_total}
              count={outside.oppose_count}
              spenders={outside.top_oppose}
            />
          </div>
        </>
      )}
      <Explainer>{EXPLAINERS.outsideSpending}</Explainer>
    </div>
  )
}

function SpendingSide({
  title,
  total,
  count,
  spenders,
}: {
  title: string
  total: number
  count: number
  spenders: OutsideSpender[]
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <p className="text-[11px] text-slate-400">{title}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-100">
        {formatCompactMoney(total)}
      </p>
      <p className="text-[10px] text-slate-500">
        {count} {count === 1 ? 'group' : 'groups'}
      </p>
      {spenders.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-[11px]">
          {spenders.map((spender) => (
            <li
              key={spender.committee_id ?? spender.name}
              className="flex justify-between gap-2"
            >
              <span className="min-w-0 truncate text-slate-300" title={spender.name ?? undefined}>
                {spender.name}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {formatCompactMoney(spender.total)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function SpendingAndSizes({ election }: { election: FinanceElection }) {
  const sizes = election.size_breakdown ?? []
  const sizeTotal = sizes.reduce((sum, bucket) => sum + bucket.total, 0)
  const rows: [string, number | null | undefined][] = [
    ['Spent', election.disbursements],
    ['Cash on hand', election.cash_on_hand],
    ['Debts', election.debts],
  ]
  return (
    <div>
      <SubHeading>Spending and cash</SubHeading>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-right tabular-nums text-slate-200">{formatMoney(value)}</dd>
          </div>
        ))}
      </dl>

      {sizes.length > 0 ? (
        <div className="mt-4">
          <SubHeading>Individual gifts by size</SubHeading>
          <ul className="mt-1 space-y-1">
            {sizes.map((bucket) => (
              <li key={bucket.size} className="text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>{SIZE_LABELS[bucket.size] ?? `$${bucket.size}+`}</span>
                  <span className="tabular-nums">{formatMoney(bucket.total)}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-slate-800">
                  <div
                    className="h-1.5 rounded"
                    style={{
                      width: `${sizeTotal ? (bucket.total / sizeTotal) * 100 : 0}%`,
                      backgroundColor: FUNDING_MIX_COLORS.small_donors,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
