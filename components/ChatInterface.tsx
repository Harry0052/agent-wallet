'use client';

import { useRef, useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { ChatMessageBubble } from './ChatMessage';

export function ChatInterface() {
  const { messages, sendMessage, isProcessing } = useApp();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    sendMessage(input.trim());
    setInput('');
  };

  const suggestions = [
    'Buy me coffee',
    'Send $5 to Alice',
    'Order lunch under $15',
    'Get me a parking pass',
    'Add $25',
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions (only when few messages) */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => { setInput(s); sendMessage(s); }}
              className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-gray-300 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={isProcessing ? 'Working on it...' : 'What do you need?'}
            disabled={isProcessing}
            className="flex-1 bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
