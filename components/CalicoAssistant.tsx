"use client";

import { useState, useEffect, useCallback } from "react";
import { Send, X } from "lucide-react";
import { InlineSpinner } from "@/components/skeleton";

type CalicoTier = "starter" | "pro" | "autonomous" | null;

const BASE_PROMPTS = [
  "What should I save for first?",
  "What does this number mean?",
  "How am I doing with money?",
];

const PRO_PROMPTS = [
  "Can I afford this?",
  "Why did my spending go up?",
  "What's coming up this month?",
];

const AUTONOMOUS_PROMPTS = [
  "Move money to my emergency fund",
  "Help me cancel a subscription",
  "What can you handle for me?",
];

function getPromptsForTier(tier: CalicoTier): string[] {
  if (tier === "autonomous") return [...BASE_PROMPTS.slice(0, 2), ...AUTONOMOUS_PROMPTS.slice(0, 3)];
  if (tier === "pro") return [...BASE_PROMPTS, ...PRO_PROMPTS.slice(0, 2)];
  return BASE_PROMPTS;
}

async function fetchCalicoResponse(prompt: string): Promise<string> {
  try {
    const res = await fetch("/api/ai/general-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, sourceButton: "general" }),
    });
    const data = await res.json();
    if (data.ok && data.answer) {
      return rewriteForCalico(data.answer);
    }
    return fallbackResponse(prompt);
  } catch {
    return fallbackResponse(prompt);
  }
}

function rewriteForCalico(answer: string): string {
  return answer
    .replace(/open Wallet/gi, "check your Accounts page")
    .replace(/open Statements/gi, "look at your Money Moves")
    .replace(/open Subscriptions/gi, "check your Repeating Payments")
    .replace(/open Settings/gi, "go to Settings")
    .replace(/open Execution/gi, "check your To-Do list")
    .replace(/Use the Tasks panel/gi, "Head over to your To-Do list")
    .replace(/Use the Research panel/gi, "Try Ask Calico")
    .replace(/Wallet/g, "Accounts")
    .replace(/Statements/g, "Money Moves")
    .replace(/transaction/gi, "money move")
    .replace(/budget/gi, "spending plan")
    .replace(/subscription/gi, "repeating payment");
}

function fallbackResponse(input: string): string {
  return getLocalResponse(input, null) ?? "Great question! I'm looking into that. Check your dashboard for the latest on your money.";
}

