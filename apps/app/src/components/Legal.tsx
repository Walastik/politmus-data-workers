import { Link, Stack } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { openUrl } from '@/lib/links'

// Privacy Policy and Terms of Service, worded as on the Vite site
// (apps/web/src/pages/Legal.tsx). These appear verbatim in both documents.
const OPERATOR = 'Walastik LLC'
const LEGAL_CONTACT_EMAIL = 'walastikllc@gmail.com'
const GOVERNING_STATE = 'Texas'
const LAST_UPDATED = 'November 3, 2026'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title, headerBackTitle: 'Back' }} />
      <ScrollView
        className="flex-1 bg-slate-900"
        contentContainerClassName="w-full gap-8 px-5 pt-5 pb-12 md:max-w-[720px] md:self-center"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="gap-1">
          <Text role="heading" className="text-2xl font-bold text-slate-50">
            {title}
          </Text>
          <Text className="text-sm text-slate-400">Last updated {LAST_UPDATED}</Text>
        </View>
        {children}
      </ScrollView>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text role="heading" aria-level={2} className="text-lg font-semibold text-slate-100">
        {title}
      </Text>
      {children}
    </View>
  )
}

function P({ children }: { children: ReactNode }) {
  return <Text className="text-sm leading-relaxed text-slate-300">{children}</Text>
}

function Strong({ children }: { children: ReactNode }) {
  return <Text className="font-semibold text-slate-100">{children}</Text>
}

function List({ children }: { children: ReactNode }) {
  return <View className="gap-2">{children}</View>
}

function Item({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-2 pl-1">
      <Text className="text-sm leading-relaxed text-slate-500">•</Text>
      <P>{children}</P>
    </View>
  )
}

function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <Text onPress={() => openUrl(url)} accessibilityRole="link" className="text-blue-400 hover:underline">
      {children}
    </Text>
  )
}

