import { Landmark } from 'lucide-react'

export default function WipLanding() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-8 py-16 text-center text-slate-100">
      <Landmark className="mb-6 h-14 w-14 text-blue-400" aria-hidden="true" />
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Politmus
      </h1>
      <p className="text-xl text-slate-400">Work in Progress</p>
    </div>
  )
}