export function CalicoAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [tier, setTier] = useState<CalicoTier>(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  useEffect(() => {
    fetch("/api/billing/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.plan) setTier(data.plan as CalicoTier);
        else setTier("starter");
      })
      .catch(() => setTier("starter"));
  }, []);

  const prompts = getPromptsForTier(tier);

  const sendMessage = useCallback(async (text: string) => {
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    const localAnswer = getLocalResponse(text, tier);

    let answer: string;
    if (localAnswer === null) {
      answer = await fetchCalicoResponse(text);
    } else {
      answer = localAnswer;
    }

    setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    setLoading(false);
  }, [tier]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    void sendMessage(text);
  };

  const tierLabel =
    tier === "autonomous" ? "Fully Autonomous" : tier === "pro" ? "Pro" : "Starter";

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
      {open && (
        <div
          className="w-[calc(100vw-2rem)] max-w-80 rounded-2xl border border-[var(--aw-border,#e5e7eb)] bg-[var(--aw-surface-1,#FFFCF8)] shadow-xl md:w-80"
          style={{ boxShadow: "0 20px 60px rgba(15, 23, 42, 0.12)" }}
        >
          <div className="flex items-center justify-between border-b border-[var(--aw-border,#e5e7eb)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🐱</span>
              <div>
                <h4 className="text-sm font-semibold text-[var(--aw-text,#111)]">Calico</h4>
                <p className="text-[10px] text-[var(--aw-text-muted,#888)]">
                  Your money helper{tier && tier !== "starter" ? ` · ${tierLabel}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 hover:bg-[var(--aw-surface-subtle,#f5f5f5)]"
            >
              <X size={16} className="text-[var(--aw-text-muted,#888)]" />
            </button>
          </div>

          <div className="h-72 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--aw-text,#111)]">
                  {tier === "autonomous"
                    ? "Hey! I'm Calico. I can explain things, answer questions, and take action for you."
                    : tier === "pro"
                      ? "Hey! I'm Calico. I can explain things and help you make smarter money decisions."
                      : "Hey! I'm Calico, your friendly money helper. Ask me anything about your money."}
                </p>
                <div className="space-y-2">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      disabled={loading}
                      onClick={() => void sendMessage(prompt)}
                      className="w-full rounded-xl bg-[var(--aw-surface-subtle,#f5f5f5)] px-3 py-2.5 text-left text-sm text-[var(--aw-text,#111)] transition-colors hover:bg-[var(--aw-border,#e5e7eb)] disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-[var(--calico-primary,#FDBA74)] text-[var(--aw-text,#111)]"
                          : "bg-[var(--aw-surface-subtle,#f5f5f5)] text-[var(--aw-text,#111)]"
                      }`}
                    >
                      {msg.role === "assistant" && <span className="mr-1">🐱</span>}
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-[var(--aw-surface-subtle,#f5f5f5)] px-3 py-2 text-sm text-[var(--aw-text-muted,#888)]">
                      <span className="mr-1">🐱</span>
                      <InlineSpinner size={12} className="inline-block" /> Thinking...
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--aw-border,#e5e7eb)] p-3">
            <p className="mb-2 text-[10px] text-[var(--aw-text-muted,#888)]">
              Calico is helpful but not a financial advisor.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Ask me anything..."
                disabled={loading}
                className="flex-1 rounded-xl border border-[var(--aw-border,#e5e7eb)] bg-[var(--aw-surface-2,#fff)] px-3 py-2 text-sm placeholder-[var(--aw-text-muted,#888)] focus:outline-none focus:ring-2 focus:ring-[var(--calico-primary,#FDBA74)] disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={loading}
                className="flex items-center justify-center rounded-xl bg-[var(--calico-primary,#FDBA74)] p-2 transition hover:opacity-90 disabled:opacity-50"
              >
                <Send size={14} className="text-[var(--aw-text,#111)]" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--calico-primary,#FDBA74)] shadow-lg transition-all hover:shadow-xl hover:scale-105"
        aria-label="Talk to Calico"
      >
        <span className="text-2xl">{open ? "✕" : "🐱"}</span>
      </button>
    </div>
  );
}

/** Returns a local response for known patterns, or null if the backend should handle it. */
function getLocalResponse(input: string, tier: CalicoTier): string | null {
  const lower = input.toLowerCase();

  // Autonomous-only actions
  if (lower.includes("move money") || lower.includes("transfer")) {
    if (tier === "autonomous") {
      return "I can do that! Which goal should I move money to, and how much? I'll set it up and ask for your OK before anything happens.";
    }
    return "Moving money automatically is part of the Fully Autonomous plan. Right now I can help you plan — want to set up a goal instead?";
  }
  if (lower.includes("cancel") && lower.includes("subscription")) {
    if (tier === "autonomous") {
      return "Sure! Tell me which repeating payment and I'll start the cancel workflow. I'll walk you through each step.";
    }
    return "I can help you find repeating payments, but canceling them automatically is part of the Fully Autonomous plan. Want me to show your repeating payments?";
  }
  if (lower.includes("handle") || lower.includes("what can you do")) {
    if (tier === "autonomous") {
      return "I can move money between accounts, fund your goals automatically, help cancel repeating payments, and keep an eye on your bills. What would you like me to do?";
    }
    if (tier === "pro") {
      return "I can explain your spending, help you understand trends, and tell you if you can afford something. For auto-actions, check out the Fully Autonomous plan!";
    }
    return "I can explain what your money numbers mean, help you understand your spending, and suggest what to save for first. Ask me anything!";
  }

  // Pro-tier questions
  if (lower.includes("afford")) {
    if (tier === "pro" || tier === "autonomous") {
      return "Let me check your Okay to Spend amount. That's the money left after your bills, goals, and important stuff are covered. Based on your spending this month, you're looking good.";
    }
    return "Your Okay to Spend is the money left after bills and goals. Upgrade to Pro and I can give you a real-time answer based on your actual spending!";
  }
  if (lower.includes("spending") && lower.includes("up")) {
    if (tier === "pro" || tier === "autonomous") {
      return "I noticed your spending went up. Looks like dining and shopping are higher than last month. Want me to break it down by group?";
    }
    return "I can see your recent spending on your dashboard. For detailed trend explanations, Pro gives me the smarts to tell you exactly why things changed.";
  }
  if (lower.includes("coming") || lower.includes("upcoming")) {
    if (tier === "pro" || tier === "autonomous") {
      return "Looking at the next 30 days: you have a few bills coming up and your spending plan is on track. Nothing surprising ahead.";
    }
    return "Check your Repeating Payments page to see what's coming up. With Pro, I can predict your whole month ahead!";
  }

  // Base tier - everyone
  if (lower.includes("save") && lower.includes("first")) {
    return "Your emergency fund comes first — it's your safety cushion for when life gets expensive unexpectedly. Once that's solid, we can plan the fun stuff!";
  }
  if (lower.includes("mean") || lower.includes("what does") || lower.includes("number")) {
    return "Happy to explain! Tell me the word or number you're curious about and I'll break it down in plain English.";
  }
  if (lower.includes("doing") || lower.includes("how am i")) {
    return "You're doing okay! Your bills are covered and you're making progress on your goals. Keep it up.";
  }
  if (lower.includes("okay to spend") || lower.includes("safe to spend")) {
    return "Okay to Spend is the money you can use freely right now — after your bills, goals, and important stuff are taken care of. Check it on your dashboard!";
  }

  // Fall through to backend
  return null;
}
