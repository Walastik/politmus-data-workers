import { SignUpButton } from '@clerk/clerk-react'
import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Globe,
  Landmark,
  MapPin,
  Phone,
  Radio,
  Scale,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react'

import LocationPicker from '../components/LocationPicker'
import AsciiAnimation from './AsciiAnimation'

// ─── Fold 1 · Hero ────────────────────────────────────────────────────────────

function HeroSection({ onScroll }: { onScroll: () => void }) {
  const navigate = useNavigate()
  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center bg-slate-900 px-6 py-24 text-center">
      {/* subtle radial glow behind the ASCII art */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 40%, rgba(59,130,246,0.25), transparent)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <AsciiAnimation />

        <h1 className="mb-4 text-5xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl">
          Politmus
        </h1>

        <p className="mx-auto max-w-xl text-lg leading-relaxed text-slate-300 sm:text-xl">
          Hold your representatives accountable. Politmus grades politicians on
          how they actually vote — so you can see if they keep their promises.
        </p>

        <div className="mt-10 w-full max-w-2xl text-left">
          <p className="mb-2 text-center text-sm font-semibold text-slate-200">See who represents you</p>
          <LocationPicker submitLabel="Find my reps" onDone={() => navigate('/reps')} />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/now"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
          >
            <Radio className="h-4 w-4 text-emerald-400" />
            What’s happening near me
          </Link>
          <Link
            to="/congress"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
          >
            <Landmark className="h-4 w-4 text-blue-400" />
            Browse Congress
          </Link>
          <button
            type="button"
            onClick={onScroll}
            className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white"
          >
            How it works
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onScroll}
        aria-label="Scroll down"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-slate-500 transition hover:text-slate-300"
      >
        <ChevronDown className="h-7 w-7" />
      </button>
    </section>
  )
}

// ─── Fold 2 · Accountability Grading ──────────────────────────────────────────

function GradingSection() {
  return (
    <section className="bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-950/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-300">
            <Scale className="h-3.5 w-3.5" />
            Accountability Engine
          </span>

          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Says vs. Votes
          </h2>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Politicians promise a lot on their campaign websites. Politmus uses
            AI to extract their stated positions, then compares those promises
            against their actual roll-call votes in Congress. The result is a
            transparent score that shows whether they walk the talk.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <GradingStep
            step="1"
            title="Extract Positions"
            description="We crawl each legislator's official website and use AI to identify their stated policy positions — what they claim to support or oppose."
            icon={<Sparkles className="h-5 w-5 text-purple-400" />}
          />
          <GradingStep
            step="2"
            title="Track Votes"
            description="Every roll-call vote in Congress is ingested and matched to the policy areas that the legislator has spoken on."
            icon={<ScrollText className="h-5 w-5 text-blue-400" />}
          />
          <GradingStep
            step="3"
            title="Score & Compare"
            description="Votes are compared to stated positions: aligned votes earn +1, contradictions earn −1. The result is a clear, auditable accountability score."
            icon={<Scale className="h-5 w-5 text-emerald-400" />}
          />
        </div>

        {/* example mock card */}
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-700 bg-slate-800/60 p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Example
              </p>
              <p className="mt-1 text-lg font-bold text-white">
                Sen. Jane Doe
              </p>
              <p className="text-xs text-slate-400">
                Senator · Texas · Democrat
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-extrabold text-emerald-400">+12</p>
              <p className="text-xs text-slate-400">Politmus Score</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded border border-emerald-700/60 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              Healthcare +4
            </span>
            <span className="rounded border border-emerald-700/60 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              Education +3
            </span>
            <span className="rounded border border-rose-700/60 bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
              Defense −2
            </span>
            <span className="rounded border border-emerald-700/60 bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              Environment +7
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            14 votes aligned · 2 contradicted · across 16 scored bills
          </p>
        </div>
      </div>
    </section>
  )
}

function GradingStep({
  step,
  title,
  description,
  icon,
}: {
  step: string
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
          {step}
        </span>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        {description}
      </p>
    </div>
  )
}

// ─── Fold 3 · Address Lookup ──────────────────────────────────────────────────

function LookupSection() {
  const navigate = useNavigate()

  return (
    <section className="bg-slate-900 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
            <MapPin className="h-3.5 w-3.5" />
            Find Your Reps
          </span>

          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Who Represents You?
          </h2>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Enter your address and instantly see who represents you in Congress
            and your state legislature, with their Politmus Score. Phone numbers,
            office addresses, and websites included.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-2xl">
          <LocationPicker submitLabel="Find my reps" onDone={() => navigate('/reps')} />
        </div>

        {/* feature preview cards */}
        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <FeatureCard
            icon={<Users className="h-5 w-5 text-blue-400" />}
            title="Federal & State"
            description="See senators, house members, your governor, and state legislators — all in one lookup."
          />
          <FeatureCard
            icon={<MapPin className="h-5 w-5 text-emerald-400" />}
            title="Geolocation"
            description="Don't know your exact address? Hit 'Use my location' and we'll find your districts automatically."
          />
          <FeatureCard
            icon={<Phone className="h-5 w-5 text-amber-400" />}
            title="Contact Info"
            description="Every result includes phone numbers, office addresses, and links to official websites."
          />
        </div>
      </div>
    </section>
  )
}

// ─── Fold 4 · Bill Summaries & ELI5 ──────────────────────────────────────────

