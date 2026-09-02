import { useMemo, useState } from 'react';
import { CURRENT_TERMS_VERSION } from '../constants/terms';

// Must stay in step with CURRENT_TERMS_VERSION - the version string is this date, and
// the backend decides who has accepted which. See src/constants/terms.ts.
const LAST_UPDATED = 'August 28, 2026';

/**
 * Who a section is really addressed to.
 *
 * Clients and Providers agree to the same document but carry very different
 * obligations under it - a Provider owes commission on cash they collect directly, a
 * Client owes payment inside a deadline that starts when the Provider accepts. Tagging
 * the sections lets a reader filter down to their own half instead of reading both.
 */
export type Audience = 'all' | 'client' | 'provider';

interface Section {
  id: string;
  title: string;
  audience: Audience;
  /**
   * The clause in one plain sentence, shown above the formal wording.
   *
   * Not a replacement for the text - every clause stays on the page in full. It exists
   * because the whole document is a nine-minute read and almost nobody was giving it
   * nine minutes; the gist lines make the same content skimmable in about one.
   */
  inShort: string;
  /** Money-and-risk clauses, marked so they survive a skim. */
  important?: boolean;
  paragraphs: string[];
  /** Rendered as a list after the paragraphs, for clauses that were unreadable as prose. */
  bullets?: string[];
}

const AUDIENCE_LABEL: Record<Exclude<Audience, 'all'>, string> = {
  client: 'For Clients',
  provider: 'For Providers',
};

/**
 * What a reader needs to know if they read nothing else.
 *
 * Deliberately short and deliberately unflattering where the truth is unflattering -
 * a summary that only lists the reassuring parts is worse than no summary, because it
 * buys agreement on a false impression.
 */
const SUMMARY: { audience: Audience; text: string }[] = [
  { audience: 'all', text: 'Every booking is a request. Nothing is confirmed and nothing is charged until the provider accepts it.' },
  { audience: 'all', text: 'PhotoFind takes 15% of every booking. Providers set their own prices.' },
  { audience: 'client', text: 'Once a provider accepts, you have 24 hours to pay - or 2 hours before the shoot, whichever comes first. Miss it and the booking is cancelled automatically.' },
  { audience: 'client', text: 'Your payment is held by PhotoFind and only released to the provider after you confirm the work was done, or 48 hours after they mark it complete.' },
  { audience: 'provider', text: 'If you take cash, you keep the full amount and we deduct the 15% from your wallet. That can put your balance below zero, and the shortfall is a debt settled from later earnings.' },
  { audience: 'provider', text: 'You are an independent contractor, not an employee. Payouts start at PHP 500.' },
  { audience: 'all', text: 'Cancelling does not automatically refund a payment you have already made - you have to raise it with support or through a dispute.' },
  { audience: 'all', text: 'If a dispute goes unanswered for 7 days it closes in the provider\'s favour. Respond to disputes promptly.' },
  { audience: 'all', text: 'PhotoFind is a marketplace, not a party to the job itself. We are not liable for how a booking turns out.' },
];

