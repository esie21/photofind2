const LAST_UPDATED = 'August 10, 2026';

interface Section {
  title: string;
  paragraphs: string[];
}

const SECTIONS: Section[] = [
  {
    title: '1. Acceptance of Terms',
    paragraphs: [
      'By creating an account or using PhotoFind, you agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not agree, please do not create an account or use the platform.',
    ],
  },
  {
    title: '2. Description of Service',
    paragraphs: [
      'PhotoFind is a marketplace that connects Clients seeking creative services (such as photography and videography) with independent Service Providers who offer those services. PhotoFind facilitates discovery, booking, communication, and payment between Clients and Providers, but is not itself a party to the service agreement between them.',
    ],
  },
  {
    title: '3. Accounts & Eligibility',
    paragraphs: [
      'You must provide accurate, current information when creating an account and are responsible for keeping your login credentials confidential. You must be at least 18 years old, or the age of legal majority in your jurisdiction, to create an account. You are responsible for all activity that occurs under your account.',
    ],
  },
  {
    title: '4. Bookings & Payments',
    paragraphs: [
      'Providers may offer bookings under Request Approval (the Provider reviews and confirms the request) or Instant Booking (the slot is reserved immediately). Prices, availability, and service details are set by each Provider and displayed at the time of booking.',
      'Payments are processed through the platform and amounts owed to Providers are credited to their in-app wallet upon completion of a booking, subject to the Platform Commission described in your Provider agreement. All amounts are in Philippine Pesos (PHP) unless otherwise stated.',
    ],
  },
  {
    title: '5. Cancellations & Refunds',
    paragraphs: [
      'Cancellation and refund eligibility depends on the booking mode, how far in advance the cancellation occurs, and the Provider\'s stated policy shown at booking time. Repeated cancellations may affect your ability to book or offer services on the platform.',
    ],
  },
  {
    title: '6. Provider Verification & Conduct',
    paragraphs: [
      'Providers may voluntarily submit documentation for verification review. A "Verified" badge indicates PhotoFind has reviewed the submitted materials but is not a guarantee of the quality, safety, or legality of a Provider\'s services. Providers agree to conduct their services professionally, honor confirmed bookings, and comply with applicable laws.',
    ],
  },
  {
    title: '7. Reviews',
    paragraphs: [
      'Reviews must reflect a genuine booking experience. PhotoFind may moderate, flag, or remove reviews that violate these Terms, contain abusive content, or are found to be fraudulent.',
    ],
  },
  {
    title: '8. Disputes',
    paragraphs: [
      'If a Client or Provider disagrees about the outcome of a completed booking, either party may raise a dispute with supporting evidence through the booking\'s dispute flow. PhotoFind will review the evidence submitted by both parties and make a resolution determination, which may include a partial or full refund. Our decision on platform-mediated disputes is final.',
    ],
  },
  {
    title: '9. Wallet & Payouts',
    paragraphs: [
      'Providers may request payout of their available wallet balance via supported channels (such as GCash, PayMaya, or bank transfer), subject to any minimum payout amount in effect. Payout requests are reviewed before funds are released and may be delayed for verification or fraud-prevention purposes.',
    ],
  },
  {
    title: '10. Prohibited Conduct',
    paragraphs: [
      'You agree not to: circumvent the platform to avoid fees, harass or discriminate against other users, submit false verification documents or reviews, upload content you do not have rights to, or use the platform for any unlawful purpose. Violations may result in suspension or termination of your account.',
    ],
  },
  {
    title: '11. Intellectual Property',
    paragraphs: [
      'Providers retain ownership of the portfolio images and content they upload but grant PhotoFind a license to display that content on the platform for the purpose of operating the marketplace. You may not copy or reuse another user\'s content without permission.',
    ],
  },
  {
    title: '12. Termination',
    paragraphs: [
      'You may close your account at any time. PhotoFind may suspend or terminate accounts that violate these Terms, with or without notice, particularly in cases of fraud, abuse, or repeated policy violations.',
    ],
  },
  {
    title: '13. Limitation of Liability',
    paragraphs: [
      'PhotoFind is not liable for the quality, timeliness, or outcome of services rendered between Clients and Providers, as PhotoFind is not a party to that underlying agreement. To the fullest extent permitted by law, PhotoFind\'s liability for any claim arising from use of the platform is limited to the fees paid to PhotoFind related to that claim.',
    ],
  },
  {
    title: '14. Changes to These Terms',
    paragraphs: [
      'PhotoFind may update these Terms from time to time. Continued use of the platform after changes take effect constitutes acceptance of the revised Terms. Material changes will be reflected by updating the "Last updated" date below.',
    ],
  },
  {
    title: '15. Governing Law',
    paragraphs: [
      'These Terms are governed by the laws of the Republic of the Philippines, without regard to conflict-of-law principles.',
    ],
  },
  {
    title: '16. Contact',
    paragraphs: [
      'Questions about these Terms can be sent to support@photofind.app.',
    ],
  },
];

export function TermsContent() {
  return (
    <div>
      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        This is a starting template, not legal advice. Have it reviewed by a qualified lawyer before relying on it for a live product.
      </div>
      <p className="text-xs text-gray-400 mb-6">Last updated: {LAST_UPDATED}</p>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-gray-900 mb-2">{section.title}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i} className="text-sm text-gray-600 mb-2 last:mb-0">
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TermsContent;
