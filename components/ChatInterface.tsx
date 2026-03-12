"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Clock, Plus, Sparkles, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { ChatMessage } from "@/lib/types";
import { cn, fmtTime, uid } from "@/lib/utils";
import { ChatMessageBubble } from "./ChatMessage";
import { ChatHistoryPanel } from "./ChatHistoryPanel";

const MAX_TASK_WORKSPACES = 4;

type PanelVisualState = "running" | "queued" | "attention" | "done";

interface TaskWorkspacePanel {
  id: string;
  prompt: string;
  createdAt: string;
  startIndex: number | null;
}

interface TaskWorkspacePanelView extends TaskWorkspacePanel {
  messages: ChatMessage[];
  state: PanelVisualState;
  isActive: boolean;
}

function panelStateLabel(state: PanelVisualState): string {
  if (state === "running") return "Running";
  if (state === "queued") return "Queued";
  if (state === "attention") return "Needs Attention";
  return "Complete";
}

function panelStateChipClass(state: PanelVisualState): string {
  if (state === "running") {
    return "border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]";
  }

  if (state === "queued") {
    return "border-[rgba(14,116,144,0.28)] bg-[rgba(14,116,144,0.1)] text-[rgb(14,116,144)]";
  }

  if (state === "attention") {
    return "border-[rgba(234,179,8,0.32)] bg-[rgba(234,179,8,0.14)] text-[rgb(180,83,9)]";
  }

  return "border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.12)] text-[rgb(5,150,105)]";
}

