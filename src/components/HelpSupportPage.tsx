import { useState, useEffect } from 'react';
import { Mail, MessageSquare, ChevronDown, Send, Loader2, Clock } from 'lucide-react';
import supportService, { SupportTicket } from '../api/services/supportService';
import { useToast } from '../context/ToastContext';

const FAQS = [
  {
    question: 'How do I book a service provider?',
    answer: 'Browse services from the homepage or Browse Services page, open a provider\'s profile, pick a service, then choose an available time slot to request or instantly book.',
  },
  {
    question: 'What\'s the difference between Request Approval and Instant Booking?',
    answer: 'Request Approval sends your booking to the provider for review before it\'s confirmed. Instant Booking reserves the slot immediately, no waiting required.',
  },
  {
    question: 'How do I cancel or reschedule a booking?',
    answer: 'Open the booking from your dashboard\'s bookings list — reschedule and cancellation options appear there depending on the booking\'s current status.',
  },
  {
    question: 'How do payouts work for providers?',
    answer: 'Completed bookings add to your wallet balance. Request a payout via GCash, PayMaya, or bank transfer from the Wallet & Earnings tab.',
  },
  {
    question: 'What if there\'s a dispute with a booking?',
    answer: 'When a provider marks a booking complete, the client can raise a dispute instead of confirming if something\'s wrong. Our team reviews the evidence and resolves it — you\'ll be notified once it\'s settled.',
  },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-yellow-100 text-yellow-700' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-700' },
};

interface HelpSupportPageProps {
  onGoToBookings?: () => void;
}

export function HelpSupportPage({ onGoToBookings }: HelpSupportPageProps = {}) {
  const toast = useToast();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      const resp = await supportService.getMyTickets();
      setTickets(resp.data);
    } catch (err) {
      console.error('Failed to load support tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast.error('Missing info', 'Please fill in both a subject and a message.');
      return;
    }
    setSubmitting(true);
    try {
      await supportService.createTicket({ subject: subject.trim(), message: message.trim() });
      toast.success('Message sent', "We've received your message and will reply here soon.");
      setSubject('');
      setMessage('');
      await loadTickets();
    } catch (err: any) {
      toast.error('Failed to send', err.message || 'Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-1">Help & Support</h1>
        <p className="text-sm text-gray-500 mb-8">Find answers to common questions, or reach out to our team directly.</p>

        {/* Contact options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="mailto:support@photofind.app"
            className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow"
          >
            <span className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5" />
            </span>
            <div>
              <div className="text-sm text-gray-900">Email support</div>
              <div className="text-xs text-gray-500">support@photofind.app</div>
            </div>
          </a>
          <button
            type="button"
            onClick={onGoToBookings}
            disabled={!onGoToBookings}
            className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow text-left disabled:cursor-default disabled:hover:shadow-sm"
          >
            <span className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5" />
            </span>
            <div>
              <div className="text-sm text-gray-900">Message a provider</div>
              <div className="text-xs text-gray-500">Go to a booking and use the Message button</div>
            </div>
          </button>
        </div>

        {/* Contact form */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-8">
          <h2 className="text-gray-900 mb-1">Send us a message</h2>
          <p className="text-sm text-gray-500 mb-4">We typically reply within 1-2 business days.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="support-subject" className="block text-sm text-gray-700 mb-1.5">Subject</label>
              <input
                id="support-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's this about?"
                maxLength={255}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label htmlFor="support-message" className="block text-sm text-gray-700 mb-1.5">Message</label>
              <textarea
                id="support-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue or question..."
                rows={4}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? 'Sending...' : 'Send message'}
            </button>
          </form>
        </div>

        {/* Ticket history */}
        {!loadingTickets && tickets.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-8">
            <h2 className="text-gray-900 mb-4">Your requests</h2>
            <div className="space-y-4">
              {tickets.map((ticket) => {
                const badge = STATUS_BADGE[ticket.status] || STATUS_BADGE.open;
                return (
                  <div key={ticket.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <span className="text-sm font-medium text-gray-900">{ticket.subject}</span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{ticket.message}</p>
                    {ticket.admin_reply && (
                      <div className="mt-3 bg-purple-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-purple-700 mb-1">Support team replied</p>
                        <p className="text-sm text-purple-900 whitespace-pre-wrap">{ticket.admin_reply}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FAQ */}
        <div className="bg-white rounded-2xl shadow-sm p-2">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={faq.question} className={index > 0 ? 'border-t border-gray-100' : ''}>
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-gray-50 rounded-xl transition-colors"
                >
                  <span className="text-sm text-gray-900">{faq.question}</span>
                  <ChevronDown
                    className="w-4 h-4 text-gray-400 flex-shrink-0 transition-transform"
                    style={{ transform: isOpen ? 'rotate(180deg)' : undefined }}
                  />
                </button>
                {isOpen && (
                  <p className="text-sm text-gray-600 p-4">{faq.answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HelpSupportPage;
