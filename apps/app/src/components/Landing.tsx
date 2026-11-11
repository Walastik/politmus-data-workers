import { router } from 'expo-router'
import { useRef, type ComponentRef, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import AsciiArt from './AsciiArt'
import { Icons } from './icons'
import { LegalLinks } from './Legal'
import { LocationPicker } from './LocationBar'
import SignUpLink from './SignUpLink'

// What Politmus is, for signed-out visitors; native counterpart of the web
// Landing page (served at HOME_PATH).
export default function Landing() {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const secondFold = useRef(0)
  const scrollToContent = () => scroll.current?.scrollTo({ y: secondFold.current, animated: true })

  return (
    <ScrollView ref={scroll} className="flex-1 bg-slate-900" keyboardShouldPersistTaps="handled">
      <Hero onScroll={scrollToContent} />
      <View onLayout={(event) => (secondFold.current = event.nativeEvent.layout.y)}>
        <Grading />
      </View>
      <Lookup />
      <Bills />
      <Profiles />
      <SignUp />
      <View className="border-t border-slate-800 bg-slate-950 px-6 py-10">
        <Text className="font-sans text-center text-xs text-slate-500">
          Politmus: open data, transparent scoring. Built with public congressional data from Congress.gov, Google Civic
          Information API, and OpenStates.
        </Text>
        <LegalLinks className="mt-4" />
      </View>
    </ScrollView>
  )
}

function Hero({ onScroll }: { onScroll: () => void }) {
  return (
    <View className="items-center bg-slate-900 px-6 py-20">
      <AsciiArt />
      <Text accessibilityRole="header" className="mb-4 text-5xl font-display tracking-tight text-white md:text-6xl">
        Politmus
      </Text>
      <Text className="font-sans max-w-xl text-center text-lg leading-relaxed text-slate-300">
        Hold your representatives accountable. Politmus grades politicians on how they actually vote, so you can see if
        they keep their promises.
      </Text>
      <View className="mt-10 w-full max-w-2xl">
        <Text className="mb-2 text-center text-sm font-sans-semibold text-slate-200">See who represents you</Text>
        <Picker />
      </View>
      <View className="mt-8 flex-row flex-wrap items-center justify-center gap-3">
        <Button label="What’s happening near me" icon={<Icons.Radio size={16} colorClassName="accent-emerald-400" />} onPress={() => router.navigate('/now')} />
        <Button label="Browse Congress" icon={<Icons.Landmark size={16} colorClassName="accent-blue-400" />} onPress={() => router.navigate('/congress')} />
        <Pressable onPress={onScroll} accessibilityRole="button" className="flex-row items-center gap-2 px-3 py-2.5">
          <Text className="text-sm font-sans-semibold text-slate-300">How it works</Text>
          <Icons.ArrowRight size={16} colorClassName="accent-slate-300" />
        </Pressable>
      </View>
      <Pressable onPress={onScroll} accessibilityRole="button" accessibilityLabel="Scroll down" className="mt-10">
        <Icons.ChevronDown size={28} colorClassName="accent-slate-500" />
      </Pressable>
    </View>
  )
}

// The address box; once a place is set, go see who represents it.
function Picker() {
  return <LocationPicker submitLabel="Find my reps" onDone={() => router.navigate('/reps')} />
}

function Button({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" className="flex-row items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-5 py-2.5 active:border-slate-500">
      {icon}
      <Text className="text-sm font-sans-semibold text-slate-100">{label}</Text>
    </Pressable>
  )
}

function Fold({ dark, children }: { dark: boolean; children: ReactNode }) {
  return (
    <View className={`px-6 py-20 ${dark ? 'bg-slate-950' : 'bg-slate-900'}`}>
      <View className="w-full max-w-5xl self-center">{children}</View>
    </View>
  )
}

function FoldHeading({ badge, badgeClass, icon, title, children }: { badge: string; badgeClass: string; icon: ReactNode; title: string; children: string }) {
  return (
    <View className="items-center">
      <View className={`mb-4 flex-row items-center gap-2 rounded-full border px-4 py-1.5 ${badgeClass}`}>
        {icon}
        <Text className={`text-xs font-sans-semibold uppercase tracking-wider ${badgeClass}`}>{badge}</Text>
      </View>
      <Text accessibilityRole="header" className="text-center text-3xl font-display text-white md:text-4xl">
        {title}
      </Text>
      <Text className="font-sans mt-4 max-w-2xl text-center text-base leading-relaxed text-slate-400">{children}</Text>
    </View>
  )
}

function Card({ icon, title, children, step }: { icon: ReactNode; title: string; children: string; step?: string }) {
  return (
    <View className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-6">
      <View className="mb-3 flex-row items-center gap-3">
        {step ? (
          <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-800">
            <Text className="text-xs font-sans-bold text-slate-300">{step}</Text>
          </View>
        ) : null}
        {icon}
      </View>
      <Text className="text-lg font-display-semibold text-white">{title}</Text>
      <Text className="font-sans mt-2 text-sm leading-relaxed text-slate-400">{children}</Text>
    </View>
  )
}

function Chip({ className, children }: { className: string; children: string }) {
  return <Text className={`rounded border px-2 py-0.5 text-[11px] font-sans-semibold ${className}`}>{children}</Text>
}

function Grading() {
  return (
    <Fold dark>
      <FoldHeading
        badge="Accountability Engine"
        badgeClass="border-blue-500/30 bg-blue-950/50 text-blue-300"
        icon={<Icons.Scale size={14} colorClassName="accent-blue-300" />}
        title="Says vs. Votes"
      >
        Politicians promise a lot on their campaign websites. Politmus uses AI to extract their stated positions, then
        compares those promises against their actual roll-call votes in Congress. The result is a transparent score that
        shows whether they walk the talk.
      </FoldHeading>
      <View className="mt-16 gap-6 md:flex-row">
        <Card step="1" title="Extract Positions" icon={<Icons.Sparkles size={20} colorClassName="accent-purple-400" />}>
          We crawl each legislator's official website and use AI to identify their stated policy positions: what they claim
          to support or oppose.
        </Card>
        <Card step="2" title="Track Votes" icon={<Icons.ScrollText size={20} colorClassName="accent-blue-400" />}>
          Every roll-call vote in Congress is ingested and matched to the policy areas that the legislator has spoken on.
        </Card>
        <Card step="3" title="Score & Compare" icon={<Icons.Scale size={20} colorClassName="accent-emerald-400" />}>
          Votes are compared to stated positions: aligned votes earn +1, contradictions earn −1. The result is a clear,
          auditable accountability score.
        </Card>
      </View>
      <View className="mt-16 w-full max-w-md self-center rounded-xl border border-slate-700 bg-slate-800/60 p-6">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-sans-semibold uppercase tracking-wider text-slate-500">Example</Text>
            <Text className="mt-1 text-lg font-display text-white">Sen. Jane Doe</Text>
            <Text className="font-sans text-xs text-slate-400">Senator · Texas · Democrat</Text>
          </View>
          <View className="items-end">
            <Text className="text-3xl font-display text-emerald-400">+12</Text>
            <Text className="font-sans text-xs text-slate-400">Politmus Score</Text>
          </View>
        </View>
        <View className="mt-4 flex-row flex-wrap gap-2">
          <Chip className="border-emerald-700/60 bg-emerald-950/60 text-emerald-300">Healthcare +4</Chip>
          <Chip className="border-emerald-700/60 bg-emerald-950/60 text-emerald-300">Education +3</Chip>
          <Chip className="border-rose-700/60 bg-rose-950/60 text-rose-300">Defense −2</Chip>
          <Chip className="border-emerald-700/60 bg-emerald-950/60 text-emerald-300">Environment +7</Chip>
        </View>
        <Text className="font-sans mt-3 text-xs text-slate-400">14 votes aligned · 2 contradicted · across 16 scored bills</Text>
      </View>
    </Fold>
  )
}

function Lookup() {
  return (
    <Fold dark={false}>
      <FoldHeading
        badge="Find Your Reps"
        badgeClass="border-emerald-500/30 bg-emerald-950/50 text-emerald-300"
        icon={<Icons.MapPin size={14} colorClassName="accent-emerald-300" />}
        title="Who Represents You?"
      >
        Enter your address and instantly see who represents you in Congress and your state legislature, with their
        Politmus Score. Phone numbers, office addresses, and websites included.
      </FoldHeading>
      <View className="mt-12 w-full max-w-2xl self-center">
        <Picker />
      </View>
      <View className="mt-14 gap-6 md:flex-row">
        <Card title="Federal & State" icon={<Icons.Users size={20} colorClassName="accent-blue-400" />}>
          See senators, house members, your governor, and state legislators, all in one lookup.
        </Card>
        <Card title="Geolocation" icon={<Icons.MapPin size={20} colorClassName="accent-emerald-400" />}>
          Don't know your exact address? Hit 'Use my location' and we'll find your districts automatically.
        </Card>
        <Card title="Contact Info" icon={<Icons.Phone size={20} colorClassName="accent-amber-400" />}>
          Every result includes phone numbers, office addresses, and links to official websites.
        </Card>
      </View>
    </Fold>
  )
}

function ExplainerBox({ tag, tagClass, title, children }: { tag: string; tagClass: string; title: string; children: string }) {
  return (
    <View className="mt-3 rounded-lg border border-slate-700 bg-slate-900/80 p-3">
      <View className="flex-row items-center gap-1.5">
        <Text className={`rounded border bg-slate-800 px-1.5 py-0.5 font-mono-semibold text-[10px] ${tagClass}`}>{tag}</Text>
        <Text className="text-xs font-sans-semibold uppercase tracking-wider text-slate-300">{title}</Text>
      </View>
      <Text className="font-sans mt-1.5 text-xs leading-relaxed text-slate-200">{children}</Text>
    </View>
  )
}

function Bills() {
  return (
    <Fold dark>
      <FoldHeading
        badge="Legislation Feed"
        badgeClass="border-amber-500/30 bg-amber-950/50 text-amber-300"
        icon={<Icons.BookOpen size={14} colorClassName="accent-amber-300" />}
        title="Understand Every Bill"
      >
        Congressional bills are dense. Politmus gives you AI-generated TL;DR summaries and "Explain Like I'm 5" breakdowns
        so you know what's actually being voted on, without the legal jargon.
      </FoldHeading>
      <View className="mt-14 w-full max-w-2xl gap-4 self-center">
        <View className="rounded-xl border border-slate-700 bg-slate-800/60 p-6">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="font-mono text-xs text-slate-400">H.R. 1234</Text>
            <Text className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-[10px] font-sans-semibold uppercase tracking-wider text-emerald-300">
              Became Law
            </Text>
          </View>
          <Text className="mt-2 text-base font-sans-semibold text-white">Clean Water Infrastructure Investment Act of 2025</Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Text className="rounded-full bg-blue-900/50 px-2 py-0.5 text-[10px] font-sans-semibold uppercase tracking-wider text-blue-300">Environment</Text>
            <Text className="rounded-full bg-violet-900/50 px-2 py-0.5 text-[10px] font-sans-semibold uppercase tracking-wider text-violet-300">
              Bipartisan D/R
            </Text>
          </View>
          <ExplainerBox tag="TL;DR" tagClass="border-purple-500/30 text-purple-300" title="Quick Summary">
            Allocates $12B for upgrading aging water treatment plants and expanding access to clean drinking water in
            underserved communities.
          </ExplainerBox>
          <ExplainerBox tag="ELI5" tagClass="border-amber-500/30 text-amber-300" title="Explain Like I'm 5">
            The government is spending money to fix old pipes and water cleaning machines so everyone can have safe water to
            drink.
          </ExplainerBox>
          <View className="mt-4 flex-row items-center gap-1 self-start rounded-full border border-purple-800/70 bg-purple-950/70 px-2 py-0.5">
            <Icons.Sparkles size={10} colorClassName="accent-purple-400" />
            <Text className="text-[10px] font-sans-semibold uppercase tracking-wider text-purple-300">AI Classified (3)</Text>
          </View>
        </View>
        <Text className="font-sans text-center text-sm text-slate-500">
          Every bill includes CRS summaries, vote tallies broken down by party, roll-call details, and AI policy
          classifications.
        </Text>
      </View>
    </Fold>
  )
}

function VoteTeaser({ billId, title, position }: { billId: string; title: string; position: 'Yes' | 'No' }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-sans flex-1 text-xs text-slate-300" numberOfLines={1}>
        <Text className="font-mono text-slate-500">{billId}</Text> {title}
      </Text>
      <Text
        className={`ml-2 rounded px-2 py-0.5 text-xs font-sans-bold ${position === 'Yes' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-red-900/60 text-red-300'}`}
      >
        {position}
      </Text>
    </View>
  )
}