function BillsSection() {
  return (
    <section className="bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <BookOpen className="h-3.5 w-3.5" />
            Legislation Feed
          </span>

          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Understand Every Bill
          </h2>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Congressional bills are dense. Politmus gives you AI-generated TL;DR
            summaries and "Explain Like I'm 5" breakdowns so you know what's
            actually being voted on — without the legal jargon.
          </p>
        </div>

        {/* example bill card */}
        <div className="mx-auto mt-14 max-w-2xl space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-xs text-slate-400">H.R. 1234</p>
              <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                Became Law
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold text-white">
              Clean Water Infrastructure Investment Act of 2025
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-blue-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                Environment
              </span>
              <span className="rounded-full bg-violet-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                Bipartisan D/R
              </span>
            </div>

            {/* TL;DR */}
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-purple-300 border border-purple-500/30">
                  TL;DR
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Quick Summary
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                Allocates $12B for upgrading aging water treatment plants and
                expanding access to clean drinking water in underserved
                communities.
              </p>
            </div>

            {/* ELI5 */}
            <div className="mt-2.5 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/30">
                  ELI5
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Explain Like I'm 5
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                The government is spending money to fix old pipes and water
                cleaning machines so everyone can have safe water to drink.
              </p>
            </div>

            {/* AI classification pills */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-800/70 bg-purple-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                <Sparkles className="h-2.5 w-2.5 text-purple-400" />
                AI Classified (3)
              </span>
            </div>
          </div>

          <p className="text-center text-sm text-slate-500">
            Every bill includes CRS summaries, vote tallies broken down by
            party, roll-call details, and AI policy classifications.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Fold 5 · Politician Profiles ─────────────────────────────────────────────

function ProfilesSection() {
  const navigate = useNavigate()

  return (
    <section className="bg-slate-900 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-950/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-rose-300">
            <Users className="h-3.5 w-3.5" />
            Politician Profiles
          </span>

          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Dig Into the Details
          </h2>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Click any politician to open their full profile. See contact info,
            their complete voting record, stated positions extracted from their
            website, and how every vote aligns with what they promised.
          </p>
        </div>

        {/* example profile mock */}
        <div className="mx-auto mt-14 max-w-md">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-900/60 px-2 py-0.5 text-xs font-bold text-blue-300">
                D
              </span>
              <span className="text-xs text-slate-400">California</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Active
              </span>
            </div>
            <h3 className="mt-2 text-xl font-semibold text-white">
              Rep. Alex Rivera
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Representative · District 12
            </p>

            {/* contact section */}
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <Phone className="h-4 w-4 text-slate-500" />
                <span>(202) 555-0142</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <MapPin className="h-4 w-4 text-slate-500" />
                <span>1234 Longworth HOB, Washington, DC 20515</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Globe className="h-4 w-4 text-slate-500" />
                <span className="text-blue-400">rivera.house.gov</span>
              </div>
            </div>

            {/* voting record teaser */}
            <div className="mt-5 border-t border-slate-700 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Recent Votes
              </p>
              <ul className="mt-2 space-y-1.5">
                <VoteTeaser billId="H.R. 1234" title="Clean Water Investment Act" position="Yes" />
                <VoteTeaser billId="S. 567" title="National AI Safety Standards" position="Yes" />
                <VoteTeaser billId="H.R. 890" title="Tax Reform Amendment" position="No" />
              </ul>
            </div>

            {/* positions teaser */}
            <div className="mt-5 border-t border-slate-700 pt-4">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <p className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                  AI Stated Positions (12)
                </p>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Supports increased education funding, opposes cuts to
                environmental regulation, wants expanded healthcare access…
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/congress')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
          >
            Browse Congress
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

function VoteTeaser({
  billId,
  title,
  position,
}: {
  billId: string
  title: string
  position: string
}) {
  const badgeClass =
    position === 'Yes'
      ? 'bg-emerald-900/60 text-emerald-300'
      : 'bg-red-900/60 text-red-300'

  return (
    <li className="flex items-center justify-between text-xs">
      <span className="truncate text-slate-300">
        <span className="font-mono text-slate-500">{billId}</span>{' '}
        {title}
      </span>
      <span className={`ml-2 shrink-0 rounded px-2 py-0.5 font-bold ${badgeClass}`}>
        {position}
      </span>
    </li>
  )
}

// ─── Fold 6 · Sign up ─────────────────────────────────────────────────────────

function SignUpSection() {
  return (
    <section className="bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-3xl rounded-2xl border border-blue-900/60 bg-blue-950/20 p-8 text-center sm:p-12">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">Make it yours</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-400">
          Everything on Politmus is free to browse. A free account remembers your address, so every visit
          opens on what matters to you.
        </p>
        <ul className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm text-slate-300">
          {[
            'Open straight to your election: voting sites, dates and your ballot',
            'Your representatives and their scores, one click away',
            'The latest bills and votes from Congress in your feed',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <SignUpButton mode="modal">
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
            >
              Create a free account
            </button>
          </SignUpButton>
          <Link to="/now" className="px-4 py-3 text-sm font-semibold text-slate-300 hover:text-white">
            Keep browsing
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
      <div className="mb-2">{icon}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">
        {description}
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Landing() {
  const secondFold = useRef<HTMLDivElement>(null)

  const scrollToContent = () => {
    secondFold.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="bg-slate-900 text-slate-100">
      <HeroSection onScroll={scrollToContent} />
      <div ref={secondFold}>
        <GradingSection />
      </div>
      <LookupSection />
      <BillsSection />
      <ProfilesSection />
      <SignUpSection />

      {/* footer */}
      <footer className="border-t border-slate-800 bg-slate-950 px-6 py-10 text-center text-xs text-slate-500">
        <p>
          Politmus — open data, transparent scoring. Built with public
          congressional data from Congress.gov, Google Civic Information API,
          and OpenStates.
        </p>
      </footer>
    </div>
  )
}