// Sections state what the platform actually does. Figures that are configurable
// server-side (commission rate, payment window, payout minimum) are written out in full
// here so the document is readable on its own; if any of them are changed in the backend
// config, this file has to change with them.
const SECTIONS: Section[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    audience: 'all',
    inShort: 'Using PhotoFind means agreeing to these terms. We record the date you agreed.',
    paragraphs: [
      'By creating an account or using PhotoFind, you agree to be bound by these Terms and Conditions. If you do not agree, please do not create an account or use the platform.',
      'We record the date you accepted these Terms when you sign up. If we make material changes, we will update the "Last updated" date shown above and may ask you to accept the revised Terms before continuing to use the platform.',
    ],
  },
  {
    id: 'service',
    title: '2. Description of Service',
    audience: 'all',
    inShort: 'We introduce clients to providers and handle the booking and payment. We do not do the shoot.',
    paragraphs: [
      'PhotoFind is a marketplace that connects Clients seeking creative services (such as photography and videography) with independent Service Providers who offer those services. PhotoFind facilitates discovery, booking, communication, and payment between Clients and Providers.',
      'PhotoFind is not a party to the service agreement between a Client and a Provider, is not the employer or agent of any Provider, and does not perform the booked services itself.',
    ],
  },
  {
    id: 'accounts',
    title: '3. Accounts & Eligibility',
    audience: 'all',
    inShort: 'You must be 18 or older, give accurate details, and keep your password to yourself.',
    paragraphs: [
      'You must provide accurate, current information when creating an account and are responsible for keeping your login credentials confidential. You must be at least 18 years old, or the age of legal majority in your jurisdiction, to create an account. You are responsible for all activity that occurs under your account.',
      'Each account holds one role - Client or Provider. You may not use another person\'s account or let another person use yours.',
    ],
  },
  {
    id: 'bookings',
    title: '4. How Bookings Work',
    audience: 'all',
    inShort: 'Every booking is a request the provider has to accept. Your chosen slots are held for 10 minutes while you finish the request.',
    paragraphs: [
      'Every booking on PhotoFind is a request. When a Client selects a service, date, and time, the request is sent to the Provider, who may accept or decline it. No booking is confirmed, and no payment is taken, until the Provider accepts.',
      'While a Client is completing a booking request, the time slots they have selected are held for 10 minutes so another Client cannot take them mid-request. If the request is not submitted within that time, the hold expires and the slots return to general availability.',
      'A request that is never accepted is automatically cancelled once its start time passes, and the slots are released. Accepting a request that conflicts with another confirmed booking is not possible.',
      'Prices, availability, and service details are set by each Provider and shown at the time of booking. All amounts are in Philippine Pesos (PHP).',
    ],
  },
  {
    id: 'commission',
    title: '5. Platform Commission',
    audience: 'all',
    important: true,
    inShort: 'PhotoFind takes 15% of every booking, however it is paid.',
    paragraphs: [
      'PhotoFind charges a platform commission of 15% on every booking. For bookings paid online, the commission is shown to the Client as a separate line at checkout and is deducted before the balance is credited to the Provider. For bookings paid in cash, the commission is charged to the Provider\'s wallet - see Section 7.',
      'The commission applies to every booking made through the platform, regardless of how it is paid.',
    ],
  },
  {
    id: 'paying-online',
    title: '6. Paying for a Booking (Online)',
    audience: 'client',
    important: true,
    inShort: 'Pay within 24 hours of the provider accepting, or 2 hours before the shoot - whichever comes first. Miss the deadline and the booking is cancelled.',
    paragraphs: [
      'Once a Provider accepts your request, you pay through the platform from your Bookings page. Payment is due within 24 hours of the Provider accepting, or 2 hours before the booking starts, whichever comes first - and never less than 30 minutes after acceptance. The exact deadline is shown on the booking, and we send you a reminder before it passes.',
      'If payment is not received by the deadline, the booking is automatically cancelled and the date is released so the Provider can sell it to someone else. If a payment is already in progress when the deadline passes, we wait for it to succeed or fail before cancelling.',
      'Your payment is held by the platform and is not released to the Provider until the booking is completed and confirmed - see Section 9.',
    ],
  },
  {
    id: 'paying-cash',
    title: '7. Paying in Cash',
    audience: 'all',
    important: true,
    inShort: 'Where a provider offers it, you pay on the day. The provider keeps the cash and still owes PhotoFind 15%, taken from their wallet - which can leave them owing us money.',
    paragraphs: [
      'Some Providers accept cash on the day of the shoot. This option is available only where the Provider has explicitly enabled it for that service; it cannot be requested otherwise. Cash bookings have no online payment deadline.',
      'For a cash booking, the Provider records that the cash was received. This can only be done from 30 minutes before the booking starts onward, so that a booking cannot be marked paid weeks in advance.',
      'Because the Provider collects the full amount directly, the 15% platform commission on a cash booking is deducted from the Provider\'s wallet balance rather than withheld from the payment. This deduction may take a wallet balance below zero, in which case the shortfall is a debt owed to PhotoFind and is settled out of the Provider\'s subsequent earnings before any payout can be released.',
    ],
  },
  {
    id: 'rescheduling',
    title: '8. Rescheduling',
    audience: 'all',
    inShort: 'Either side can propose a new time; the other has to approve it. Up to 10 times per booking.',
    paragraphs: [
      'Either party may propose a new date and time for a booking that has not yet been completed. For a booking the Provider has already accepted, the other party must approve the new time before it takes effect. A booking may be rescheduled up to 10 times.',
      'A booking cannot be rescheduled onto a date the Provider has blocked, or onto a time that conflicts with another confirmed booking.',
    ],
  },
  {
    id: 'completion',
    title: '9. Completing a Booking & Releasing Payment',
    audience: 'all',
    important: true,
    inShort: 'The provider marks the job done, then you confirm it. If you do nothing for 48 hours it confirms itself and the money is released.',
    paragraphs: [
      'After the session, the Provider marks the booking complete. The Client is then asked to confirm that the service was delivered, or to raise a dispute. Payment is released from the platform to the Provider\'s wallet on that confirmation.',
      'If the Client neither confirms nor disputes within 48 hours of the Provider marking the booking complete, it is confirmed automatically and the payment is released. A reminder is sent 24 hours before that happens.',
      'A Provider cannot mark an unpaid online booking as complete, and payment cannot be released for a booking that was never paid.',
    ],
  },
  {
    id: 'cancellations',
    title: '10. Cancellations',
    audience: 'all',
    important: true,
    inShort: 'Either side can cancel before the job is done - but cancelling does not refund a payment on its own. Contact support to sort out the money.',
    paragraphs: [
      'Either party may cancel a booking at any time before it is completed, and the time slots are returned to the Provider\'s availability. A booking that has already been completed, or that is under dispute, cannot be cancelled.',
      'Cancelling does not by itself refund a payment that has already been made. If you have paid for a booking and it is cancelled, raise the matter through support or the dispute process so the payment can be reviewed and refunded where appropriate.',
      'Repeated cancellations may affect your standing on the platform and your ability to book or offer services.',
    ],
  },
  {
    id: 'disputes',
    title: '11. Disputes',
    audience: 'all',
    important: true,
    inShort: 'Unhappy with a completed booking? Dispute it instead of confirming, with evidence. We decide, and our decision is final. Leave it 7 days and it closes in the provider\'s favour.',
    paragraphs: [
      'If a Client believes a completed booking was not delivered as agreed, they may raise a dispute instead of confirming it, giving a written reason. Both parties may then submit supporting evidence, including photographs, through the booking\'s dispute flow.',
      'PhotoFind reviews the evidence submitted by both parties and makes a resolution determination, which may include releasing payment to the Provider in full, refunding the Client in full, or splitting the amount between them. Our decision on platform-mediated disputes is final.',
      'A dispute that remains unresolved for 7 days is closed automatically in the Provider\'s favour and the payment is released. Both parties should therefore respond to a dispute promptly.',
    ],
  },
  {
    id: 'payouts',
    title: '12. Provider Wallet & Payouts',
    audience: 'provider',
    inShort: 'Earnings land in your wallet after commission. Cash out from PHP 500 by GCash, Maya, or bank transfer.',
    paragraphs: [
      'Earnings from completed bookings are credited to your in-app wallet, net of the platform commission. You may request a payout of your available balance by GCash, Maya, or bank transfer, subject to the following:',
    ],
    bullets: [
      'The minimum payout is PHP 500.',
      'You may have up to 3 payout requests in progress at any one time.',
      'Payout requests are reviewed before funds are released, and may be delayed for verification or fraud prevention.',
      'Any commission you owe on cash bookings is settled from your balance before a payout can be released.',
      'You are responsible for the accuracy of the payout details you provide. PhotoFind is not responsible for funds sent to an account number or mobile number you entered incorrectly.',
    ],
  },
  {
    id: 'verification',
    title: '13. Provider Verification & Conduct',
    audience: 'provider',
    inShort: 'Verification is optional and is not us vouching for your work. You are self-employed and responsible for your own taxes, insurance, and permits.',
    paragraphs: [
      'Providers may voluntarily submit documentation for verification review. A "Verified" badge indicates PhotoFind has reviewed the submitted materials. It is not a guarantee of the quality, safety, or legality of a Provider\'s services.',
      'Providers agree to keep their availability accurate, to honour bookings they have accepted, to conduct their services professionally, and to comply with applicable laws, including holding any permits or licences their work requires.',
      'You are an independent contractor, not an employee of PhotoFind. You are responsible for your own taxes, insurance, and equipment.',
    ],
  },
  {
    id: 'reviews',
    title: '14. Reviews',
    audience: 'all',
    inShort: 'Only review bookings you actually had. No paid, traded, or self-written reviews.',
    paragraphs: [
      'Reviews must reflect a genuine booking experience. PhotoFind may moderate, flag, or remove reviews that violate these Terms, contain abusive content, or are found to be fraudulent.',
      'You may not offer or accept anything of value in exchange for a review, or write a review of your own business or a competitor\'s.',
    ],
  },
  {
    id: 'prohibited',
    title: '15. Prohibited Conduct',
    audience: 'all',
    inShort: 'Do not take bookings off-platform to dodge the commission, and do not harass, fake, or steal. Breaking these can cost you your account.',
    paragraphs: [
      'You agree not to do any of the following:',
    ],
    bullets: [
      'Take a booking arranged on PhotoFind off the platform in order to avoid the commission.',
      'Harass, threaten, or discriminate against other users.',
      'Submit false verification documents or fraudulent reviews.',
      'Upload content you do not hold the rights to.',
      'Interfere with the platform\'s security or availability.',
      'Use the platform for any unlawful purpose.',
    ],
  },
  {
    id: 'ip',
    title: '16. Intellectual Property',
    audience: 'all',
    inShort: 'Your portfolio stays yours; we just get to display it. Who owns the photos from a shoot is between you and the other party.',
    paragraphs: [
      'Providers retain ownership of the portfolio images and other content they upload, but grant PhotoFind a non-exclusive licence to display that content on the platform for the purpose of operating and promoting the marketplace. This licence ends when the content is removed, except for copies already made in backups or search caches.',
      'Rights in the photographs or footage produced under a booking are a matter between the Client and the Provider and should be agreed between them. PhotoFind takes no position on and claims no rights in that work.',
      'You may not copy or reuse another user\'s content without their permission.',
    ],
  },
  {
    id: 'data',
    title: '17. Your Personal Data',
    audience: 'all',
    inShort: 'We collect what we need to run the bookings. You can ask what we hold, correct it, or ask us to delete it.',
    paragraphs: [
      'To operate the platform we collect and process:',
    ],
    bullets: [
      'The account details you give us when you sign up.',
      'The bookings you make and the messages you exchange with the other party.',
      'Payment records. Payments are processed by a third-party payment provider - we do not store your full card details.',
      'Verification documents, for Providers who choose to submit them.',
    ],
  },
  {
    id: 'termination',
    title: '18. Termination',
    audience: 'all',
    inShort: 'Ask support to close your account. We can suspend accounts for fraud or repeated violations.',
    paragraphs: [
      'You may ask us to close your account at any time by contacting support. We will settle any outstanding wallet balance and complete or cancel any bookings still open before closing it.',
      'PhotoFind may suspend or terminate accounts that violate these Terms, with or without notice, particularly in cases of fraud, abuse, or repeated policy violations.',
    ],
  },
  {
    id: 'liability',
    title: '19. Limitation of Liability',
    audience: 'all',
    important: true,
    inShort: 'We are not responsible for how a booking turns out. Our liability is capped at the fees we received on that booking.',
    paragraphs: [
      'PhotoFind is not liable for the quality, timeliness, or outcome of services rendered between Clients and Providers, as PhotoFind is not a party to that underlying agreement. We do not guarantee that any Provider will accept a request, or that the platform will be available without interruption.',
      'To the fullest extent permitted by law, PhotoFind\'s liability for any claim arising from use of the platform is limited to the fees PhotoFind received in connection with the booking that claim relates to. Nothing in these Terms limits any right you have under the Consumer Act of the Philippines or other law that cannot be waived by agreement.',
    ],
  },
  {
    id: 'changes',
    title: '20. Changes to These Terms',
    audience: 'all',
    inShort: 'We can update these terms. Changes do not apply backwards to bookings already confirmed.',
    paragraphs: [
      'PhotoFind may update these Terms from time to time. Material changes will be reflected by updating the "Last updated" date above. Continued use of the platform after changes take effect constitutes acceptance of the revised Terms. Changes do not apply retroactively to bookings already confirmed before the change.',
    ],
  },
  {
    id: 'law',
    title: '21. Governing Law',
    audience: 'all',
    inShort: 'Philippine law applies, and Philippine courts hear anything the dispute process cannot settle.',
    paragraphs: [
      'These Terms are governed by the laws of the Republic of the Philippines, without regard to conflict-of-law principles. Disputes that cannot be resolved through the platform\'s dispute process are subject to the courts of the Philippines.',
    ],
  },
  {
    id: 'contact',
    title: '22. Contact',
    audience: 'all',
    inShort: 'Email support@photofind.app with any question about these terms.',
    paragraphs: [
      'Questions about these Terms can be sent to support@photofind.app.',
    ],
  },
];