export function ChatInterface() {
  const {
    messages,
    sendMessage,
    isProcessing,
    queuedTaskCount,
    activeTask,
    activeConversationId,
    showChatHistory,
    startNewChat,
    toggleChatHistory,
  } = useApp();

  const [input, setInput] = useState("");
  const [taskPanels, setTaskPanels] = useState<TaskWorkspacePanel[]>([]);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seededConversationRef = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (taskPanels.length < MAX_TASK_WORKSPACES) {
      setLimitReached(false);
    }
  }, [taskPanels.length]);

  useEffect(() => {
    const userEntries = messages
      .map((message, index) => (message.role === "user" ? { message, index } : null))
      .filter(Boolean) as Array<{ message: ChatMessage; index: number }>;

    if (userEntries.length === 0) {
      if (taskPanels.length > 0) {
        setTaskPanels([]);
        setActivePanelId(null);
      }
      seededConversationRef.current = null;
      return;
    }

    const conversationSignature =
      activeConversationId || `root:${userEntries[0].message.id}`;

    const needsSync =
      taskPanels.length === 0 ||
      taskPanels.some((panel) => {
        if (panel.startIndex === null) return false;
        const mapped = messages[panel.startIndex];
        return !mapped || mapped.role !== "user" || mapped.content !== panel.prompt;
      });

    if (!needsSync) {
      seededConversationRef.current = conversationSignature;
      return;
    }

    const hasConversationChanged =
      seededConversationRef.current !== conversationSignature;

    // Keep user-closed panels closed unless the conversation context changed.
    if (!hasConversationChanged && taskPanels.length === 0) return;

    const seededPanels: TaskWorkspacePanel[] = userEntries
      .slice(-MAX_TASK_WORKSPACES)
      .map(({ message, index }) => ({
        id: `msg-${message.id}`,
        prompt: message.content,
        createdAt: message.timestamp,
        startIndex: index,
      }));

    setTaskPanels(seededPanels);
    setActivePanelId(seededPanels[seededPanels.length - 1]?.id ?? null);
    seededConversationRef.current = conversationSignature;
  }, [messages, taskPanels, activeConversationId]);

  useEffect(() => {
    if (!taskPanels.some((panel) => panel.startIndex === null)) return;

    const userEntries = messages
      .map((message, index) =>
        message.role === "user"
          ? {
              index,
              content: message.content,
            }
          : null,
      )
      .filter(Boolean) as Array<{ index: number; content: string }>;

    setTaskPanels((prev) => {
      const usedIndexes = new Set<number>();
      for (const panel of prev) {
        if (panel.startIndex !== null) {
          usedIndexes.add(panel.startIndex);
        }
      }

      let changed = false;

      const resolved = prev.map((panel) => {
        if (panel.startIndex !== null) return panel;

        const match = userEntries.find(
          (entry) => !usedIndexes.has(entry.index) && entry.content === panel.prompt,
        );

        if (!match) return panel;

        usedIndexes.add(match.index);
        changed = true;
        return {
          ...panel,
          startIndex: match.index,
        };
      });

      return changed ? resolved : prev;
    });
  }, [messages, taskPanels]);

  useEffect(() => {
    if (taskPanels.length === 0) {
      if (activePanelId !== null) setActivePanelId(null);
      return;
    }

    if (!activePanelId || !taskPanels.some((panel) => panel.id === activePanelId)) {
      setActivePanelId(taskPanels[taskPanels.length - 1].id);
    }
  }, [taskPanels, activePanelId]);

  const panelMessages = useMemo(() => {
    const byId = new Map<string, ChatMessage[]>();

    for (const panel of taskPanels) {
      byId.set(panel.id, []);
    }

    const resolvedPanels = taskPanels
      .map((panel, index) => ({ panel, index }))
      .filter(
        (entry): entry is { panel: TaskWorkspacePanel & { startIndex: number }; index: number } =>
          typeof entry.panel.startIndex === "number",
      );

    for (let i = 0; i < resolvedPanels.length; i += 1) {
      const current = resolvedPanels[i];
      const next = resolvedPanels[i + 1];
      const start = Math.max(0, current.panel.startIndex);
      const end = Math.max(start, next ? next.panel.startIndex : messages.length);

      byId.set(current.panel.id, messages.slice(start, end));
    }

    return byId;
  }, [messages, taskPanels]);

  const latestResolvedPanelIndex = useMemo(() => {
    let latest = -1;
    taskPanels.forEach((panel, index) => {
      if (panel.startIndex !== null) latest = index;
    });
    return latest;
  }, [taskPanels]);

  const panelViews = useMemo<TaskWorkspacePanelView[]>(() => {
    return taskPanels.map((panel, index) => {
      const messagesForPanel = panelMessages.get(panel.id) || [];
      const hasApprovalPrompt = messagesForPanel.some(
        (message) => message.type === "approval" || message.type === "funding",
      );
      const hasErrorSignal = messagesForPanel.some(
        (message) => message.role === "assistant" && /(failed|error|cancelled|blocked)/i.test(message.content),
      );

      let state: PanelVisualState = "done";

      if (panel.startIndex === null) {
        state = "queued";
      } else if (index === latestResolvedPanelIndex && isProcessing) {
        state = "running";
      } else if (
        index === latestResolvedPanelIndex &&
        (hasApprovalPrompt || activeTask?.status === "awaiting-approval" || hasErrorSignal)
      ) {
        state = "attention";
      }

      return {
        ...panel,
        messages: messagesForPanel,
        state,
        isActive: panel.id === activePanelId,
      };
    });
  }, [taskPanels, panelMessages, latestResolvedPanelIndex, isProcessing, activeTask?.status, activePanelId]);

  const activePanel = useMemo(
    () => panelViews.find((panel) => panel.id === activePanelId) || panelViews[panelViews.length - 1],
    [activePanelId, panelViews],
  );

  const canCreateTaskWorkspace = taskPanels.length < MAX_TASK_WORKSPACES;
  const hasQueuedWork = queuedTaskCount > 0;

  const createWorkspace = (prompt: string): boolean => {
    if (!canCreateTaskWorkspace) {
      setLimitReached(true);
      return false;
    }

    const panel: TaskWorkspacePanel = {
      id: uid(),
      prompt,
      createdAt: new Date().toISOString(),
      startIndex: isProcessing ? null : messages.length,
    };

    setTaskPanels((prev) => [...prev, panel]);
    setActivePanelId(panel.id);
    setLimitReached(false);
    return true;
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!createWorkspace(trimmed)) return;

    sendMessage(trimmed);
    setInput("");
  };

  const closeWorkspace = (panelId: string) => {
    setTaskPanels((prev) => prev.filter((panel) => panel.id !== panelId));
    setActivePanelId((prev) => (prev === panelId ? null : prev));
  };

  return (
    <div className="relative min-h-[44rem]">
      {showChatHistory && <ChatHistoryPanel />}

      <div className="relative flex min-h-[35rem] flex-col pb-40">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute bottom-[5.2rem] left-1/2 h-10 w-px -translate-x-1/2 bg-gradient-to-t from-[rgba(37,99,235,0.5)] to-transparent" />
          <div className="absolute bottom-[3.7rem] left-1/2 h-6 w-6 -translate-x-1/2 rounded-full border border-[var(--aw-border-strong)] bg-[radial-gradient(circle,rgba(37,99,235,0.25)_0%,rgba(255,255,255,0.95)_70%)] shadow-[0_0_28px_rgba(37,99,235,0.32)]" />
          {taskPanels.length > 1 && (
            <div className="absolute bottom-[8.6rem] left-1/2 hidden h-px w-[min(92%,42rem)] -translate-x-1/2 bg-gradient-to-r from-transparent via-[rgba(37,99,235,0.3)] to-transparent md:block" />
          )}
        </div>

        {panelViews.length === 0 ? (
          <div className="relative z-10 mx-auto mt-2 w-full max-w-3xl rounded-3xl border border-[var(--aw-border)] bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(244,249,255,0.98))] p-6 shadow-[0_22px_42px_rgba(15,23,42,0.09)]">
            <p className="aw-kicker">Task Root</p>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.01em] text-[var(--aw-text)]">
              Branch autonomous tasks from a single command root
            </h3>
            <p className="mt-2 max-w-2xl text-sm text-[var(--aw-text-soft)]">
              Each submitted task opens its own workspace above. Keep issuing new tasks from the center dock while previous workspaces continue.
            </p>
            <p className="mt-4 text-xs text-[var(--aw-text-muted)]">
              Start from the command dock below. Task workspaces will appear here after your first run.
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "relative z-10 mt-2 grid gap-3",
              panelViews.length === 1
                ? "mx-auto w-full max-w-3xl"
                : "grid-cols-1 lg:grid-cols-2",
            )}
          >
            {panelViews.map((panel) => (
              <div key={panel.id} className="relative">
                <span className="pointer-events-none absolute -bottom-10 left-1/2 hidden h-10 w-px -translate-x-1/2 bg-gradient-to-b from-[rgba(37,99,235,0.32)] to-transparent md:block" />
                <article
                  className={cn(
                    "flex h-[21rem] flex-col overflow-hidden rounded-3xl border transition-all duration-300",
                    panel.isActive
                      ? "border-[var(--aw-border-strong)] bg-white shadow-[0_26px_46px_rgba(37,99,235,0.14)]"
                      : "border-[var(--aw-border)] bg-[linear-gradient(160deg,#ffffff_0%,#f7fbff_100%)] shadow-[0_14px_28px_rgba(15,23,42,0.08)]",
                  )}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActivePanelId(panel.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActivePanelId(panel.id);
                      }
                    }}
                    className="flex items-start justify-between gap-3 border-b border-[var(--aw-border)] px-4 py-3 text-left md:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="aw-kicker">Task Workspace</p>
                        {panel.isActive && (
                          <span className="inline-flex h-2 w-2 rounded-full bg-[var(--aw-primary)] shadow-[0_0_0_4px_rgba(37,99,235,0.14)]" />
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold text-[var(--aw-text)]">
                        {panel.prompt}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                        Started {fmtTime(panel.createdAt)}
                      </p>
                    </div>

                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.08em]",
                          panelStateChipClass(panel.state),
                        )}
                      >
                        {panelStateLabel(panel.state)}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeWorkspace(panel.id);
                        }}
                        className="aw-button-ghost h-7 w-7 shrink-0 p-0"
                        aria-label="Close workspace"
                        title="Close workspace"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="aw-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4">
                    {panel.messages.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-5 text-center">
                        <p className="text-xs text-[var(--aw-text-soft)]">
                          {panel.state === "queued"
                            ? "Queued behind the active task. This workspace will activate automatically."
                            : "Waiting for task updates."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {panel.messages.slice(-8).map((message) => (
                          <ChatMessageBubble key={message.id} message={message} />
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              </div>
            ))}
          </div>
        )}

        <div className="relative z-10 mt-4 rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[var(--aw-text-soft)]">
              <Sparkles size={13} className="text-[var(--aw-primary)]" />
              {activePanel
                ? `${panelViews.length}/${MAX_TASK_WORKSPACES} workspaces open`
                : "No active task workspaces"}
            </div>
            <div className="text-xs text-[var(--aw-text-muted)]">
              {hasQueuedWork
                ? `${queuedTaskCount} task${queuedTaskCount === 1 ? "" : "s"} queued`
                : isProcessing
                ? "Task running"
                : "Ready"}
            </div>
          </div>
          {limitReached && (
            <p className="mt-2 text-xs text-[var(--aw-warning)]">
              Four task workspaces are already open. Close one workspace to start another.
            </p>
          )}
        </div>
      </div>

      {!showChatHistory && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-30 w-full max-w-3xl -translate-x-1/2 px-3 md:bottom-6 md:px-4">
          <div className="pointer-events-auto rounded-[1.35rem] border border-[var(--aw-border-strong)] bg-[linear-gradient(170deg,rgba(255,255,255,0.96),rgba(245,249,255,0.96))] p-3 shadow-[0_22px_44px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="flex items-center gap-2 md:gap-3">
              <button
                onClick={startNewChat}
                className="aw-button-ghost h-9 w-9 shrink-0 p-0"
                aria-label="New chat"
                title="New chat"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={toggleChatHistory}
                className="aw-button-ghost h-9 w-9 shrink-0 p-0"
                aria-label="Chat history"
                title="Chat history"
              >
                <Clock size={16} />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleSend()}
                placeholder={
                  isProcessing
                    ? "Task running. Enter another task to queue it."
                    : "Describe what you want done next."
                }
                className="aw-input h-11 text-sm"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !canCreateTaskWorkspace}
                className="aw-button-primary h-11 shrink-0 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  {isProcessing ? "Queue Task" : "Run Task"}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            </div>

            <p className="mt-2.5 text-[11px] text-[var(--aw-text-muted)]">
              {canCreateTaskWorkspace
                ? "Press Enter to create a task workspace."
                : "Workspace limit reached. Close one panel to continue."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
