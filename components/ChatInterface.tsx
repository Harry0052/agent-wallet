'use client';

import { useRef, useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useApp } from '@/lib/store';
import { ChatMessageBubble } from './ChatMessage';

export function ChatInterface() {
  const { messages, sendMessage, isProcessing } = useApp();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleSuggestion = (suggestion: string) => {
    if (isProcessing) return;
    setInput(suggestion);
    sendMessage(suggestion);
  };

  const suggestions = [
    'Buy me coffee',
    'Send $5 to Alice',
    'Order lunch under $15',
    'Get me a parking pass',
    'Add $25',
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="aw-scroll flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5 space-y-4">
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 2 && (
        <div className="px-4 pb-3 md:px-5">
          <p className="aw-kicker mb-2">Quick Commands</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestion(suggestion)}
                className="aw-button-secondary px-3 py-1.5 text-xs"
                disabled={isProcessing}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--aw-border)] bg-black/20 px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center gap-2 md:gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={isProcessing ? 'Running real execution...' : 'Ask Agent Wallet to buy, send, fund, or review spend.'}
            disabled={isProcessing}
            className="aw-input h-11 text-sm disabled:opacity-60"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="aw-button-primary h-11 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-1.5">
              Execute
              <ArrowUpRight size={14} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
