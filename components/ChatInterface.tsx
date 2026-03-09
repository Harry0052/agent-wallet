'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useApp } from '@/lib/store';
import { ChatMessageBubble } from './ChatMessage';

const AUTO_SCROLL_THRESHOLD_PX = 80;

export function ChatInterface() {
  const { messages, sendMessage, isProcessing } = useApp();
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const isNearBottom = useCallback((): boolean => {
    const el = messagesRef.current;
    if (!el) return true;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    return remaining <= AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, []);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    shouldAutoScrollRef.current = true;
    sendMessage(input.trim());
    setInput('');
  };

  const handleSuggestion = (suggestion: string) => {
    if (isProcessing) return;
    shouldAutoScrollRef.current = true;
    setInput(suggestion);
    sendMessage(suggestion);
  };

  const handleMessagesScroll = () => {
    shouldAutoScrollRef.current = isNearBottom();
  };

  const suggestions = [
    'Buy me coffee',
    'Send $5 to Alice',
    'Order lunch under $15',
    'Get me a parking pass',
    'Add $25',
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        className="aw-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5 space-y-4"
      >
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
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
            placeholder={isProcessing ? 'Processing your request...' : 'Ask Agent Wallet to buy, send, fund, or review spend.'}
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
