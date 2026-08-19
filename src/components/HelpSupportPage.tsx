import { useEffect, useRef, useState } from 'react';
import { Mail, MessageSquare, ChevronDown, Plus } from 'lucide-react';
import supportService, { SupportTicket } from '../api/services/supportService';
import { SupportChat } from './SupportChat';

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
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const hasAutoSelected = useRef(false);

  const loadTickets = async () => {
    // Only the first load shows a spinner; a background refresh shouldn't blank the list.
    if (!hasAutoSelected.current) setLoadingTickets(true);
    try {
      const resp = await supportService.getMyTickets();
      setTickets(resp.data);
      setTicketsError(null);
      if (!hasAutoSelected.current) {
        hasAutoSelected.current = true;
        if (resp.data.length > 0) setActiveTicketId(resp.data[0].id);
      }
    } catch (err: any) {
      // This was a console.error and nothing else, so a failed fetch looked exactly like
      // having no conversations at all - with no hint that anything had gone wrong.
      console.error('Failed to load support tickets:', err);
      setTicketsError(err?.message || 'Could not load your conversations.');
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTicketCreated = (ticket: SupportTicket) => {
    setActiveTicketId(ticket.id);
    loadTickets();
  };

  /**
   * Refreshes the list after thread activity, coalescing bursts.
   *
   * The list was loaded once on mount and never again, so unread dots, last-message
   * text and status badges were frozen at whatever they were when the page opened -
   * including a ticket that support had since resolved. A rapid exchange would otherwise
   * refetch on every single message, hence the delay.
   */
  const refreshTimerRef = useRef<number | null>(null);
  const scheduleRefresh = () => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      loadTickets();
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-gray-900 mb-1">Help & Support</h1>
        <p className="text-sm text-gray-500 mb-8">Find answers to common questions, or chat with our team directly.</p>

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

        {/* Conversation list */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-gray-900">Chat with support</h2>
          <button
            type="button"
            onClick={() => setActiveTicketId(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New conversation
          </button>
        </div>

        {ticketsError && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{ticketsError}</span>
            <button
              type="button"
              onClick={loadTickets}
              className="flex-shrink-0 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loadingTickets && tickets.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
            {tickets.map((ticket) => {
              const badge = STATUS_BADGE[ticket.status] || STATUS_BADGE.open;
              const isActive = ticket.id === activeTicketId;
              return (
                <button
                  key={ticket.id}
                  onClick={() => setActiveTicketId(ticket.id)}
                  className={`flex-shrink-0 text-left px-3 py-2 rounded-xl border transition-colors max-w-[220px] ${
                    isActive ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm text-gray-900 truncate">{ticket.subject}</span>
                    {(ticket.unread_count || 0) > 0 && <span className="w-2 h-2 rounded-full bg-purple-600 flex-shrink-0" />}
                  </div>
                  <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${badge.className}`}>{badge.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mb-8">
          <SupportChat
            mode="user"
            ticketId={activeTicketId}
            onTicketCreated={handleTicketCreated}
            onActivity={scheduleRefresh}
          />
        </div>

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
