import { Info } from 'lucide-react'
import { useState, type ReactNode } from 'react'

// Building blocks shared by the campaign finance and PAC views.

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </h4>
  )
}

export function Explainer({
  label = 'What does this mean?',
  children,
}: {
  label?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 transition hover:text-emerald-300"
      >
        <Info className="h-3 w-3" aria-hidden="true" />
        {label}
      </button>
      {open ? <p className="mt-1 text-xs leading-relaxed text-slate-300">{children}</p> : null}
    </div>
  )
}

export interface BarSegment {
  key: string
  share: number
  color: string
  title: string
}

// One stacked bar with a 2px gap between segments; the legend beside it
// carries identity, and each segment's title is its hover tooltip.
export function StackedBar({ segments, label }: { segments: BarSegment[]; label: string }) {
  return (
    <div className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded" role="img" aria-label={label}>
      {segments.map((segment) => (
        <div
          key={segment.key}
          title={segment.title}
          className="h-full"
          style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }}
        />
      ))}
    </div>
  )
}

export function LegendSwatch({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  )
}
