"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Lock, Sparkles, TrendingDown } from "lucide-react";
import type { SmartHomePayload } from "@/services/smartWallet";

type InsightType = "warning" | "opportunity" | "prediction";

interface ActionableInsight {
  type: InsightType;
  title: string;
  description: string;
  impactLabel: string;
  cta: string | null;
}

interface LockedPreview {
  teaser: string;
}

const ICON_MAP: Record<InsightType, typeof Sparkles> = {
  opportunity: Sparkles,
  warning: AlertTriangle,
  prediction: TrendingDown,
};

const ACCENT_MAP: Record<InsightType, { bg: string; border: string; icon: string; badge: string }> = {
  opportunity: {
    bg: "rgba(253, 186, 116, 0.12)",
    border: "rgba(253, 186, 116, 0.35)",
    icon: "var(--calico-primary)",
    badge: "rgba(253, 186, 116, 0.22)",
  },
  warning: {
    bg: "rgba(220, 38, 38, 0.06)",
    border: "rgba(220, 38, 38, 0.2)",
    icon: "#DC2626",
    badge: "rgba(220, 38, 38, 0.1)",
  },
  prediction: {
    bg: "rgba(251, 207, 232, 0.14)",
    border: "rgba(251, 207, 232, 0.4)",
    icon: "var(--calico-primary-secondary)",
    badge: "rgba(251, 207, 232, 0.26)",
  },
};

function InsightCard({ insight, index }: { insight: ActionableInsight; index: number }) {
  const accent = ACCENT_MAP[insight.type];
  const Icon = ICON_MAP[insight.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + index * 0.06, duration: 0.22, ease: "easeOut" }}
      className="rounded-[16px] border px-5 py-4"
      style={{
        background: accent.bg,
        borderColor: accent.border,
      }}
    >
      <div className="flex items-start gap-3.5">
        <div
          className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]"
          style={{ background: accent.badge }}
        >
          <Icon size={17} style={{ color: accent.icon }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.92rem] font-semibold leading-snug text-[var(--calico-text)]">
            {insight.title}
          </h3>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--calico-text-muted)]">
            {insight.description}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold tracking-wide"
              style={{
                background: accent.badge,
                color: accent.icon,
              }}
            >
              {insight.impactLabel}
            </span>
            {insight.cta && (
              <button
                type="button"
                className="group inline-flex items-center gap-1 text-[0.78rem] font-semibold transition-colors"
                style={{ color: accent.icon }}
              >
                {insight.cta}
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function LockedCard({ preview, index }: { preview: LockedPreview; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 + index * 0.06, duration: 0.2, ease: "easeOut" }}
      className="relative overflow-hidden rounded-[14px] border border-[var(--calico-border)] px-5 py-3.5"
      style={{ background: "var(--calico-card)" }}
    >
      {/* Blur overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          backdropFilter: "blur(3px)",
          background: "rgba(255, 252, 248, 0.55)",
        }}
      />
      <div className="relative z-20 flex items-center gap-3">
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "rgba(107, 91, 75, 0.08)" }}
        >
          <Lock size={13} className="text-[var(--calico-text-muted)]" />
        </div>
        <span className="text-[0.8rem] font-medium text-[var(--calico-text-muted)]">
          {preview.teaser}
        </span>
      </div>
    </motion.div>
  );
}

export function PrimaryInsightCard({ home }: { home: SmartHomePayload }) {
  const insights = home.actionableInsights;
  if (!insights || !insights.primary) return null;

  const hasLocked = insights.locked.length > 0;
  const hasAdditional = insights.additional.length > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03, duration: 0.25, ease: "easeOut" }}
      className="flex flex-col gap-3"
    >
      {/* Primary insight */}
      <InsightCard insight={insights.primary} index={0} />

      {/* Additional insights (Pro+) */}
      {hasAdditional && insights.additional.map((insight, i) => (
        <InsightCard key={`additional-${i}`} insight={insight} index={i + 1} />
      ))}

      {/* Locked previews (Starter) */}
      {hasLocked && (
        <div className="flex flex-col gap-2">
          {insights.locked.map((preview, i) => (
            <LockedCard key={`locked-${i}`} preview={preview} index={i} />
          ))}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.32, duration: 0.2 }}
            className="flex justify-center pt-1"
          >
            <Link
              href="/plans"
              className="group inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.75rem] font-semibold transition-all hover:shadow-sm"
              style={{
                background: "rgba(253, 186, 116, 0.15)",
                border: "1px solid rgba(253, 186, 116, 0.3)",
                color: "var(--calico-text)",
              }}
            >
              <Sparkles size={12} style={{ color: "var(--calico-primary)" }} />
              Unlock all insights
              <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </motion.div>
        </div>
      )}
    </motion.section>
  );
}
