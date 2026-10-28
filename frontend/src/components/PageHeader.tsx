import type { ReactNode } from 'react'

// The title block at the top of each page in the app shell.
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

// Page body width and padding inside the shell.
export function PageContainer({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main className={`mx-auto ${narrow ? 'max-w-4xl' : 'max-w-6xl'} px-4 py-6 sm:px-6 sm:py-8`}>{children}</main>
  )
}