// Extra paragraph for the data section, which needs prose after its list rather than
// before it - kept out of `paragraphs` so the list isn't stranded at the end.
const DATA_RIGHTS_PARAGRAPH =
  'Personal data is processed in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173). You may ask us what personal data we hold about you, ask us to correct it, or ask us to delete your account and associated data by contacting support. Some records - such as completed bookings and payment history - may be retained where we are required to keep them.';

/** Words per minute for the reading estimate. A deliberately unhurried rate for prose like this. */
const READING_WPM = 200;

function countWords(section: Section): number {
  const parts = [section.inShort, ...section.paragraphs, ...(section.bullets || [])];
  return parts.join(' ').split(/\s+/).filter(Boolean).length;
}

function matchesAudience(sectionAudience: Audience, filter: Audience): boolean {
  // 'all' as a filter shows everything; an 'all' section is relevant to every reader
  // and is never filtered out.
  return filter === 'all' || sectionAudience === 'all' || sectionAudience === filter;
}

function AudienceBadge({ audience }: { audience: Audience }) {
  if (audience === 'all') return null;
  return (
    <span className={`terms-badge terms-badge--${audience}`}>{AUDIENCE_LABEL[audience]}</span>
  );
}

/**
 * The plain-language summary. Also used on its own at signup - see `KeyPoints` - which
 * is why the bullet list is factored out here.
 */
