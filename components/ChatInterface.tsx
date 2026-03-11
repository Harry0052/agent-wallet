"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ArrowUpRight } from "lucide-react";
import { useApp } from "@/lib/store";
import { ChatMessageBubble } from "./ChatMessage";

const AUTO_SCROLL_THRESHOLD_PX = 80;

export function ChatInterface() {
  const { messages, sendMessage, isProcessing } = useApp();
  const [input, setInput] = useState("");
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
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, []);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    shouldAutoScrollRef.current = true;
    sendMessage(input.trim());
    setInput("");
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
    "Find the best note taking app under 15 dollars a month",
    "Compare Notion and Obsidian for college note taking",
    "Sign in to Indeed, shortlist 3 senior software engineers with TypeScript and AWS, and export to Google Sheets",
    "Send Liz 5 dollars on Cash App",
    "Cancel my Grammarly subscription and show savings",
    "Top up my wallet by 25 dollars",
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        className="aw-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6 md:py-6 space-y-4"
      >
        {messages.length <= 2 && (
          <section className="rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-4 md:px-5 md:py-5">
            <p className="aw-kicker text-[0.6rem]">Start</p>
            <h3 className="mt-1 text-base font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
              Start with what you need
            </h3>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--aw-text-soft)]">
              Add a budget or rules when needed. Agent Wallet handles planning,
              execution, and approvals.
            </p>
          </section>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {messages.length <= 2 && (
        <div className="px-5 pb-4 md:px-6">
          <p className="aw-kicker mb-2">Quick Tasks</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestion(suggestion)}
                className="aw-button-secondary justify-start px-3 py-2 text-left text-xs"
                disabled={isProcessing}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-5 py-4 md:px-6 md:py-5">
        <div className="flex items-center gap-2 md:gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={
              isProcessing
                ? "Live execution in progress..."
                : "Describe what you want to do."
            }
            disabled={isProcessing}
            className="aw-input h-11 text-sm disabled:opacity-60"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="aw-button-primary h-11 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="inline-flex items-center gap-1.5">
              Run Task
              <ArrowUpRight size={14} />
            </span>
          </button>
        </div>
        <p className="mt-2.5 text-[11px] text-[var(--aw-text-muted)]">
          Press Enter to run.
        </p>
      </div>
    </div>
  );
}
