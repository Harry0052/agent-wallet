"use client";

import { X, Trash2, MessageSquare } from "lucide-react";
import { useApp } from "@/lib/store";
import { fmtFull } from "@/lib/utils";

export function ChatHistoryPanel() {
  const { chatHistory, toggleChatHistory, loadChat, deleteChatFromHistory } =
    useApp();

  return (
    <div className="absolute inset-x-0 bottom-0 top-0 z-50 flex flex-col bg-[var(--aw-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--aw-border)] px-5 py-3 md:px-6">
        <h3 className="text-sm font-semibold text-[var(--aw-text)]">
          Chat History
        </h3>
        <button
          onClick={toggleChatHistory}
          className="aw-button-ghost h-7 w-7 p-0"
          aria-label="Close history"
        >
          <X size={15} />
        </button>
      </div>

      {/* List */}
      <div className="aw-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3 md:px-6">
        {chatHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare
              size={28}
              className="mb-3 text-[var(--aw-text-muted)]"
            />
            <p className="text-sm text-[var(--aw-text-soft)]">
              No saved conversations yet.
            </p>
            <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
              Your chats will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="flex min-h-full flex-col-reverse gap-2">
            {chatHistory.map((conv) => (
              <article
                key={conv.id}
                className="group relative w-full rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3 transition-colors hover:border-[var(--aw-border-strong)]"
              >
                <button
                  type="button"
                  onClick={() => loadChat(conv.id)}
                  className="w-full pr-7 text-left"
                >
                  <p className="truncate text-sm font-medium text-[var(--aw-text)]">
                    {conv.title}
                  </p>
                  {conv.preview && (
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--aw-text-soft)]">
                      {conv.preview}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                    {conv.messageCount} messages &middot; Updated {fmtFull(conv.updatedAt)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => deleteChatFromHistory(conv.id)}
                  className="absolute right-3 top-3 inline-flex rounded-md p-1 text-[var(--aw-text-muted)] opacity-75 transition-opacity hover:bg-[var(--aw-surface)] hover:text-[var(--aw-text-soft)] hover:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete "${conv.title}"`}
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
