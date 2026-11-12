"use client";

import { useState } from "react";
import {
  Info,
  Edit3,
  ChevronDown,
  Send,
  Home,
  ShoppingCart,
  TrendingDown,
  DollarSign,
  Shield,
  X,
} from "lucide-react";
import { WorkspaceHeader } from "@/components/finance/WorkspacePrimitives";

interface AdviceCard {
  id: string;
  title: string;
  description: string;
  category: "SPEND" | "SAVE" | "PAY DOWN" | "INVEST";
  tasksTotal: number;
  tasksCompleted: number;
  icon: React.ReactNode;
}

const ADVICE_CARDS: AdviceCard[] = [
  {
    id: "track-cashflow",
    title: "Track cash flow",
    description: "See exactly where your money goes each month to make better decisions.",
    category: "SPEND",
    tasksTotal: 7,
    tasksCompleted: 0,
    icon: <ShoppingCart size={24} />,
  },
  {
    id: "buy-home",
    title: "Buy a home",
    description: "Start planning your down payment and get prepared for the mortgage process.",
    category: "SAVE",
    tasksTotal: 7,
    tasksCompleted: 3,
    icon: <Home size={24} />,
  },
  {
    id: "payoff-student-loans",
    title: "Pay off student loans",
    description: "Create a strategy to accelerate your student loan repayment.",
    category: "PAY DOWN",
    tasksTotal: 7,
    tasksCompleted: 1,
    icon: <TrendingDown size={24} />,
  },
  {
    id: "save-college",
    title: "Save for college",
    description: "Build education savings for your children or family members.",
    category: "SAVE",
    tasksTotal: 7,
    tasksCompleted: 2,
    icon: <DollarSign size={24} />,
  },
  {
    id: "emergency-fund",
    title: "Save up an emergency fund",
    description: "Build a safety net for unexpected expenses and financial hardship.",
    category: "SAVE",
    tasksTotal: 7,
    tasksCompleted: 0,
    icon: <Shield size={24} />,
  },
];

const CATEGORY_CHIPS = [
  "For You",
  "Save More",
  "Spend Less",
  "Pay It Off",
  "Stay Protected",
  "Grow Money",
  "Feel Good",
] as const;

const SUGGESTED_PROMPTS = [
  "Can I afford to eat out this weekend?",
  "What should I save for first?",
  "Why did my spending go up?",
  "How much do I have in total?",
  "What does credit score mean?",
];

function getCategoryColor(
  category: "SPEND" | "SAVE" | "PAY DOWN" | "INVEST"
): string {
  switch (category) {
    case "SPEND":
      return "#F97316"; // orange
    case "SAVE":
      return "#22C55E"; // green
    case "PAY DOWN":
      return "#3B82F6"; // blue
    case "INVEST":
      return "#A855F7"; // purple
  }
}

function getCategoryBgColor(
  category: "SPEND" | "SAVE" | "PAY DOWN" | "INVEST"
): string {
  switch (category) {
    case "SPEND":
      return "rgba(249, 115, 22, 0.1)";
    case "SAVE":
      return "rgba(34, 197, 94, 0.1)";
    case "PAY DOWN":
      return "rgba(59, 130, 246, 0.1)";
    case "INVEST":
      return "rgba(168, 85, 247, 0.1)";
  }
}

