import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { ChatInterface } from './ChatInterface';
import messageService, { Conversation } from '../api/services/messageService';
import { getUploadUrl } from '../api/config';

export function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  const fetchConversations = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await messageService.listConversations();
      setConversations(data || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load conversations');
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [user?.id]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aTime = new Date(a.last_message?.created_at || a.updated_at).getTime();
      const bTime = new Date(b.last_message?.created_at || b.updated_at).getTime();
      return bTime - aTime;
    });
  }, [conversations]);

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-600">
          Please sign in to view your messages.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-gray-900">Messages</h2>
          <button
            onClick={fetchConversations}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 border border-gray-100 rounded-xl">
                  <div className="h-4 w-1/3 bg-gray-200 rounded animate-pulse mb-2" />
                  <div className="h-3 w-2/3 bg-gray-200 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center text-red-600 bg-red-50 rounded-xl border border-red-200">
              {error}
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              No conversations yet.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedConversations.map((conversation) => {
                const other = conversation.other_user;
                const imageUrl = other?.profile_image ? getUploadUrl(other.profile_image) : '';
                return (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedConversation(conversation)}
                    className="w-full p-4 border border-gray-200 rounded-xl hover:border-purple-300 hover:bg-purple-50/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <ImageWithFallback
                        src={imageUrl}
                        alt={other?.name || 'User'}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-900 truncate">{other?.name || 'User'}</p>
                        <p className="text-sm text-gray-600 truncate">
                          {conversation.last_message?.content || 'No messages yet'}
                        </p>
                      </div>
                      <p className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(conversation.last_message?.created_at || conversation.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedConversation?.other_user && (
        <ChatInterface
          provider={{
            id: selectedConversation.other_user.id,
            name: selectedConversation.other_user.name,
            image: selectedConversation.other_user.profile_image
              ? getUploadUrl(selectedConversation.other_user.profile_image)
              : '',
          }}
          onClose={() => setSelectedConversation(null)}
        />
      )}
    </div>
  );
}