function Profiles() {
  return (
    <Fold dark={false}>
      <FoldHeading
        badge="Politician Profiles"
        badgeClass="border-rose-500/30 bg-rose-950/50 text-rose-300"
        icon={<Icons.Users size={14} colorClassName="accent-rose-300" />}
        title="Dig Into the Details"
      >
        Click any politician to open their full profile. See contact info, their complete voting record, stated positions
        extracted from their website, and how every vote aligns with what they promised.
      </FoldHeading>
      <View className="mt-14 w-full max-w-md self-center rounded-xl border border-slate-700 bg-slate-800/60 p-6">
        <View className="flex-row items-center gap-2">
          <Text className="rounded bg-blue-900/60 px-2 py-0.5 text-xs font-sans-bold text-blue-300">D</Text>
          <Text className="font-sans text-xs text-slate-400">California</Text>
          <Text className="text-[10px] font-sans-semibold uppercase tracking-wider text-slate-500">Active</Text>
        </View>
        <Text className="mt-2 text-xl font-display-semibold text-white">Rep. Alex Rivera</Text>
        <Text className="font-sans mt-1 text-sm text-slate-400">Representative · District 12</Text>
        <View className="mt-4 gap-2">
          <View className="flex-row items-center gap-2">
            <Icons.Phone size={16} colorClassName="accent-slate-500" />
            <Text className="font-sans text-sm text-slate-300">(202) 555-0142</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Icons.MapPin size={16} colorClassName="accent-slate-500" />
            <Text className="font-sans flex-1 text-sm text-slate-300">1234 Longworth HOB, Washington, DC 20515</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Icons.Globe size={16} colorClassName="accent-slate-500" />
            <Text className="font-sans text-sm text-blue-400">rivera.house.gov</Text>
          </View>
        </View>
        <View className="mt-5 border-t border-slate-700 pt-4">
          <Text className="text-xs font-sans-semibold uppercase tracking-wider text-slate-400">Recent Votes</Text>
          <View className="mt-2 gap-1.5">
            <VoteTeaser billId="H.R. 1234" title="Clean Water Investment Act" position="Yes" />
            <VoteTeaser billId="S. 567" title="National AI Safety Standards" position="Yes" />
            <VoteTeaser billId="H.R. 890" title="Tax Reform Amendment" position="No" />
          </View>
        </View>
        <View className="mt-5 border-t border-slate-700 pt-4">
          <View className="flex-row items-center gap-1.5">
            <Icons.Sparkles size={14} colorClassName="accent-purple-400" />
            <Text className="text-xs font-sans-semibold uppercase tracking-wider text-purple-300">AI Stated Positions (12)</Text>
          </View>
          <Text className="font-sans mt-1.5 text-xs text-slate-400">
            Supports increased education funding, opposes cuts to environmental regulation, wants expanded healthcare access…
          </Text>
        </View>
      </View>
      <Pressable
        onPress={() => router.navigate('/congress')}
        accessibilityRole="link"
        className="mt-12 flex-row items-center gap-2 self-center rounded-lg bg-blue-600 px-6 py-3 active:bg-blue-500"
      >
        <Text className="font-sans-semibold text-white">Browse Congress</Text>
        <Icons.ArrowRight size={16} colorClassName="accent-white" />
      </Pressable>
    </Fold>
  )
}

