"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowRight, BarChart3, CheckCircle2, Eye, Heart, Lock,
  RefreshCw, ShieldCheck, Star, Layers,
} from "lucide-react";
import { calicoTheme } from "@/styles/theme";

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  cream: calicoTheme.background,
  warmWhite: calicoTheme.card,
  apricot: calicoTheme.primary,
  apricotSoft: "rgba(253, 186, 116, 0.22)",
  caramel: calicoTheme.text,
  blush: calicoTheme.primarySecondary,
  blushSoft: "rgba(251, 207, 232, 0.26)",
  charcoal: calicoTheme.text,
  charcoalSoft: calicoTheme.textSoft,
  sand: calicoTheme.border,
  sage: calicoTheme.warning,
  sageSoft: "rgba(253, 230, 138, 0.28)",
  textPrimary: calicoTheme.text,
  textSecondary: calicoTheme.textSoft,
  textMuted: calicoTheme.textMuted,
  border: calicoTheme.border,
  surface: calicoTheme.card,
  shadow: calicoTheme.shadowSoft,
  shadowMd: calicoTheme.shadowMd,
  shadowLg: calicoTheme.shadowLg,
} as const;

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionHeading({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <h2 style={{ margin: 0, fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 700, color: light ? "#FFFFFF" : C.textPrimary, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.15 }}>
      {children}
    </h2>
  );
}

