"use client";

import { motion } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { C, sectionHeadingStyle, subtitleStyle, overlineStyle } from "./landingConstants";
import { fadeUp, staggerContainer, viewportOnce } from "./landingMotion";

/* ── Feature 1: Account Aggregation ────────────────────────────── */

function AccountCards() {
  const accounts = [
    { bank: "Chase Checking", last4: "4821", balance: "$2,340.18", accent: C.apricot },
    { bank: "Amex Gold", last4: "1087", balance: "$1,620.55", accent: C.blush },
    { bank: "BofA Savings", last4: "7293", balance: "$860.00", accent: C.sage },
    { bank: "Discover", last4: "3456", balance: "$412.33", accent: C.caramel },
  ];

  return (
    <motion.div
      initial="initial"
      whileInView="animate"
      viewport={viewportOnce}
      variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {accounts.map((a) => (
        <motion.div
          key={a.last4}
          variants={{
            initial: { opacity: 0, x: -16 },
            animate: { opacity: 1, x: 0, transition: { duration: 0.4 } },
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${a.accent}`,
            background: C.surface,
            boxShadow: C.shadow,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{a.bank}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: C.textMuted }}>••••{a.last4}</p>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{a.balance}</span>
        </motion.div>
      ))}
      <div style={{ padding: "8px 16px", borderRadius: 12, background: C.apricotSoft, border: `1px solid ${C.apricot}`, textAlign: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.apricot }}>Net Worth: $5,232.06</span>
      </div>
    </motion.div>
  );
}

/* ── Feature 2: Spending Intelligence ──────────────────────────── */

function SpendingBars() {
  const categories = [
    { name: "Dining", amount: "$420", pct: 78, color: C.apricot, change: "+12%" },
    { name: "Groceries", amount: "$280", pct: 52, color: C.sage },
    { name: "Transport", amount: "$140", pct: 26, color: C.blush },
    { name: "Subscriptions", amount: "$89", pct: 16, color: C.charcoalSoft },
  ];

  return (
    <motion.div
      initial="initial"
      whileInView="animate"
      viewport={viewportOnce}
      variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
      style={{ position: "relative" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {categories.map((cat) => (
          <motion.div
            key={cat.name}
            variants={{ initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.4 } } }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textSecondary }}>{cat.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{cat.amount}</span>
                {cat.change && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: C.apricot, background: C.apricotSoft, borderRadius: 4, padding: "1px 5px" }}>
                    {cat.change}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: C.cream }}>
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${cat.pct}%` }}
                viewport={viewportOnce}
                transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                style={{ height: "100%", borderRadius: 4, background: cat.color }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Callout badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={viewportOnce}
        transition={{ delay: 0.6, duration: 0.4 }}
        style={{
          position: "absolute",
          top: -12,
          right: -8,
          background: C.surface,
          border: `1px solid ${C.apricot}`,
          borderRadius: 10,
          padding: "6px 12px",
          boxShadow: C.shadowMd,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: C.apricot }}>Dining is up 12% this month</span>
      </motion.div>
    </motion.div>
  );
}

/* ── Feature 3: Smart Insights ─────────────────────────────────── */

function InsightCards() {
  const insights = [
    {
      color: C.sage,
      borderColor: C.sage,
      label: "Savings opportunity",
      body: "3 unused subscriptions totaling $42/mo",
      action: "Review",
    },
    {
      color: C.apricot,
      borderColor: C.apricot,
      label: "Spending alert",
      body: "Dining spending is 12% higher than usual",
      action: null,
    },
    {
      color: C.blush,
      borderColor: C.blush,
      label: "Upcoming bill",
      body: "Rent payment of $1,800 due in 5 days",
      action: null,
    },
  ];

  return (
    <motion.div
      initial="initial"
      whileInView="animate"
      viewport={viewportOnce}
      variants={{ animate: { transition: { staggerChildren: 0.12 } } }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      {insights.map((ins) => (
        <motion.div
          key={ins.label}
          variants={{
            initial: { opacity: 0, x: 16 },
            animate: { opacity: 1, x: 0, transition: { duration: 0.4 } },
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${ins.borderColor}`,
            background: C.surface,
            boxShadow: C.shadow,
          }}
        >
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: ins.color }}>
              {ins.label}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
              {ins.body}
            </p>
          </div>
          {ins.action ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: C.apricot,
                background: C.apricotSoft,
                border: `1px solid ${C.apricot}`,
                borderRadius: 100,
                padding: "4px 12px",
                whiteSpace: "nowrap",
              }}
            >
              {ins.action}
            </span>
          ) : (
            <ArrowRight size={14} color={C.textMuted} />
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}

/* ── Feature block layout ──────────────────────────────────────── */

interface FeatureBlockProps {
  overline: string;
  title: string;
  description: string;
  bullets: string[];
  visual: React.ReactNode;
  reverse?: boolean;
  accentColor: string;
}

function FeatureBlock({ overline, title, description, bullets, visual, reverse, accentColor }: FeatureBlockProps) {
  return (
    <motion.div
      initial="initial"
      whileInView="animate"
      viewport={viewportOnce}
      variants={staggerContainer}
      className={`grid grid-cols-1 items-center gap-12 lg:gap-16 lg:grid-cols-2`}
    >
      <motion.div variants={fadeUp} className={reverse ? "lg:order-2" : ""}>
        <p style={{ ...overlineStyle, color: accentColor, marginBottom: 12 }}>{overline}</p>
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: "clamp(1.5rem, 3vw, 2rem)",
            fontWeight: 700,
            color: C.textPrimary,
            fontFamily: C.fontFamily,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.7, color: C.textSecondary }}>
          {description}
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5" style={{ fontSize: 14, color: C.textSecondary }}>
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: accentColor }} />
              {b}
            </li>
          ))}
        </ul>
      </motion.div>
      <motion.div variants={fadeUp} className={reverse ? "lg:order-1" : ""}>
        {visual}
      </motion.div>
    </motion.div>
  );
}

/* ── Main section ──────────────────────────────────────────────── */

export function LandingFeatures() {
  return (
    <section className="px-6 py-28 md:px-10" style={{ background: C.cream }}>
      <div className="mx-auto max-w-[1200px]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={viewportOnce}
          variants={staggerContainer}
          className="mb-20 text-center"
        >
          <motion.h2 variants={fadeUp} style={sectionHeadingStyle}>
            See what Calico actually does.
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-lg" style={subtitleStyle}>
            Real features. Real interface. No vague promises.
          </motion.p>
        </motion.div>

        <div className="flex flex-col gap-24">
          <FeatureBlock
            overline="ALL YOUR MONEY"
            title="Every account, one calm view."
            description="Connect your banks, credit cards, and savings — see your complete financial picture without switching apps."
            bullets={[
              "Automatic balance updates",
              "Read-only, bank-grade secure connection",
              "Net worth calculated in real time",
            ]}
            visual={<AccountCards />}
            accentColor={C.apricot}
          />

          <FeatureBlock
            overline="SPENDING CLARITY"
            title="Understand every dollar."
            description="Calico automatically categorizes your transactions and highlights what changed. No manual tagging."
            bullets={[
              "Smart categorization across all accounts",
              "Month-over-month trend detection",
              "Alerts when spending spikes",
            ]}
            visual={<SpendingBars />}
            reverse
            accentColor={C.sage}
          />

          <FeatureBlock
            overline="PROACTIVE INSIGHTS"
            title="Calico notices what you miss."
            description="From unused subscriptions to upcoming bills, Calico surfaces actionable insights so nothing catches you off guard."
            bullets={[
              "Subscription detection and savings alerts",
              "Bill forecasting and reminders",
              "Personalized spending recommendations",
            ]}
            visual={<InsightCards />}
            accentColor={C.blush}
          />
        </div>
      </div>
    </section>
  );
}