function ContactLink() {
  return <ExternalLink url={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</ExternalLink>
}

function PageLink({ href, children }: { href: '/privacy' | '/terms'; children: ReactNode }) {
  return (
    <Link href={href} className="text-blue-400 hover:underline">
      {children}
    </Link>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <P>
        Politmus helps you see who represents you, how they vote, and where to vote. Politmus is operated by{' '}
        {OPERATOR} ("we," "us," or "our"). This policy explains what information we collect when you use the Politmus
        website and apps (the "Service"), how we use it, and the choices you have. We collect as little as we can to
        make the Service work, and we do not sell your personal information.
      </P>

      <Section title="Information we collect">
        <List>
          <Item>
            <Strong>Account information.</Strong> If you create an account, we receive your email address and, if you
            provide them, your name and profile photo. If you sign in with Google, Google shares your name, email
            address, and profile photo with us. Passwords are handled by our authentication provider, Clerk, and are
            never visible to us.
          </Item>
          <Item>
            <Strong>Addresses you enter.</Strong> When you look up an address, we use it to find your districts,
            representatives, elections, and voting sites. If you are signed in and choose to save an address, it is
            stored with your account so you don't have to enter it again.
          </Item>
          <Item>
            <Strong>Device location.</Strong> If you choose "use my location," your browser or device shares your
            approximate coordinates with the Service. We use them only to perform the lookup you asked for. You can turn
            off
            location access at any time in your browser or device settings.
          </Item>
          <Item>
            <Strong>Information stored on your device.</Strong> Your most recent lookup address is kept on your device
            so the Service remembers it between visits: in your browser's local storage on the website, and in the app's
            secure storage on iOS and Android. To keep you signed in, Clerk sets cookies on the website and stores a
            sign-in token in the app's secure storage. We do not use advertising or cross-site tracking cookies.
          </Item>
          <Item>
            <Strong>Technical information.</Strong> Like most websites and apps, our servers and hosting provider
            receive your IP address, browser or device type, and the pages and data you request. We use IP addresses to
            limit abusive traffic and keep
            the Service running.
          </Item>
        </List>
      </Section>

      <Section title="How we use information">
        <List>
          <Item>To provide the Service, including looking up your representatives, elections, and voting
          locations.</Item>
          <Item>To create and secure your account and keep you signed in.</Item>
          <Item>To remember your preferences, such as a saved address.</Item>
          <Item>To protect the Service from abuse, fix problems, and improve how it works.</Item>
          <Item>To respond to you when you contact us.</Item>
        </List>
        <P>We do not use your information for advertising, and we do not build profiles of your political views.</P>
      </Section>

      <Section title="How we share information">
        <P>
          We share information only with the service providers that help us run Politmus, and only as needed for the
          purpose described:
        </P>
        <List>
          <Item>
            <Strong>Clerk</Strong> provides sign-in and stores your account information and saved address.
          </Item>
          <Item>
            <Strong>U.S. Census Bureau geocoder</Strong> receives addresses or coordinates you look up, to identify
            your congressional and state legislative districts.
          </Item>
          <Item>
            <Strong>Google Civic Information API</Strong> receives addresses you look up, to find upcoming elections
            and voting locations.
          </Item>
          <Item>
            <Strong>Photon (Komoot)</Strong> receives partial addresses as you type, to suggest matches, and your
            coordinates if you use your location, to find the nearest street address. These requests go directly from
            your browser or device.
          </Item>
          <Item>
            <Strong>Fly.io</Strong> hosts our servers.
          </Item>
        </List>
        <P>
          We may also disclose information if required by law, to protect the rights and safety of our users or the
          public, or as part of a merger or transfer of the Service, in which case this policy will continue to apply.
          We do not sell or rent personal information, and we do not share it for targeted advertising.
        </P>
      </Section>

      <Section title="Google user data">
        <P>
          If you sign in with Google, we receive only your name, email address, and profile photo. We use this
          information solely to create and sign in to your Politmus account. We do not use it for advertising, do not
          sell it, and do not transfer it to others except as needed to provide the Service. Our use of information
          received from Google APIs adheres to the{' '}
          <ExternalLink url="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </ExternalLink>
          , including the Limited Use requirements.
        </P>
      </Section>

      <Section title="How long we keep information">
        <P>
          We keep account information and saved addresses until you delete them or delete your account. Addresses you
          look up without saving are not stored in a database; lookup results may be cached briefly in memory to speed
          up repeat requests. Server logs are kept for a limited time for security and troubleshooting.
        </P>
      </Section>

      <Section title="Your choices and rights">
        <List>
          <Item>You can use most of the Service without an account.</Item>
          <Item>You can change or remove your saved address in your account settings on the website. In the apps, you
          can save a different address from the location bar.</Item>
          <Item>You can delete your account from your account settings on the website, or by emailing us.</Item>
          <Item>You can clear your browser's storage, or uninstall the app, to remove the remembered address from your
          device.</Item>
        </List>
        <P>
          Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your
          personal information, or to object to certain uses of it. To make a request, contact us at <ContactLink />.
          We will not treat you differently for exercising these rights.
        </P>
      </Section>

      <Section title="Children">
        <P>
          The Service is not directed to children under 13, and we do not knowingly collect personal information from
          them. If you believe a child has given us personal information, contact us and we will delete it.
        </P>
      </Section>

      <Section title="Security">
        <P>
          We use reasonable safeguards, including encrypted connections, to protect your information. No method of
          transmission or storage is completely secure, so we cannot guarantee absolute security.
        </P>
      </Section>

      <Section title="Changes to this policy">
        <P>
          We may update this policy from time to time. When we do, we will change the date at the top of this page, and
          for significant changes we will provide additional notice, such as on the site or by email.
        </P>
      </Section>

      <Section title="Contact us">
        <P>
          Questions about this policy or your information? Email us at <ContactLink />. See also our{' '}
          <PageLink href="/terms">Terms of Service</PageLink>.
        </P>
      </Section>
    </LegalPage>
  )
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <P>
        These terms are an agreement between you and {OPERATOR} ("we," "us," or "our"), which operates Politmus. They
        govern your use of the Politmus website and apps (the "Service"). By using the Service, you agree to these
        terms. If you do not agree, please do not use the Service.
      </P>

      <Section title="Who can use Politmus">
        <P>
          You must be at least 13 years old to use the Service. If you are under 18, you may use it only with the
          involvement of a parent or guardian. You are responsible for the activity on your account and for keeping
          your sign-in credentials secure.
        </P>
      </Section>

      <Section title="What Politmus is, and isn't">
        <P>
          Politmus is an independent, informational service. It is not affiliated with, endorsed by, or acting on
          behalf of any government agency, election office, political party, candidate, or campaign. Nothing on the
          Service is legal advice or an endorsement of any candidate or position.
        </P>
      </Section>

      <Section title="Accuracy of information">
        <P>
          The Service is built from public sources, including Congress.gov, the U.S. Census Bureau, the Federal
          Election Commission, OpenStates, and the Google Civic Information API. These sources can be incomplete,
          delayed, or wrong, and we may make mistakes combining them. Some summaries and classifications are generated
          with the help of automated tools, including AI, and may contain errors.
        </P>
        <P>
          Scores, grades, and other ratings reflect our own methodology and are opinions, not statements of fact about
          any official.{' '}
          <Strong>
            Always confirm election dates, voter registration deadlines, and polling locations with your state or local
            election office
          </Strong>{' '}
          before you rely on them.
        </P>
      </Section>

      <Section title="Acceptable use">
        <P>When using the Service, you agree not to:</P>
        <List>
          <Item>Break the law or use the Service to harass, threaten, or impersonate anyone.</Item>
          <Item>Scrape, crawl, or make automated requests in a way that burdens the Service or gets around rate
          limits.</Item>
          <Item>Try to access accounts, data, or systems you are not authorized to access.</Item>
          <Item>Interfere with the security or operation of the Service, or introduce malicious code.</Item>
          <Item>Present information from the Service in a misleading way, or as coming from us when it doesn't.</Item>
        </List>
      </Section>

      <Section title="Content and ownership">
        <P>
          Public records remain public. The Service's design, code, scoring methodology, and original text are owned by{' '}
          {OPERATOR}. You may share links to the Service and quote reasonable portions of it with attribution. Logos and
          trademarks of third parties belong to their owners.
        </P>
      </Section>

      <Section title="Third-party services and links">
        <P>
          The Service relies on and links to services run by others, such as sign-in providers, maps, calendars, and
          official websites. We are not responsible for their content or practices, and your use of them is governed by
          their own terms.
        </P>
      </Section>

      <Section title="Privacy">
        <P>
          Our <PageLink href="/privacy">Privacy Policy</PageLink> explains how we handle your information.
        </P>
      </Section>

      <Section title="Suspension and termination">
        <P>
          You can stop using the Service and delete your account at any time. We may suspend or end your access if you
          violate these terms or if needed to protect the Service or other users. We may change or discontinue any part
          of the Service.
        </P>
      </Section>

      <Section title="Disclaimers">
        <P>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
          IMPLIED, INCLUDING WARRANTIES OF ACCURACY, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR CURRENT.
        </P>
      </Section>

      <Section title="Limitation of liability">
        <P>
          TO THE FULLEST EXTENT PERMITTED BY LAW, {OPERATOR.toUpperCase()} AND ITS MEMBERS, MANAGERS, AND CONTRACTORS
          WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
          DATA, OPPORTUNITY, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE, INCLUDING RELIANCE ON ANY ELECTION OR
          VOTING INFORMATION. OUR TOTAL LIABILITY FOR ANY CLAIM RELATED TO THE SERVICE WILL NOT EXCEED $100. Some
          jurisdictions do not allow these limitations, so they may not apply to you.
        </P>
      </Section>

      <Section title="Indemnification">
        <P>
          You agree to defend and hold harmless {OPERATOR} and its members, managers, and contractors from claims
          arising out of your misuse of the Service or your violation of these terms.
        </P>
      </Section>

      <Section title="Governing law">
        <P>
          These terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to its conflict of law
          rules. Any dispute will be resolved in the state or federal courts located in {GOVERNING_STATE}, unless the
          law where you live requires otherwise.
        </P>
      </Section>

      <Section title="Changes to these terms">
        <P>
          We may update these terms from time to time. When we do, we will change the date at the top of this page. If
          you keep using the Service after a change takes effect, you accept the updated terms.
        </P>
      </Section>

      <Section title="Contact us">
        <P>
          Questions about these terms? Email us at <ContactLink />.
        </P>
      </Section>
    </LegalPage>
  )
}

// Links shown at the foot of public pages, where Google's OAuth review looks for them.
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <View role="navigation" aria-label="Legal" className={`flex-row justify-center gap-4 ${className}`}>
      <Link href="/privacy" className="text-xs text-slate-500 hover:text-slate-300 hover:underline">
        Privacy Policy
      </Link>
      <Link href="/terms" className="text-xs text-slate-500 hover:text-slate-300 hover:underline">
        Terms of Service
      </Link>
    </View>
  )
}