function SignUp() {
  return (
    <View className="bg-slate-950 px-6 py-20">
      <View className="w-full max-w-3xl self-center rounded-2xl border border-blue-900/60 bg-blue-950/20 p-8">
        <Text className="text-center text-3xl font-display text-white md:text-4xl">Make it yours</Text>
        <Text className="font-sans mt-4 max-w-xl self-center text-center text-base leading-relaxed text-slate-400">
          Everything on Politmus is free to browse. A free account remembers your address, so every visit opens on what
          matters to you.
        </Text>
        <View className="mt-8 w-full max-w-md gap-3 self-center">
          {[
            'Open straight to your election: voting sites, dates and your ballot',
            'Your representatives and their scores, one click away',
            'The latest bills and votes from Congress in your feed',
          ].map((item) => (
            <View key={item} className="flex-row items-start gap-2">
              <Icons.Check size={16} colorClassName="accent-emerald-400" />
              <Text className="font-sans flex-1 text-sm text-slate-300">{item}</Text>
            </View>
          ))}
        </View>
        <View className="mt-10 flex-row flex-wrap items-center justify-center gap-3">
          <SignUpLink />
          <Pressable onPress={() => router.navigate('/now')} accessibilityRole="link" className="px-4 py-3">
            <Text className="text-sm font-sans-semibold text-slate-300">Keep browsing</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