export function AdviceView() {
  const [selectedCategory, setSelectedCategory] = useState<string>("Recommendations");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  const handleChatSend = () => {
    if (chatInput.trim()) {
      setChatMessages([
        ...chatMessages,
        { role: "user", content: chatInput },
        {
          role: "assistant",
          content:
            "Let me look into that for you! Based on what I can see in your money...",
        },
      ]);
      setChatInput("");
    }
  };

  return (
    <>
      {/* Modal Overlay */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div
            className="relative w-full max-w-md rounded-2xl border border-[var(--aw-border)] bg-white p-8 shadow-lg"
            style={{ boxShadow: "0 20px 60px rgba(15, 23, 42, 0.1)" }}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute right-4 top-4 p-1 hover:bg-[var(--aw-surface-subtle)] rounded"
            >
              <X size={20} className="text-[var(--aw-text-muted)]" />
            </button>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[var(--aw-text)] mb-2">
                Let Agent Wallet get to know you
              </h2>
              <p className="text-[var(--aw-text-muted)] mb-8">
                Answer a few quick questions so Agent Wallet can give you better tips
              </p>
              <button
                onClick={() => setShowModal(false)}
                className="w-full rounded-lg bg-[var(--calico-primary, #FDBA74)] px-6 py-3 font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full min-h-screen flex-col gap-8 bg-[var(--aw-surface-subtle)] p-6">
        {/* Header */}
        <WorkspaceHeader title="Ask Agent Wallet" subtitle="Tips & guidance just for you" />

        <div className="flex flex-1 gap-6">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Prioritized by you Section */}
            <div className="mb-8 rounded-2xl border border-[var(--aw-border)] bg-white p-6">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-[var(--aw-text)]">
                    Your plan
                  </h2>
                  <div className="group relative cursor-help">
                    <Info size={18} className="text-[var(--aw-text-muted)]" />
                    <div className="absolute bottom-full left-0 mb-2 hidden w-48 rounded-lg bg-gray-900 p-2 text-xs text-white group-hover:block z-10">
                      Agent Wallet picked these based on what matters most for your money right now.
                    </div>
                  </div>
                </div>
                <button className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--aw-surface-subtle)] transition-colors">
                  <Edit3 size={16} />
                  <span className="text-sm font-medium">Edit</span>
                </button>
              </div>

              {/* Advice Cards */}
              <div className="space-y-4">
                {ADVICE_CARDS.map((card) => {
                  const color = getCategoryColor(card.category);
                  const bgColor = getCategoryBgColor(card.category);
                  const isExpanded = expandedCard === card.id;
                  const progress =
                    card.tasksTotal > 0 ? (card.tasksCompleted / card.tasksTotal) * 100 : 0;
                  const remaining = card.tasksTotal - card.tasksCompleted;

                  return (
                    <div
                      key={card.id}
                      className="rounded-xl border border-[var(--aw-border)] bg-white p-5 hover:shadow-md transition-shadow"
                    >
                      <div className="flex gap-4">
                        {/* Icon */}
                        <div
                          className="flex-shrink-0 flex h-12 w-12 items-center justify-center rounded-lg"
                          style={{ backgroundColor: bgColor, color }}
                        >
                          {card.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-semibold text-[var(--aw-text)]">
                                {card.title}
                              </h3>
                              <p className="text-sm text-[var(--aw-text-muted)]">
                                {card.description}
                              </p>
                            </div>
                            <span
                              className="flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                              style={{
                                backgroundColor: bgColor,
                                color,
                              }}
                            >
                              {card.category}
                            </span>
                          </div>

                          {/* Progress Bar */}
                          <div className="mb-3">
                            <div className="mb-2 h-2 w-full rounded-full bg-[var(--aw-surface-subtle)]">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${progress}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                            <p className="text-xs font-medium text-[var(--aw-text-muted)] uppercase">
                              {card.tasksCompleted === card.tasksTotal
                                ? "ALL DONE!"
                                : card.tasksCompleted === 0
                                  ? `${remaining} STEPS TO GO`
                                  : `${card.tasksCompleted} DONE · ${remaining} LEFT`}
                            </p>
                          </div>

                          {/* Show Completed Toggle */}
                          {card.tasksCompleted > 0 && (
                            <button
                              onClick={() =>
                                setExpandedCard(isExpanded ? null : card.id)
                              }
                              className="flex items-center gap-2 text-sm font-medium text-[var(--calico-primary, #FDBA74)] hover:underline"
                            >
                              Show {card.tasksCompleted} completed
                              <ChevronDown
                                size={14}
                                style={{
                                  transform: isExpanded ? "rotate(180deg)" : "",
                                  transition: "transform 0.2s",
                                }}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="w-64 flex-shrink-0">
            <div className="rounded-2xl border border-[var(--aw-border)] bg-white p-6">
              <h3 className="mb-4 font-semibold text-[var(--aw-text)]">Show me</h3>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setSelectedCategory(chip)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      selectedCategory === chip
                        ? "bg-[var(--calico-primary, #FDBA74)] text-white"
                        : "bg-[var(--aw-surface-subtle)] text-[var(--aw-text)] hover:bg-[var(--aw-border)]"
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant Chat Panel */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
        {/* Chat Messages */}
        {chatOpen && (
          <div
            className="w-80 rounded-2xl border border-[var(--aw-border)] bg-white shadow-lg"
            style={{ boxShadow: "0 20px 60px rgba(15, 23, 42, 0.15)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--aw-border)] p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">🐱</span>
                <h4 className="font-semibold text-[var(--aw-text)]">Ask Agent Wallet</h4>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="p-1 hover:bg-[var(--aw-surface-subtle)] rounded"
              >
                <X size={18} />
              </button>
            </div>

            {/* Messages or Prompts */}
            <div className="h-80 overflow-y-auto p-4">
              {chatMessages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-[var(--aw-text-muted)] mb-4">
                    Hey! I'm Agent Wallet. Ask me anything about your money.
                  </p>
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setChatInput(prompt);
                        setChatMessages([
                          { role: "user", content: prompt },
                          {
                            role: "assistant",
                            content:
                              "I can help you with that question! Based on your financial data, here's what I found...",
                          },
                        ]);
                      }}
                      className="w-full rounded-lg bg-[var(--aw-surface-subtle)] p-3 text-left text-sm hover:bg-[var(--aw-border)] transition-colors text-[var(--aw-text)]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-[var(--calico-primary, #FDBA74)] text-white"
                            : "bg-[var(--aw-surface-subtle)] text-[var(--aw-text)]"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Disclaimer */}
            <div className="border-t border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-3">
              <p className="text-xs text-[var(--aw-text-muted)]">
                Agent Wallet is helpful but not a financial advisor. Double-check important decisions.
              </p>
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 border-t border-[var(--aw-border)] p-3">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleChatSend();
                }}
                placeholder="Type here..."
                className="flex-1 rounded-lg border border-[var(--aw-border)] bg-white px-3 py-2 text-sm placeholder-[var(--aw-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--calico-primary, #FDBA74)]"
              />
              <button
                onClick={handleChatSend}
                className="flex items-center justify-center rounded-lg bg-[var(--calico-primary, #FDBA74)] p-2 hover:opacity-90 transition-opacity"
              >
                <Send size={16} className="text-white" />
              </button>
            </div>
          </div>
        )}

        {/* Toggle Button */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--calico-primary, #FDBA74)] shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        >
          <span className="text-2xl">🐱</span>
        </button>
      </div>
    </>
  );
}