function Card({ children, style, highlight }: { children: React.ReactNode; style?: React.CSSProperties; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? C.apricotSoft : C.surface, border: `1px solid ${highlight ? C.apricot : C.border}`, borderRadius: 20, boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

// ─── Product Mockup ───────────────────────────────────────────────────────────

function ProductMockup() {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ background: C.surface, borderRadius: 24, border: `1px solid ${C.border}`, boxShadow: C.shadowLg, overflow: "hidden", position: "relative", zIndex: 2 }}>
        {/* App bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.cream }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/calico-icon.png" alt="Calico" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>Calico</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: C.sageSoft, border: `1px solid ${C.sage}`, borderRadius: 100, padding: "3px 10px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.sage, display: "inline-block" }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: C.caramel }}>All synced</span>
          </div>
        </div>
        {/* Net worth */}
        <div style={{ padding: "22px 22px 18px" }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 5 }}>Net Worth</p>
          <p style={{ margin: 0, fontSize: 34, fontWeight: 700, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.1 }}>$4,820</p>
        </div>
        {/* 3 insight rows */}
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { color: C.sage, label: "Found savings", val: "3 subscriptions you can cut", borderColor: C.sage },
            { color: C.apricot, label: "Dining up 12%", val: "Compared to last month", borderColor: C.apricot },
            { color: C.blush, label: "Next bill in 3 days", val: "Netflix — $15.99", borderColor: C.blush },
          ].map(({ color, label, val, borderColor }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.border}`, borderLeft: `3px solid ${borderColor}`, background: C.warmWhite }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color }}>{label}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: C.textSecondary }}>{val}</p>
              </div>
              <ArrowRight size={12} color={C.textMuted} />
            </div>
          ))}
        </div>
      </div>
      {/* Floating badge */}
      <div style={{ position: "absolute", top: -16, right: -20, zIndex: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 100, padding: "8px 14px", boxShadow: C.shadowMd, display: "flex", alignItems: "center", gap: 6 }}>
        <Star size={14} color={C.apricot} />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.apricot }}>3 insights ready</span>
      </div>
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
    { label: "Security", href: "#trust" },
  ];

  return (
    <nav className="fixed inset-x-0 top-0 z-50 transition-all duration-300" style={{ background: scrolled ? "rgba(255,247,237,0.95)" : "transparent", borderBottom: `1px solid ${scrolled ? C.border : "transparent"}`, backdropFilter: scrolled ? "blur(12px)" : "none" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 md:px-10">
        <div className="flex items-center gap-2">
          <img src="/calico-icon.png" alt="Calico" style={{ width: 28, height: 28, borderRadius: 7, objectFit: "cover" }} />
          <span className="text-[0.96rem]" style={{ color: C.charcoal, fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Calico</span>
        </div>
        <div className="hidden items-center gap-0.5 lg:flex">
          {links.map((l) => (
            <a key={l.label} href={l.href} className="rounded-lg px-3 py-2 text-[0.82rem] font-medium transition-colors" style={{ color: C.textSecondary }} onMouseEnter={(e) => (e.currentTarget.style.background = C.apricotSoft)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{l.label}</a>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <Link href="/login" className="hidden rounded-lg px-4 py-2 text-[0.78rem] font-semibold transition-colors sm:inline-flex" style={{ color: C.textSecondary, border: `1px solid ${C.border}`, background: C.surface }}>Sign in</Link>
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[0.78rem] font-semibold transition-opacity hover:opacity-90" style={{ background: C.apricot, color: C.charcoal, boxShadow: "0 2px 10px rgba(253,186,116,0.4)" }}>Get early access</Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section style={{ background: `linear-gradient(160deg, ${C.cream} 0%, ${C.warmWhite} 100%)` }} className="relative overflow-hidden px-5 pb-24 pt-32 md:px-10 lg:pb-28 lg:pt-36">
      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full px-4 py-2" style={{ background: C.apricotSoft, border: `1px solid ${C.apricot}` }}>
              <img src="/calico-icon.png" alt="Calico" style={{ width: 16, height: 16, borderRadius: 4, objectFit: "cover" }} />
              <span className="text-[0.75rem] font-semibold tracking-wide" style={{ color: C.caramel }}>Your friendly money companion</span>
            </div>
            <h1 className="mb-6 font-bold leading-[1.07] tracking-tight" style={{ fontSize: "clamp(2.4rem, 5vw, 3.4rem)", fontFamily: "'DM Sans', sans-serif", color: C.textPrimary }}>
              A clearer way to{" "}
              <span style={{ background: `linear-gradient(135deg, ${C.apricot} 0%, ${C.caramel} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>understand your money.</span>
            </h1>
            <p className="mb-9 max-w-[460px] text-[1.05rem] leading-[1.7]" style={{ color: C.textSecondary }}>
              Calico helps you see where your money goes, spot recurring bills, and feel calm about your finances. No spreadsheets. No stress.
            </p>
            <div className="mb-10 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[0.9rem] font-semibold transition-all" style={{ background: C.apricot, color: C.charcoal, boxShadow: "0 4px 20px rgba(253,186,116,0.42)" }}>
                Get early access <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#features" className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[0.9rem] font-semibold transition-all" style={{ background: C.surface, border: `1.5px solid ${C.border}`, color: C.textSecondary, boxShadow: C.shadow }}>
                See how it works
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-6" style={{ borderColor: C.border }}>
              {[
                { icon: ShieldCheck, label: "Bank-grade security" },
                { icon: Lock, label: "Read-only access" },
                { icon: CheckCircle2, label: "No data sold" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
                  <Icon size={13} /><span className="text-[0.78rem] font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative flex justify-center lg:justify-end">
            <ProductMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Benefits ─────────────────────────────────────────────────────────────────

function BenefitsSection() {
  const benefits = [
    { icon: Layers, title: "See everything in one place", desc: "Connect your accounts and see all your money at a glance.", bg: C.apricotSoft, accent: C.apricot },
    { icon: RefreshCw, title: "Catch recurring charges", desc: "We automatically detect subscriptions and bills from your transactions.", bg: C.blushSoft, accent: C.blush },
    { icon: BarChart3, title: "Understand what changed", desc: "Get simple explanations when spending patterns shift.", bg: C.sageSoft, accent: C.sage },
    { icon: Heart, title: "Feel more in control", desc: "Clear summaries, no jargon, no overwhelming dashboards.", bg: C.apricotSoft, accent: C.caramel },
  ];
  return (
    <section id="features" className="px-5 py-20 md:px-8" style={{ background: C.warmWhite, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <SectionHeading>Money clarity, without the complexity.</SectionHeading>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {benefits.map((b) => (
            <Card key={b.title} style={{ padding: 28 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: b.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <b.icon size={22} color={b.accent} />
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>{b.title}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: C.textSecondary }}>{b.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Product Preview ──────────────────────────────────────────────────────────

function ProductPreviewSection() {
  const [active, setActive] = useState(0);
  const tabs = [
    { label: "Home", desc: "Your calm financial overview. See your net worth, recent activity, and smart insights all in one clear, focused view." },
    { label: "Transactions", desc: "Every transaction organized and explained. Calico categorizes your spending and highlights anything unusual." },
    { label: "Recurring", desc: "All your subscriptions and recurring bills in one place. Know exactly what you pay for every month." },
  ];
  return (
    <section className="px-5 py-20 md:px-8" style={{ background: C.cream, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <SectionHeading>A calmer way to manage money.</SectionHeading>
        </div>
        <div className="mb-6 flex justify-center gap-2 flex-wrap">
          {tabs.map((t, i) => (
            <button key={t.label} onClick={() => setActive(i)} className="rounded-full px-5 py-2.5 text-sm font-semibold transition-all" style={active === i ? { background: C.apricot, color: C.charcoal, boxShadow: "0 4px 16px rgba(253,186,116,0.36)" } : { background: C.surface, color: C.textSecondary, border: `1px solid ${C.border}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ borderRadius: 24, background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadowMd, overflow: "hidden" }}>
          <div style={{ height: 200, background: `linear-gradient(135deg, ${C.cream} 0%, ${C.warmWhite} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, marginBottom: 8 }}>Calico — {tabs[active].label}</p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.textSecondary }}>Preview available in app</p>
            </div>
          </div>
          <div style={{ padding: "20px 24px" }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: C.textSecondary }}>{tabs[active].desc}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Trust ────────────────────────────────────────────────────────────────────

function TrustSection() {
  const cards = [
    { icon: Eye, title: "Read-only access", desc: "We never move your money. We only read what you share.", bg: C.apricotSoft, ic: C.apricot },
    { icon: Lock, title: "Bank-grade encryption", desc: "AES-256 encryption at rest and in transit, always.", bg: C.sageSoft, ic: C.sage },
    { icon: ShieldCheck, title: "You control what we see", desc: "Connect, disconnect, and audit any connection at any time.", bg: C.blushSoft, ic: C.blush },
    { icon: CheckCircle2, title: "Zero data sold", desc: "Your financial data is never sold, shared, or monetized.", bg: C.apricotSoft, ic: C.caramel },
  ];
  return (
    <section id="trust" className="px-5 py-20 md:px-8" style={{ background: C.warmWhite, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <SectionHeading>Your data stays yours.</SectionHeading>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.title} style={{ padding: 22 }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Icon size={18} color={c.ic} />
                </div>
                <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>{c.title}</h3>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.textSecondary }}>{c.desc}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function TestimonialsSection() {
  const testimonials = [
    { quote: "Calico found $340/year I was losing to forgotten subscriptions. It took five minutes to set up.", name: "Sarah M.", role: "Product Manager" },
    { quote: "I finally understand my finances without spreadsheets. Calico just shows me what matters.", name: "James T.", role: "Freelancer" },
    { quote: "This is what a money app should feel like. Calm, clear, and genuinely helpful.", name: "Rachel K.", role: "Small Business Owner" },
  ];
  return (
    <section className="px-5 py-20 md:px-8" style={{ background: C.cream, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <SectionHeading>People love Calico.</SectionHeading>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {testimonials.map((t) => (
            <Card key={t.name} style={{ padding: 24 }}>
              <div className="mb-4 flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} fill={C.apricot} color={C.apricot} />)}
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: C.textSecondary, fontStyle: "italic" }}>&ldquo;{t.quote}&rdquo;</p>
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.apricotSoft, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: C.caramel }}>
                  {t.name[0]}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{t.name}</p>
                  <p style={{ margin: "1px 0 0", fontSize: 11, color: C.textMuted }}>{t.role}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function PricingSection() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      desc: "Core features to get started",
      features: [
        "Connect up to 2 accounts",
        "See all transactions",
        "Basic spending insights",
        "Recurring bill detection",
        "Monthly summaries",
      ],
      cta: "Get Started",
      href: "/signup",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "$7.99",
      period: "/month",
      desc: "Everything, unlimited",
      badge: "Most Popular",
      features: [
        "Everything in Free",
        "Unlimited accounts",
        "Smart savings suggestions",
        "Spending trend analysis",
        "Custom categories",
        "Priority support",
      ],
      cta: "Start Free Trial",
      href: "/signup",
      highlighted: true,
    },
  ];
  return (
    <section id="pricing" className="px-5 py-20 md:px-8" style={{ background: C.warmWhite, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <SectionHeading>Simple, honest pricing.</SectionHeading>
          <p className="mx-auto mt-4 max-w-lg text-[0.96rem] leading-relaxed" style={{ color: C.textSecondary }}>Start free. Upgrade when you want more.</p>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 md:max-w-2xl md:mx-auto">
          {plans.map((plan) => (
            <div key={plan.name} className="relative flex flex-col" style={{ background: plan.highlighted ? C.apricotSoft : C.surface, border: `1.5px solid ${plan.highlighted ? C.apricot : C.border}`, borderRadius: 24, padding: 28, boxShadow: plan.highlighted ? "0 8px 32px rgba(253,186,116,0.28)" : C.shadow }}>
              {plan.badge && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.1em]" style={{ background: C.apricot, color: C.charcoal, boxShadow: "0 2px 8px rgba(253,186,116,0.35)" }}>{plan.badge}</span>}
              <div className="mb-5">
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>{plan.name}</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span style={{ fontSize: 36, fontWeight: 700, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>{plan.price}</span>
                  {plan.period && <span style={{ fontSize: 13, color: C.textMuted }}>{plan.period}</span>}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>{plan.desc}</p>
              </div>
              <ul className="flex-1 space-y-2.5">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5" style={{ fontSize: 13.5, color: C.textSecondary }}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: C.apricot }} />{feat}
                  </li>
                ))}
              </ul>
              <Link href={plan.href} className="mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition-all" style={plan.highlighted ? { background: C.apricot, color: C.charcoal, boxShadow: "0 4px 16px rgba(253,186,116,0.38)" } : { background: C.surface, border: `1px solid ${C.border}`, color: C.textSecondary }}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function CtaSection() {
  const [email, setEmail] = useState("");
  return (
    <section className="relative overflow-hidden px-5 py-24 md:px-8" style={{ background: `linear-gradient(160deg, ${C.cream} 0%, ${C.warmWhite} 100%)`, borderTop: `1px solid ${C.border}` }}>
      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h2 className="mb-4 font-bold leading-tight" style={{ fontSize: "clamp(2rem, 5vw, 2.8rem)", fontFamily: "'DM Sans', sans-serif", color: C.textPrimary }}>Ready to feel better about your money?</h2>
        <p className="mx-auto mb-8 max-w-md text-[0.97rem] leading-relaxed" style={{ color: C.textSecondary }}>Join thousands of people who finally understand where their money goes.</p>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center" onSubmit={(e) => e.preventDefault()}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="h-12 w-full rounded-full px-5 text-sm focus:outline-none sm:w-72" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary }} />
          <Link href={`/signup${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold" style={{ background: C.apricot, color: C.charcoal, boxShadow: "0 4px 18px rgba(253,186,116,0.38)" }}>
            Get early access <ArrowRight className="h-4 w-4" />
          </Link>
        </form>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          {[
            { icon: CheckCircle2, label: "No credit card required" },
            { icon: RefreshCw, label: "Cancel anytime" },
            { icon: Lock, label: "Bank-grade security" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
              <Icon className="h-3.5 w-3.5" /><span className="text-[0.75rem]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="px-5 py-12 md:px-8" style={{ background: C.warmWhite, borderTop: `1px solid ${C.border}` }}>
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src="/calico-icon.png" alt="Calico" style={{ width: 22, height: 22, borderRadius: 5, objectFit: "cover" }} />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>Calico</p>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6 }}>The friendly money app that actually understands you.</p>
          </div>
          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>Product</p>
            {["Home", "Transactions", "Recurring", "Insights"].map((l) => (
              <a key={l} href="#" className="block mb-2 text-sm" style={{ color: C.textSecondary }}>{l}</a>
            ))}
          </div>
          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>Company</p>
            {["About", "Security", "Privacy", "Terms"].map((l) => (
              <a key={l} href="#" className="block mb-2 text-sm" style={{ color: C.textSecondary }}>{l}</a>
            ))}
          </div>
          <div>
            <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted }}>Follow</p>
            {["Twitter / X", "LinkedIn"].map((l) => (
              <a key={l} href="#" className="block mb-2 text-sm" style={{ color: C.textSecondary }}>{l}</a>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: C.border }}>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>&copy; 2025 Calico. All rights reserved.</p>
          <div className="flex gap-4">
            {["Privacy", "Terms"].map((l) => <a key={l} href="#" className="text-xs" style={{ color: C.textMuted }}>{l}</a>)}
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="min-h-screen" style={{ fontFamily: calicoTheme.fontFamily, background: C.warmWhite }}>
      <Nav />
      <HeroSection />
      <BenefitsSection />
      <ProductPreviewSection />
      <TrustSection />
      <TestimonialsSection />
      <PricingSection />
      <CtaSection />
      <Footer />
    </div>
  );
}
