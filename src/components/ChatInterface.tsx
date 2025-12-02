import { useState } from 'react';
import { X, Send, Paperclip, MoreVertical, Check, CheckCheck } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface ChatInterfaceProps {
  provider: any;
  onClose: () => void;
}

export function ChatInterface({ provider, onClose }: ChatInterfaceProps) {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const messages = [
    {
      id: 1,
      sender: 'system',
      text: 'Booking request sent for Wedding Photography on Dec 15, 2025 at 2:00 PM',
      timestamp: '10:30 AM',
      type: 'system'
    },
    {
      id: 2,
      sender: 'provider',
      text: "Hi! Thank you for your booking request. I'd be happy to photograph your wedding!",
      timestamp: '10:32 AM',
      read: true
    },
    {
      id: 3,
      sender: 'client',
      text: "Great! Can you tell me more about your wedding packages?",
      timestamp: '10:35 AM',
      read: true
    },
    {
      id: 4,
      sender: 'provider',
      text: "Of course! I offer three main packages:\n\n1. Basic: 4 hours coverage, 200+ edited photos\n2. Standard: 8 hours coverage, 400+ edited photos, engagement session\n3. Premium: Full day coverage, 600+ edited photos, engagement session, second photographer",
      timestamp: '10:38 AM',
      read: true
    },
    {
      id: 5,
      sender: 'client',
      text: "The standard package sounds perfect. What's the pricing?",
      timestamp: '10:42 AM',
      read: true
    },
    {
      id: 6,
      sender: 'provider',
      text: "The standard package is $2,400. This includes all edited high-resolution photos delivered within 4 weeks.",
      timestamp: '10:45 AM',
      read: false
    },
  ];

  const handleSend = () => {
    if (message.trim()) {
      // Handle send logic
      setMessage('');
      setIsTyping(true);
      setTimeout(() => setIsTyping(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl h-[600px] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 p-4 border-b border-gray-200">
          <ImageWithFallback
            src={provider.image}
            alt={provider.name}
            className="w-12 h-12 object-cover rounded-full"
          />
          <div className="flex-1">
            <h3 className="text-gray-900">{provider.name}</h3>
            <p className="text-sm text-gray-500">{provider.featured_service?.title || provider.service}</p>
          </div>
          <button className="p-2 hover:bg-gray-100 rounded-lg">
            <MoreVertical className="w-5 h-5 text-gray-600" />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm max-w-md text-center">
                    {msg.text}
                  </div>
                </div>
              );
            }

            const isClient = msg.sender === 'client';
            return (
              <div key={msg.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm ${isClient ? 'order-2' : 'order-1'}`}>
                  <div className={`px-4 py-3 rounded-2xl ${
                    isClient 
                      ? 'bg-purple-600 text-white rounded-br-none' 
                      : 'bg-gray-100 text-gray-900 rounded-bl-none'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  </div>
                  <div className={`flex items-center gap-1 mt-1 text-xs text-gray-500 ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <span>{msg.timestamp}</span>
                    {isClient && (
                      msg.read ? (
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
            <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
              <Paperclip className="w-5 h-5" />
            </button>
            <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message..."
                className="w-full bg-transparent outline-none resize-none text-gray-900 placeholder:text-gray-500"
                rows={1}
              />
            </div>
            <button 
              onClick={handleSend}
              className="p-3 bg-purple-600 hover:bg-purple-700 rounded-xl text-white transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
