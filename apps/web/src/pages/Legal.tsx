import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import PageHeader, { PageContainer } from '../components/PageHeader'

// These appear verbatim in both documents.
const OPERATOR = 'Walastik LLC'
const LEGAL_CONTACT_EMAIL = 'walastikllc@gmail.com'
const GOVERNING_STATE = 'Texas'
const LAST_UPDATED = 'October 31, 2026'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PageContainer narrow>
      <PageHeader title={title} description={`Last updated ${LAST_UPDATED}`} />
      <div className="space-y-8 text-sm leading-relaxed text-slate-300">{children}</div>
    </PageContainer>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      {children}
    </section>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>
}

function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-blue-400 hover:underline">
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Politmus helps you see who represents you, how they vote, and where to vote. Politmus is operated by{' '}
        {OPERATOR} ("we," "us," or "our"). This policy explains what information we collect when you use the
        Politmus website and apps (the "Service"), how we use it, and the choices you have. We collect as little as we can to make the Service work, and we do not sell your personal
        information.
      </p>

      <Section title="Information we collect">
        <List>
          <li>
            <strong className="text-slate-100">Account information.</strong> If you create an account, we receive
            your email address and, if you provide them, your name and profile photo. If you sign in with Google, Google
            shares your name, email address, and profile photo with us. Passwords are handled by our authentication
            provider, Clerk, and are never visible to us.
          </li>
          <li>
            <strong className="text-slate-100">Addresses you enter.</strong> When you look up an address, we use it to
            find your districts, representatives, elections, and voting sites. If you are signed in and choose to save
            an address, it is stored with your account so you don't have to enter it again.
          </li>
          <li>
            <strong className="text-slate-100">Device location.</strong> If you choose "use my location," your browser
            shares your approximate coordinates with the Service. We use them only to perform the lookup you asked for.
            You can turn off location access at any time in your browser or device settings.
          </li>
          <li>
            <strong className="text-slate-100">Information stored on your device.</strong> Your most recent lookup
            address is kept in your browser's local storage so the Service remembers it between visits. Clerk sets
            cookies that keep you signed in. We do not use advertising or cross-site tracking cookies.
          </li>
          <li>
            <strong className="text-slate-100">Technical information.</strong> Like most websites, our servers and
            hosting provider receive your IP address, browser type, and the pages you request. We use IP addresses to
            limit abusive traffic and keep the Service running.
          </li>
        </List>
      </Section>

      <Section title="How we use information">
        <List>
          <li>To provide the Service, including looking up your representatives, elections, and voting locations.</li>
          <li>To create and secure your account and keep you signed in.</li>
          <li>To remember your preferences, such as a saved address.</li>
          <li>To protect the Service from abuse, fix problems, and improve how it works.</li>
          <li>To respond to you when you contact us.</li>
        </List>
        <p>We do not use your information for advertising, and we do not build profiles of your political views.</p>
      </Section>

      <Section title="How we share information">
        <p>
          We share information only with the service providers that help us run Politmus, and only as needed for the
          purpose described:
        </p>
        <List>
          <li>
            <strong className="text-slate-100">Clerk</strong> provides sign-in and stores your account information and
            saved address.
          </li>
          <li>
            <strong className="text-slate-100">U.S. Census Bureau geocoder</strong> receives addresses or coordinates
            you look up, to identify your congressional and state legislative districts.
          </li>
          <li>
            <strong className="text-slate-100">Google Civic Information API</strong> receives addresses you look up,
            to find upcoming elections and voting locations.
          </li>
          <li>
            <strong className="text-slate-100">Photon (Komoot)</strong> receives partial addresses as you type, to
            suggest matches, and your coordinates if you use your location, to find the nearest street address. These
            requests go directly from your browser.
          </li>
          <li>
            <strong className="text-slate-100">Fly.io</strong> hosts our servers.
          </li>
        </List>
        <p>
          We may also disclose information if required by law, to protect the rights and safety of our users or the
          public, or as part of a merger or transfer of the Service, in which case this policy will continue to apply.
          We do not sell or rent personal information, and we do not share it for targeted advertising.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          If you sign in with Google, we receive only your name, email address, and profile photo. We use this
          information solely to create and sign in to your Politmus account. We do not use it for advertising, do not
          sell it, and do not transfer it to others except as needed to provide the Service. Our use of information
          received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-blue-400 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section title="How long we keep information">
        <p>
          We keep account information and saved addresses until you delete them or delete your account. Addresses you
          look up without saving are not stored in a database; lookup results may be cached briefly in memory to speed
          up repeat requests. Server logs are kept for a limited time for security and troubleshooting.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <List>
          <li>You can use most of the Service without an account.</li>
          <li>You can change or remove your saved address in your account settings.</li>
          <li>You can delete your account from your account settings, or by emailing us.</li>
          <li>You can clear your browser's storage to remove the remembered address from your device.</li>
        </List>
        <p>
          Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your
          personal information, or to object to certain uses of it. To make a request, contact us at <ContactLink />.
          We will not treat you differently for exercising these rights.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The Service is not directed to children under 13, and we do not knowingly collect personal information from
          them. If you believe a child has given us personal information, contact us and we will delete it.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use reasonable safeguards, including encrypted connections, to protect your information. No method of
          transmission or storage is completely secure, so we cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. When we do, we will change the date at the top of this page,
          and for significant changes we will provide additional notice, such as on the site or by email.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about this policy or your information? Email us at <ContactLink />. See also our{' '}
          <Link to="/terms" className="text-blue-400 hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  )
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between you and {OPERATOR} ("we," "us," or "our"), which operates Politmus. They
        govern your use of the Politmus website and apps (the "Service"). By using the Service, you agree to these
        terms. If you do not agree, please do not use the Service.
      </p>

      <Section title="Who can use Politmus">
        <p>
          You must be at least 13 years old to use the Service. If you are under 18, you may use it only with the
          involvement of a parent or guardian. You are responsible for the activity on your account and for keeping
          your sign-in credentials secure.
        </p>
      </Section>

      <Section title="What Politmus is, and isn't">
        <p>
          Politmus is an independent, informational service. It is not affiliated with, endorsed by, or acting on
          behalf of any government agency, election office, political party, candidate, or campaign. Nothing on the
          Service is legal advice or an endorsement of any candidate or position.
        </p>
      </Section>

      <Section title="Accuracy of information">
        <p>
          The Service is built from public sources, including Congress.gov, the U.S. Census Bureau, the Federal
          Election Commission, OpenStates, and the Google Civic Information API. These sources can be incomplete,
          delayed, or wrong, and we may make mistakes combining them. Some summaries and classifications are generated
          with the help of automated tools, including AI, and may contain errors.
        </p>
        <p>
          Scores, grades, and other ratings reflect our own methodology and are opinions, not statements of fact about
          any official. <strong className="text-slate-100">Always confirm election dates, voter registration
          deadlines, and polling locations with your state or local election office</strong> before you rely on them.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>When using the Service, you agree not to:</p>
        <List>
          <li>Break the law or use the Service to harass, threaten, or impersonate anyone.</li>
          <li>
            Scrape, crawl, or make automated requests in a way that burdens the Service or gets around rate limits.
          </li>
          <li>Try to access accounts, data, or systems you are not authorized to access.</li>
          <li>Interfere with the security or operation of the Service, or introduce malicious code.</li>
          <li>Present information from the Service in a misleading way, or as coming from us when it doesn't.</li>
        </List>
      </Section>

      <Section title="Content and ownership">
        <p>
          Public records remain public. The Service's design, code, scoring methodology, and original text are owned by
          {OPERATOR}. You may share links to the Service and quote reasonable portions of it with attribution. Logos and
          trademarks of third parties belong to their owners.
        </p>
      </Section>

      <Section title="Third-party services and links">
        <p>
          The Service relies on and links to services run by others, such as sign-in providers, maps, calendars, and
          official websites. We are not responsible for their content or practices, and your use of them is governed by
          their own terms.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          Our{' '}
          <Link to="/privacy" className="text-blue-400 hover:underline">
            Privacy Policy
          </Link>{' '}
          explains how we handle your information.
        </p>
      </Section>

      <Section title="Suspension and termination">
        <p>
          You can stop using the Service and delete your account at any time. We may suspend or end your access if you
          violate these terms or if needed to protect the Service or other users. We may change or discontinue any part
          of the Service.
        </p>
      </Section>

      <Section title="Disclaimers">
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
          IMPLIED, INCLUDING WARRANTIES OF ACCURACY, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR CURRENT.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, {OPERATOR.toUpperCase()} AND ITS MEMBERS, MANAGERS, AND
          CONTRACTORS WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, OPPORTUNITY, OR GOODWILL,
          ARISING FROM YOUR USE OF THE SERVICE, INCLUDING RELIANCE ON ANY ELECTION OR VOTING INFORMATION. OUR TOTAL
          LIABILITY FOR ANY CLAIM RELATED TO THE SERVICE WILL NOT EXCEED $100. Some jurisdictions do not allow these
          limitations, so they may not apply to you.
        </p>
      </Section>

      <Section title="Indemnification">
        <p>
          You agree to defend and hold harmless {OPERATOR} and its members, managers, and contractors from claims arising out of your misuse of
          the Service or your violation of these terms.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to its conflict of
          law rules. Any dispute will be resolved in the state or federal courts located in {GOVERNING_STATE}, unless
          the law where you live requires otherwise.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these terms from time to time. When we do, we will change the date at the top of this page.
          If you keep using the Service after a change takes effect, you accept the updated terms.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about these terms? Email us at <ContactLink />.
        </p>
      </Section>
    </LegalPage>
  )
}

// Links shown at the foot of public pages, where Google's OAuth review looks for them.
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex justify-center gap-4 text-xs text-slate-500 ${className}`}>
      <Link to="/privacy" className="hover:text-slate-300 hover:underline">
        Privacy Policy
      </Link>
      <Link to="/terms" className="hover:text-slate-300 hover:underline">
        Terms of Service
      </Link>
    </nav>
  )
}
