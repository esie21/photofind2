import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Paperclip, MoreVertical, Check, CheckCheck, Loader2 } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useAuth } from '../context/AuthContext';
import messageService, { ChatMessage, Conversation } from '../api/services/messageService';
import chatService, { BookingChatMessage } from '../api/services/chatService';
import { API_CONFIG } from '../api/config';
import { io as createSocket, Socket } from 'socket.io-client';

interface ChatInterfaceProps {
  provider: any;
  bookingId?: number;
  onClose: () => void;
}

export function ChatInterface({ provider, bookingId: bookingIdProp, onClose }: ChatInterfaceProps) {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<ChatMessage | BookingChatMessage>>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const otherTypingTimeoutRef = useRef<number | null>(null);
  const typingCooldownRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = useAuth();

const participantId = useMemo(() => {
  // Primary: use the id field (works for both UUID and numeric IDs)
  if (provider?.id) return provider.id;
  
  // Fallbacks for other structures
  if (provider?.user_id) return provider.user_id;
  if (provider?.other_user?.id) return provider.other_user.id;
  if (provider?.provider_id) return provider.provider_id;
  if (provider?.providerId) return provider.providerId;
  
  // Log for debugging
  console.warn('Unable to extract participant ID from provider:', provider);
  
  return null;
}, [provider]);

  const bookingId = useMemo(() => {
    if (bookingIdProp) return bookingIdProp;
    if (provider?.booking_id) return Number(provider.booking_id);
    if (provider?.bookingId) return Number(provider.bookingId);
    if (provider?.booking?.id) return Number(provider.booking.id);
    return null;
  }, [bookingIdProp, provider]);

  const staticUploadsBase = useMemo(() => {
    return `${API_CONFIG.BASE_URL.replace(/\/api$/i, '')}/uploads`;
  }, []);

  const headerName = provider?.name || conversation?.other_user?.name || 'Conversation';
  const headerSubtitle =
    provider?.featured_service?.title ||
    provider?.service ||
    conversation?.other_user?.id
      ? 'Direct chat'
      : '';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    let isCancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const cleanupSocket = () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (otherTypingTimeoutRef.current) {
        window.clearTimeout(otherTypingTimeoutRef.current);
        otherTypingTimeoutRef.current = null;
      }
      if (typingCooldownRef.current) {
        window.clearTimeout(typingCooldownRef.current);
        typingCooldownRef.current = null;
      }
    };

    const bootstrap = async () => {
      setError(null);
      setIsOnline(false);
      setIsTyping(false);

      if (!user) {
        setLoading(false);
        setError('Please sign in to send messages.');
        return;
      }

      if (bookingId) {
        setLoading(true);
        cleanupSocket();
        try {
          const history = await chatService.getHistory(bookingId, 200);
          if (isCancelled) return;
          setConversation(null);
          setMessages(history.messages);

          const token = localStorage.getItem('authToken');
          if (token) {
            const socket = createSocket(API_CONFIG.BASE_URL.replace(/\/api$/i, ''), {
              transports: ['websocket'],
              auth: { token },
            });
            socketRef.current = socket;

            socket.on('connect', () => {
              socket.emit('chat:join', { bookingId });
              socket.emit('chat:read', { bookingId });
            });

            socket.on('chat:message', (payload: any) => {
              if (String(payload?.bookingId ?? '') !== String(bookingId)) return;
              const incoming = payload?.message as BookingChatMessage;
              if (!incoming?.id) return;
              setMessages((prev) => {
                if (prev.some((m: any) => String(m.id) === String(incoming.id))) return prev;
                return [...prev, incoming];
              });
              const mine = String(incoming.sender_id ?? '') === String(user.id);
              if (!mine) {
                socket.emit('chat:read', { bookingId });
              }
            });

            socket.on('chat:typing', (payload: any) => {
              if (String(payload?.bookingId ?? '') !== String(bookingId)) return;
              const typingUserId = String(payload?.userId ?? '');
              if (typingUserId === String(user.id)) return;
              const next = Boolean(payload?.isTyping);
              setIsTyping(next);
              if (otherTypingTimeoutRef.current) {
                window.clearTimeout(otherTypingTimeoutRef.current);
              }
              if (next) {
                otherTypingTimeoutRef.current = window.setTimeout(() => setIsTyping(false), 2000);
              }
            });

            socket.on('chat:read', (payload: any) => {
              if (String(payload?.bookingId ?? '') !== String(bookingId)) return;
              const readAt = String(payload?.readAt || new Date().toISOString());
              const readerId = String(payload?.readerId ?? '');
              if (!readerId || readerId === String(user.id)) return;
              setMessages((prev) =>
                prev.map((m: any) => {
                  const senderId = m.sender_id;
                  const isFromMe = String(senderId ?? '') === String(user.id);
                  if (!isFromMe) return m;
                  if (m.read_at) return m;
                  return { ...m, read_at: readAt };
                })
              );
            });

            socket.on('chat:presence', (payload: any) => {
              if (String(payload?.bookingId ?? '') !== String(bookingId)) return;
              const presenceUserId = String(payload?.userId ?? '');
              if (!presenceUserId || presenceUserId === String(user.id)) return;
              setIsOnline(Boolean(payload?.online));
            });
          }
        } catch (err: any) {
          if (!isCancelled) {
            setError(err?.message || 'Unable to load chat.');
          }
        } finally {
          if (!isCancelled) setLoading(false);
        }

        return;
      }

      setLoading(false);
      setError('This chat is only available for bookings.');
    };

    bootstrap();

    return () => {
      isCancelled = true;
      if (interval) clearInterval(interval);
      cleanupSocket();
    };
  }, [participantId, user, bookingId]);

  const handleSend = async () => {
    if (!user || sending) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    if (bookingId) {
      setSending(true);
      try {
        const res = await chatService.sendMessage({ bookingId, content: trimmed });
        setMessages((prev) => {
          if (prev.some((m: any) => String(m.id) === String(res.data.id))) return prev;
          return [...prev, res.data];
        });
        setMessage('');
      } catch (err: any) {
        setError(err?.message || 'Failed to send message.');
      } finally {
        setSending(false);
      }
      return;
    }

    setError('This chat is only available for bookings.');
  };

  const handleUpload = async (file: File) => {
    if (!user || sending) return;
    if (!bookingId) {
      setError('Attachments are only available for booking chat.');
      return;
    }
    setSending(true);
    try {
      const res = await chatService.sendMessage({ bookingId, file });
      setMessages((prev) => {
        if (prev.some((m: any) => String(m.id) === String(res.data.id))) return prev;
        return [...prev, res.data];
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to upload.');
    } finally {
      setSending(false);
    }
  };

  const onTyping = (value: string) => {
    setMessage(value);
    if (!bookingId) return;
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('chat:typing', { bookingId, isTyping: true });
    if (typingCooldownRef.current) {
      window.clearTimeout(typingCooldownRef.current);
    }
    typingCooldownRef.current = window.setTimeout(() => {
      socket.emit('chat:typing', { bookingId, isTyping: false });
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl h-[600px] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 p-4 border-b border-gray-200">
          <ImageWithFallback
            src={provider.image || provider.profile_image || conversation?.other_user?.profile_image}
            alt={headerName}
            className="w-12 h-12 object-cover rounded-full"
          />
          <div className="flex-1">
            <h3 className="text-gray-900">{headerName}</h3>
            <p className="text-sm text-gray-500">{headerSubtitle}</p>
          </div>
          {bookingId && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
              <div className="text-xs text-gray-500">{isOnline ? 'Online' : 'Offline'}</div>
            </div>
          )}
          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <MoreVertical className="w-5 h-5 text-gray-600" />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading conversation…</span>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {!loading && !error && messages.length === 0 && (
            <div className="text-sm text-gray-500">Start the conversation by sending a message.</div>
          )}

          {messages.map((msg: any) => {
            const isMine = user && String(msg.sender_id) === String(user.id);
            const timestamp = new Date(msg.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const attachmentUrl = msg.attachment_url ? `${staticUploadsBase}/${msg.attachment_url}` : null;
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm ${isMine ? 'order-2' : 'order-1'}`}>
                  <div
                    className={`px-4 py-3 rounded-2xl ${
                      isMine
                        ? 'bg-purple-600 text-white rounded-br-none'
                        : 'bg-gray-100 text-gray-900 rounded-bl-none'
                    }`}
                  >
                    {msg.is_system ? (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <>
                        {msg.content && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                        {attachmentUrl && msg.attachment_type === 'image' && (
                          <img src={attachmentUrl} alt={msg.attachment_name || 'attachment'} className="mt-2 max-h-56 rounded-xl" />
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
                      </>
                    )}
                  </div>
                  <div
                    className={`flex items-center gap-1 mt-1 text-xs text-gray-500 ${
                      isMine ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span>{timestamp}</span>
                    {isMine && (
                      msg.read_at ? (
                        <CheckCheck className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-none">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleUpload(file);
                }
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
              disabled={!bookingId || sending || loading}
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
                placeholder={user ? 'Type a message...' : 'Sign in to start messaging'}
                className="w-full bg-transparent outline-none resize-none text-gray-900 placeholder:text-gray-500"
                rows={1}
                disabled={!user || sending || loading}
              />
            </div>
            <button 
              onClick={handleSend}
              disabled={!user || sending || loading || !bookingId}
              className="p-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white transition-colors"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
