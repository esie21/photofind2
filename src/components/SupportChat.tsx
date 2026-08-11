import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Paperclip, Check, CheckCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import supportService, { SupportBooking, SupportCategory, SupportMessage, SupportTicket } from '../api/services/supportService';
import { API_CONFIG } from '../api/config';
import { io as createSocket, Socket } from 'socket.io-client';

interface SupportChatProps {
  mode: 'user' | 'admin';
  ticketId: string | null;
  onTicketCreated?: (ticket: SupportTicket) => void;
  className?: string;
}

type IntakeStep = 'category' | 'booking' | 'describe';

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'booking', label: 'Booking' },
  { value: 'payment', label: 'Payment' },
  { value: 'account', label: 'Account' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_LABELS: Record<string, string> = {
  booking: 'Booking',
  payment: 'Payment',
  account: 'Account',
  other: 'Other',
};

function BotBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-sm bg-gray-100 text-gray-900 px-4 py-3 rounded-2xl rounded-bl-none text-sm">
        {text}
      </div>
    </div>
  );
}

function ChoiceBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-sm bg-purple-600 text-white px-4 py-3 rounded-2xl rounded-br-none text-sm">
        {text}
      </div>
    </div>
  );
}

function Chip({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 text-sm rounded-full border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function SupportChat({ mode, ticketId, onTicketCreated, className }: SupportChatProps) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  const [intakeStep, setIntakeStep] = useState<IntakeStep>('describe');
  const [intakeCategory, setIntakeCategory] = useState<SupportCategory | null>(null);
  const [intakeBookingId, setIntakeBookingId] = useState<string | null>(null);
  const [intakeBookingLabel, setIntakeBookingLabel] = useState<string | null>(null);
  const [bookings, setBookings] = useState<SupportBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingCooldownRef = useRef<number | null>(null);
  const loadedTicketIdRef = useRef<string | null>(null);

  const staticUploadsBase = useMemo(
    () => `${API_CONFIG.BASE_URL.replace(/\/api$/i, '')}/uploads`,
    []
  );

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (typingCooldownRef.current) {
      window.clearTimeout(typingCooldownRef.current);
      typingCooldownRef.current = null;
    }
    setIsTyping(false);
    setIsOnline(false);
  };

  const setupSocket = (activeTicketId: string) => {
    const token = localStorage.getItem('authToken');
    if (!token || !user) return;

    const socket = createSocket(API_CONFIG.SOCKET_URL, {
      transports: ['websocket'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('support:join', { ticketId: activeTicketId });
      socket.emit('support:read', { ticketId: activeTicketId });
    });

    socket.on('support:message', (payload: any) => {
      if (String(payload?.ticketId ?? '') !== String(activeTicketId)) return;
      const incoming = payload?.message as SupportMessage;
      if (!incoming?.id) return;
      setMessages((prev) => (prev.some((m) => String(m.id) === String(incoming.id)) ? prev : [...prev, incoming]));
      if (payload?.ticketStatus) {
        setTicket((prev) => (prev ? { ...prev, status: payload.ticketStatus } : prev));
      }
      const mine = String(incoming.sender_id ?? '') === String(user.id);
      if (!mine) socket.emit('support:read', { ticketId: activeTicketId });
    });

    socket.on('support:typing', (payload: any) => {
      if (String(payload?.ticketId ?? '') !== String(activeTicketId)) return;
      if (String(payload?.userId ?? '') === String(user.id)) return;
      const next = Boolean(payload?.isTyping);
      setIsTyping(next);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      if (next) typingTimeoutRef.current = window.setTimeout(() => setIsTyping(false), 2000);
    });

    socket.on('support:read', (payload: any) => {
      if (String(payload?.ticketId ?? '') !== String(activeTicketId)) return;
      const readerId = String(payload?.readerId ?? '');
      if (!readerId || readerId === String(user.id)) return;
      const readAt = String(payload?.readAt || new Date().toISOString());
      setMessages((prev) =>
        prev.map((m) => {
          const isFromMe = String(m.sender_id ?? '') === String(user.id);
          if (!isFromMe || m.read_at) return m;
          return { ...m, read_at: readAt };
        })
      );
    });

    socket.on('support:presence', (payload: any) => {
      if (String(payload?.ticketId ?? '') !== String(activeTicketId)) return;
      const presenceUserId = String(payload?.userId ?? '');
      if (!presenceUserId || presenceUserId === String(user.id)) return;
      setIsOnline(Boolean(payload?.online));
    });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, intakeStep]);

  useEffect(() => {
    let cancelled = false;
    cleanupSocket();
    setError(null);

    if (!ticketId) {
      setTicket(null);
      setMessages([]);
      loadedTicketIdRef.current = null;
      if (mode === 'user') {
        setIntakeStep('category');
        setIntakeCategory(null);
        setIntakeBookingId(null);
        setIntakeBookingLabel(null);
      }
      return () => {
        cancelled = true;
      };
    }

    if (loadedTicketIdRef.current === ticketId) {
      setupSocket(ticketId);
      return () => {
        cancelled = true;
        cleanupSocket();
      };
    }

    setLoading(true);
    (async () => {
      try {
        const { ticket: t, messages: msgs } = await supportService.getMessages(ticketId);
        if (cancelled) return;
        setTicket(t);
        setMessages(msgs);
        setIntakeStep('describe');
        loadedTicketIdRef.current = ticketId;
        setupSocket(ticketId);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Unable to load conversation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      cleanupSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, user?.id, mode]);

  const chooseCategory = (cat: SupportCategory) => {
    setIntakeCategory(cat);
    if (cat === 'booking') {
      setIntakeStep('booking');
      setLoadingBookings(true);
      supportService
        .getMyBookings()
        .then((list) => setBookings(list))
        .catch(() => setBookings([]))
        .finally(() => setLoadingBookings(false));
    } else {
      setIntakeStep('describe');
    }
  };

  const chooseBooking = (booking: SupportBooking | null) => {
    setIntakeBookingId(booking ? booking.id : null);
    setIntakeBookingLabel(booking ? booking.service_title || 'Booking' : 'Not booking-specific');
    setIntakeStep('describe');
  };

  const handleSend = async () => {
    if (!user || sending) return;
    const trimmed = message.trim();

    if (!ticket) {
      if (!trimmed) return;
      setSending(true);
      try {
        const { ticket: newTicket, message: firstMsg } = await supportService.createTicket({
          message: trimmed,
          category: intakeCategory ?? undefined,
          booking_id: intakeBookingId ?? undefined,
        });
        setTicket(newTicket);
        setMessages([firstMsg]);
        loadedTicketIdRef.current = newTicket.id;
        setupSocket(newTicket.id);
        onTicketCreated?.(newTicket);
        setMessage('');
      } catch (err: any) {
        setError(err?.message || 'Failed to start conversation.');
      } finally {
        setSending(false);
      }
      return;
    }

    if (!trimmed && !pendingFile) return;
    setSending(true);
    try {
      const sent = await supportService.sendMessage({ ticketId: ticket.id, content: trimmed || undefined, file: pendingFile || undefined });
      setMessages((prev) => (prev.some((m) => String(m.id) === String(sent.id)) ? prev : [...prev, sent]));
      setMessage('');
      setPendingFile(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const onTyping = (value: string) => {
    setMessage(value);
    if (!ticket) return;
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('support:typing', { ticketId: ticket.id, isTyping: true });
    if (typingCooldownRef.current) window.clearTimeout(typingCooldownRef.current);
    typingCooldownRef.current = window.setTimeout(() => {
      socket.emit('support:typing', { ticketId: ticket.id, isTyping: false });
    }, 800);
  };

  const renderContentWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) =>
      /^https?:\/\/[^\s]+$/.test(part) ? (
        <a key={`${part}-${index}`} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">
          {part}
        </a>
      ) : (
        <span key={`${index}-${part}`}>{part}</span>
      )
    );
  };

  const showIntake = mode === 'user' && !ticket;
  const canType = Boolean(ticket) || intakeStep === 'describe';
  const firstName = user?.name?.split(' ')[0] || 'there';

  const ticketMeta = ticket?.category
    ? ticket.category === 'booking' && ticket.service_title
      ? `${CATEGORY_LABELS[ticket.category] || ticket.category} · ${ticket.service_title}`
      : CATEGORY_LABELS[ticket.category] || ticket.category
    : null;

  const headerTitle = mode === 'admin' ? ticket?.user_name || 'Select a conversation' : 'Support team';
  const headerSubtitle =
    mode === 'admin'
      ? ticket?.user_email || ''
      : ticket
        ? isOnline
          ? 'Online'
          : 'We usually reply within a few hours'
        : 'New conversation';

  return (
    <div className={`bg-white rounded-2xl shadow-sm flex flex-col ${className || 'h-[560px]'}`}>
      <div className="flex items-center gap-3 p-4 border-b border-gray-200">
        <span className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0 text-sm font-medium">
          {mode === 'admin' ? (ticket?.user_name || '?').charAt(0).toUpperCase() : 'S'}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-gray-900 text-sm truncate">{headerTitle}</h3>
          <p className="text-xs text-gray-500 truncate">{headerSubtitle}</p>
        </div>
        {ticket && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
          </div>
        )}
      </div>

      {ticketMeta && (
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">{ticketMeta}</span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading conversation…</span>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        )}

        {mode === 'admin' && !ticketId && !loading && (
          <div className="text-sm text-gray-500">Select a conversation from the list to start replying.</div>
        )}

        {showIntake && !loading && (
          <div className="space-y-3">
            <BotBubble text={`Hi ${firstName}! What do you need help with today?`} />
            {intakeCategory && <ChoiceBubble text={CATEGORIES.find((c) => c.value === intakeCategory)?.label || ''} />}
            {intakeStep === 'category' && (
              <div className="flex flex-wrap gap-2 pl-1">
                {CATEGORIES.map((c) => (
                  <Chip key={c.value} onClick={() => chooseCategory(c.value)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            )}

            {intakeCategory === 'booking' && (
              <>
                <BotBubble text="Which booking is it about?" />
                {intakeBookingLabel && <ChoiceBubble text={intakeBookingLabel} />}
                {intakeStep === 'booking' && (
                  <div className="flex flex-wrap gap-2 pl-1">
                    {loadingBookings && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    {!loadingBookings &&
                      bookings.map((b) => (
                        <Chip key={b.id} onClick={() => chooseBooking(b)}>
                          {b.service_title || 'Booking'}
                        </Chip>
                      ))}
                    {!loadingBookings && <Chip onClick={() => chooseBooking(null)}>Not booking-specific</Chip>}
                  </div>
                )}
              </>
            )}

            {intakeStep === 'describe' && <BotBubble text="Great — describe the issue below and our team will reply here." />}
          </div>
        )}

        {!loading &&
          !showIntake &&
          messages.length === 0 &&
          mode === 'admin' &&
          ticketId && <div className="text-sm text-gray-500">No messages yet.</div>}

        {messages.map((msg) => {
          const isMine = user && String(msg.sender_id) === String(user.id);
          const isSystem = msg.sender_role === 'system';
          const timestamp = new Date(msg.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const attachmentUrl = msg.attachment_url ? `${staticUploadsBase}/${msg.attachment_url}` : null;

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">{msg.content}</div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-sm">
                <div
                  className={`px-4 py-3 rounded-2xl ${
                    isMine ? 'bg-purple-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-900 rounded-bl-none'
                  }`}
                >
                  {msg.content && <p className="text-sm whitespace-pre-wrap break-words">{renderContentWithLinks(msg.content)}</p>}
                  {attachmentUrl && msg.attachment_type === 'image' && (
                    <img src={attachmentUrl} alt={msg.attachment_name || 'attachment'} className="mt-2 max-h-56 rounded-xl" />
                  )}
                  {attachmentUrl && msg.attachment_type === 'video' && (
                    <video src={attachmentUrl} controls className="mt-2 max-h-64 rounded-xl w-full" />
                  )}
                  {attachmentUrl && msg.attachment_type === 'file' && (
                    <a
                      href={attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`mt-2 block text-sm underline ${isMine ? 'text-white' : 'text-purple-700'}`}
                    >
                      {msg.attachment_name || 'Download file'}
                    </a>
                  )}
                </div>
                <div className={`flex items-center gap-1 mt-1 text-xs text-gray-500 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <span>{timestamp}</span>
                  {isMine && (msg.read_at ? <CheckCheck className="w-4 h-4 text-blue-500" /> : <Check className="w-4 h-4" />)}
                </div>
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-none">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPendingFile(file);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
            disabled={!ticket || sending || loading}
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2">
            <textarea
              value={message}
              onChange={(e) => onTyping(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={!user ? 'Sign in to start messaging' : !canType ? 'Answer the steps above to continue' : 'Type a message...'}
              className="w-full bg-transparent outline-none resize-none text-gray-900 placeholder:text-gray-500"
              rows={1}
              disabled={!user || sending || loading || !canType}
            />
            {pendingFile && (
              <div className="mt-2 text-xs text-gray-600 flex items-center justify-between gap-2">
                <span className="truncate">Attached: {pendingFile.name}</span>
                <button type="button" onClick={() => setPendingFile(null)} className="text-red-600 hover:text-red-700">
                  Remove
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!user || sending || loading || !canType || (!message.trim() && !pendingFile)}
            className="p-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white transition-colors"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SupportChat;