export function TermsSummaryList({ audience = 'all' }: { audience?: Audience }) {
  const points = SUMMARY.filter((point) => matchesAudience(point.audience, audience));
  return (
    <ul className="terms-summary-list">
      {points.map((point) => (
        <li key={point.text}>{point.text}</li>
      ))}
    </ul>
  );
}

/**
 * A compact version of the summary for the signup form, where it sits beside the
 * checkbox rather than behind a link.
 */
export function TermsKeyPoints({ audience = 'all', limit }: { audience?: Audience; limit?: number }) {
  const points = SUMMARY.filter((point) => matchesAudience(point.audience, audience)).slice(
    0,
    limit ?? SUMMARY.length
  );

  return (
    <div className="terms-keypoints">
      <p className="terms-keypoints-title">The short version</p>
      <ul className="terms-summary-list">
        {points.map((point) => (
          <li key={point.text}>{point.text}</li>
        ))}
      </ul>
    </div>
  );
}

interface TermsContentProps {
  /** Which role's sections to show first. The reader can still change it. */
  defaultAudience?: Audience;
  /** The jump-link list. Worth it on the full page, noise inside a modal. */
  showContents?: boolean;
}

export function TermsContent({ defaultAudience = 'all', showContents = false }: TermsContentProps) {
  const [audience, setAudience] = useState<Audience>(defaultAudience);

  const visibleSections = useMemo(
    () => SECTIONS.filter((section) => matchesAudience(section.audience, audience)),
    [audience]
  );

  const readingMinutes = useMemo(() => {
    const words = visibleSections.reduce((sum, section) => sum + countWords(section), 0);
    return Math.max(1, Math.round(words / READING_WPM));
  }, [visibleSections]);

  const filters: { value: Audience; label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'client', label: 'For clients' },
    { value: 'provider', label: 'For providers' },
  ];

  return (
    <div>
      <div className="terms-meta">
        <span>Last updated: {LAST_UPDATED}</span>
        <span>Version {CURRENT_TERMS_VERSION}</span>
        <span>
          {visibleSections.length} section{visibleSections.length === 1 ? '' : 's'} · about{' '}
          {readingMinutes} min read
        </span>
      </div>

      <div className="terms-summary">
        <p className="terms-summary-title">The short version</p>
        <p className="terms-summary-lede">
          The points below are the ones that most affect you. They are a summary, not a
          substitute - the full terms follow.
        </p>
        <TermsSummaryList audience={audience} />
        <p className="terms-summary-note">
          Sections marked <span className="terms-badge terms-badge--important">Important</span> are
          the ones that affect money or your rights.
        </p>
      </div>

      <div className="terms-filter">
        <span className="terms-filter-label">Show:</span>
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setAudience(filter.value)}
            aria-pressed={audience === filter.value}
            className="terms-chip"
          >
            {filter.label}
          </button>
        ))}
      </div>

      {showContents && (
        <nav className="terms-toc" aria-label="Contents">
          <p className="terms-toc-title">Contents</p>
          <ul className="terms-toc-list">
            {visibleSections.map((section) => (
              <li key={section.id}>
                <a href={`#terms-${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div>
        {visibleSections.length === 0 ? (
          <p className="terms-empty">No sections match this filter.</p>
        ) : (
          visibleSections.map((section) => (
            <section
              key={section.id}
              id={`terms-${section.id}`}
              className={`terms-section${section.important ? ' terms-section--important' : ''}`}
            >
              <div className="terms-section-head">
                <h2 className="text-gray-900">{section.title}</h2>
                <AudienceBadge audience={section.audience} />
                {section.important && (
                  <span className="terms-badge terms-badge--important">Important</span>
                )}
              </div>

              <p className="terms-inshort">
                <span className="terms-inshort-label">In short: </span>
                {section.inShort}
              </p>

              <div className="terms-body">
                {section.paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}

                {section.bullets && (
                  <ul className="terms-list">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}

                {section.id === 'data' && <p>{DATA_RIGHTS_PARAGRAPH}</p>}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default TermsContent;
