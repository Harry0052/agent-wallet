"use client";

import { useState } from "react";
import {
  LayoutDashboard, Link as LinkIcon, Receipt, RefreshCw, CalendarCheck,
  Sparkles, Infinity, TrendingUp, LineChart, HeadphonesIcon, Crown, Zap,
  Bot, Brain, Target, Code, HeartHandshake, PiggyBank, ArrowRight,
  Settings,
} from "lucide-react";

interface TutorialStep {
  title: string;
  body: string;
  icon: string;
}

interface PlanTutorialProps {
  heading: string;
  steps: TutorialStep[];
  onComplete: () => void;
  onSkip: () => void;
}

const ICON_MAP: Record<string, typeof Sparkles> = {
  LayoutDashboard, Link: LinkIcon, Receipt, RefreshCw, CalendarCheck,
  Sparkles, Infinity, TrendingUp, LineChart, HeadphonesIcon, Crown, Zap,
  Bot, Brain, Target, Code, HeartHandshake, PiggyBank, Settings,
};

export function PlanTutorial({ heading, steps, onComplete, onSkip }: PlanTutorialProps) {
  const [current, setCurrent] = useState(0);
  const step = steps[current];
  const Icon = ICON_MAP[step.icon] || Sparkles;
  const isLast = current === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: "rgba(17,17,17,0.12)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-md animate-[sheet-rise_0.35s_ease-out]"
        style={{
          borderRadius: 28,
          background: "rgba(255,252,248,0.92)",
          backdropFilter: "blur(32px)",
          border: "1px solid rgba(242,222,204,0.6)",
          boxShadow: "0 24px 80px rgba(17,17,17,0.1), inset 0 1px 0 rgba(255,255,255,0.9)",
          padding: "36px 32px 28px",
        }}
      >
        {/* Progress */}
        <div className="mb-6 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                flex: 1,
                background: i <= current ? "#FDBA74" : "#F2DECC",
              }}
            />
          ))}
        </div>

        {current === 0 && (
          <p
            className="mb-4"
            style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#FDBA74" }}
          >
            {heading}
          </p>
        )}

        <div
          className="mb-5 flex h-12 w-12 items-center justify-center"
          style={{ borderRadius: 14, background: "rgba(253,186,116,0.18)" }}
        >
          <Icon size={24} color="#FDBA74" />
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#111", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.2 }}>
          {step.title}
        </h3>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: "#3A332E" }}>
          {step.body}
        </p>

        <div className="mt-8 flex items-center justify-between">
          <span style={{ fontSize: 12, color: "#6B5B4B" }}>
            {current + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={() => {
              if (isLast) {
                onComplete();
              } else {
                setCurrent((c) => c + 1);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform active:scale-[0.98]"
            style={{ background: "#FDBA74", color: "#111", boxShadow: "0 2px 12px rgba(253,186,116,0.3)" }}
          >
            {isLast ? "Let's go!" : "Next"}
            <ArrowRight size={14} />
          </button>
        </div>

        {!isLast && (
          <button
            type="button"
            onClick={onSkip}
            className="mt-3 w-full text-center text-xs transition-colors"
            style={{ color: "#6B5B4B" }}
          >
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  );
}
