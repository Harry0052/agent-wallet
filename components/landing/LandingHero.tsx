"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Star, Check } from "lucide-react";
import { C } from "./landingConstants";
import { fadeUp, scaleIn } from "./landingMotion";

function ProductFlowMockup() {
  const accounts = [
    { name: "Chase", last4: "4821", balance: "$2,340", color: C.apricot },
    { name: "Amex", last4: "1087", balance: "$1,620", color: C.blush },
    { name: "Bank of America", last4: "7293", balance: "$860", color: C.sage },
  ];

  const spending = [
    { category: "Dining", amount: "$420", width: "78%", color: C.apricot },
    { category: "Groceries", amount: "$280", width: "52%", color: C.sage },
    { category: "Transport", amount: "$140", width: "26%", color: C.blush },
    { category: "Subscriptions", amount: "$89", width: "16%", color: C.charcoalSoft },
  ];

  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      transition={{ delay: 0.3 }}
      style={{ position: "relative", width: "100%", maxWidth: 460, margin: "0 auto" }}
    >
      {/* Depth glow */}
      <div
        style={{
          position: "absolute",
          top: 30,
          right: -20,
          width: "70%",
          height: "60%",
          background: C.apricotSoft,
          borderRadius: 32,
          filter: "blur(40px)",
          opacity: 0.4,
          zIndex: 0,
        }}
      />

      {/* Main frame */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          background: C.surface,
          borderRadius: 24,
          border: `1px solid ${C.border}`,
          boxShadow: C.shadowLg,
          overflow: "hidden",
        }}
      >
        {/* App bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: `1px solid ${C.border}`,
            background: C.cream,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <img src="/calico-icon.png" alt="" style={{ width: 20, height: 20, borderRadius: 5 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, fontFamily: C.fontFamily }}>
              Agent Wallet
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: C.sageSoft,
              border: `1px solid ${C.sage}`,
              borderRadius: 100,
              padding: "2px 8px",
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.success, display: "inline-block" }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: C.caramel }}>All synced</span>
          </div>
        </div>

        {/* ① CONNECT */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}
        >
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>
            Connected accounts
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            {accounts.map((a, i) => (
              <motion.div
                key={a.name}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.85 + i * 0.1, duration: 0.3 }}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${a.color}`,
                  background: C.surface,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: C.textPrimary }}>{a.name}</span>
                  <Check size={10} color={C.success} />
                </div>
                <span style={{ fontSize: 8, color: C.textMuted }}>••{a.last4}</span>
                <p style={{ margin: "3px 0 0", fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{a.balance}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ② UNDERSTAND */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.4 }}
          style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}
        >
          <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>
            This month&apos;s spending
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {spending.map((s, i) => (
              <div key={s.category} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: C.textSecondary, width: 72, flexShrink: 0 }}>{s.category}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.cream }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: s.width }}
                    transition={{ delay: 1.3 + i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{ height: "100%", borderRadius: 3, background: s.color }}
                  />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: C.textPrimary, width: 36, textAlign: "right" }}>{s.amount}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ③ PREDICT */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.4 }}
          style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${C.blush}`,
              background: C.surface,
            }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.blush }}>
                Next bill in 3 days
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: C.textSecondary }}>
                Netflix — $15.99
              </p>
            </div>
            <ArrowRight size={11} color={C.textMuted} />
          </div>
        </motion.div>

        {/* ④ ACT */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8, duration: 0.4 }}
          style={{ padding: "14px 18px" }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: C.apricotSoft,
              border: `1px solid ${C.apricot}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.apricot }}>
                  Found savings
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
                  $42/mo in unused subscriptions
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 10, color: C.textSecondary }}>
                  3 subscriptions you can cut
                </p>
              </div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: C.apricot,
                  background: C.surface,
                  border: `1px solid ${C.apricot}`,
                  borderRadius: 100,
                  padding: "3px 10px",
                  whiteSpace: "nowrap",
                  marginTop: 2,
                }}
              >
                Review
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Floating badge */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          top: -14,
          right: -18,
          zIndex: 4,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 100,
          padding: "7px 14px",
          boxShadow: C.shadowMd,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Star size={12} color={C.apricot} />
        <span style={{ fontSize: 11, fontWeight: 600, color: C.apricot }}>3 insights ready</span>
      </motion.div>
    </motion.div>
  );
}

export function LandingHero() {
  return (
    <section
      style={{ background: `linear-gradient(160deg, ${C.cream} 0%, ${C.warmWhite} 100%)` }}
      className="relative overflow-hidden px-6 pb-28 pt-32 md:px-10 lg:pb-32 lg:pt-40"
    >
      <div className="relative z-10 mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
          {/* Left column */}
          <motion.div initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.1 } } }}>
            <motion.div variants={fadeUp} className="mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2" style={{ background: C.apricotSoft, border: `1px solid ${C.apricot}` }}>
              <img src="/calico-icon.png" alt="" style={{ width: 16, height: 16, borderRadius: 4 }} />
              <span className="text-xs font-semibold tracking-wide" style={{ color: C.caramel }}>Your friendly money companion</span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="mb-6 font-bold tracking-tight"
              style={{
                fontSize: "clamp(2.8rem, 5.5vw, 4rem)",
                fontFamily: C.fontFamily,
                color: C.textPrimary,
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
              }}
            >
              A calmer way to{" "}
              <span
                style={{
                  background: `linear-gradient(135deg, ${C.apricot} 0%, #D4956A 100%)`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                manage money.
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mb-9 max-w-[480px] leading-[1.7]"
              style={{ fontSize: "1.08rem", color: C.textSecondary }}
            >
              See where your money goes, catch recurring bills, and feel calm about your finances. No spreadsheets. No stress.
            </motion.p>

            <motion.div variants={fadeUp} className="mb-10 flex flex-col gap-3 sm:flex-row">
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/signup"
                  className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[0.88rem] font-semibold"
                  style={{
                    background: C.apricot,
                    color: C.charcoal,
                    boxShadow: "0 4px 20px rgba(253,186,116,0.42)",
                  }}
                >
                  Get early access
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </motion.div>
              <a
                href="#features"
                className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[0.88rem] font-semibold transition-all"
                style={{
                  background: C.surface,
                  border: `1.5px solid ${C.border}`,
                  color: C.textSecondary,
                  boxShadow: C.shadow,
                }}
              >
                See how it works
              </a>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-6"
              style={{ borderColor: C.border }}
            >
              {[
                { icon: ShieldCheck, label: "Bank-grade security" },
                { icon: Lock, label: "Read-only access" },
                { icon: CheckCircle2, label: "No data sold" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
                  <Icon size={13} />
                  <span className="text-xs font-medium">{label}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right column */}
          <div className="relative flex justify-center lg:justify-end">
            <ProductFlowMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
