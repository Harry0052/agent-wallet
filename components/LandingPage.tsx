"use client";

import Link from "next/link";
import {
  CheckCircle2,
  CreditCard,
  RefreshCw,
  TrendingDown,
} from "lucide-react";

export function LandingPage() {
  const dashboardHref = "/operator?entry=landing";
  const tasksHref = "/execution";
  const walletHref = "/wallet";
  const billingHref = "/subscriptions";
  const settingsHref = "/settings";
  const pricingCtas = {
    starter: "/signup",
    professional: "/signup",
    enterprise: "mailto:sales@agentwallet.ai",
  };

  return (
    <div className="min-h-screen">
      <nav className="aw-global-nav" data-surface="light">
        <div className="aw-global-nav-inner max-w-[1280px] px-5 md:px-8">
          <div className="flex items-center gap-2.5">
            <div className="aw-brand-mark">
              <span className="text-sm font-bold tracking-wider text-white">
                AW
              </span>
            </div>
            <span className="text-[1.02rem] font-semibold tracking-[0.01em] text-[var(--aw-text)]">
              Agent Wallet
            </span>
            <span className="hidden rounded-full border border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--aw-primary-strong)] xl:inline-flex">
              Financial OS
            </span>
          </div>

          <div className="hidden items-center gap-0.5 lg:flex">
            <Link href={dashboardHref} className="aw-nav-link-dark" data-active="true">
              Dashboard
            </Link>
            <Link href={tasksHref} className="aw-nav-link-dark">
              Tasks
            </Link>
            <Link href={walletHref} className="aw-nav-link-dark">
              Wallet
            </Link>
            <Link href={billingHref} className="aw-nav-link-dark">
              Subscriptions
            </Link>
            <Link href={settingsHref} className="aw-nav-link-dark">
              Settings
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-4 py-2 text-[0.78rem] font-semibold text-[var(--aw-text-soft)] transition-colors hover:border-[var(--aw-border-strong)] hover:text-[var(--aw-primary-strong)] sm:inline-flex"
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className="hidden items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-4 py-2 text-[0.78rem] font-semibold text-[var(--aw-text-soft)] transition-colors hover:border-[var(--aw-border-strong)] hover:text-[var(--aw-primary-strong)] sm:inline-flex"
            >
              Sign Up
            </Link>
            <Link
              href={dashboardHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--aw-primary)] px-4 py-2 text-[0.78rem] font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] transition-colors hover:bg-[var(--aw-primary-strong)]"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <section className="aw-hero-dark flex min-h-[72vh] items-center px-5 pb-14 pt-28 md:px-8 md:pb-20">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="animate-word-slide text-[2.3rem] font-bold leading-[1.08] tracking-tight text-[var(--aw-text)] md:text-[3.2rem]">
              Agent Wallet
            </h1>

            <p className="animate-word-slide animation-delay-80 mt-3 text-[1.04rem] text-[var(--aw-text-soft)] md:text-[1.16rem]">
              Autonomous spend, human control.
            </p>

            <div
              className="animate-word-slide animation-delay-160 mx-auto mt-6 inline-flex flex-col gap-1 rounded-2xl border border-[var(--aw-border)] bg-white px-5 py-4 text-[0.96rem] font-medium text-[var(--aw-text-soft)]"
            >
              <p>Fund tasks.</p>
              <p>Watch them run.</p>
              <p>Approve only when needed.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-12 md:px-8 md:py-14">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2 md:gap-3">
          {[
            "Live balance",
            "Task execution",
            "Spend limits",
            "Full audit trail",
          ].map((item, index) => (
            <span
              key={item}
              className="animate-scale-in rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1.5 text-[0.72rem] font-semibold text-[var(--aw-text-soft)]"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="animate-slide-in-left aw-page-kicker">Product</p>
          <h2 className="animate-word-slide animation-delay-80 mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            What you actually use
          </h2>

          <article className="animate-card-reveal animation-delay-160 aw-surface-elevated mt-6 overflow-hidden p-0">
            <div className="border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3 md:px-5">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  "Dashboard",
                  "Tasks",
                  "Wallet",
                  "Subscriptions",
                  "Settings",
                ].map((tab) => (
                  <span
                    key={tab}
                    className="rounded-full border border-[var(--aw-border)] bg-white px-2.5 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-[var(--aw-text-muted)]"
                  >
                    {tab}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:gap-5 md:p-5">
              <div className="animate-card-reveal animation-delay-200 rounded-xl border border-[var(--aw-border)] bg-white p-4">
                <p className="aw-kicker">Task Console</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Prompt → execution
                </h3>
                <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
                  One prompt. The agent handles the rest.
                </p>
              </div>

              <div className="animate-card-reveal animation-delay-240 rounded-xl border border-[var(--aw-border)] bg-white p-4">
                <p className="aw-kicker">Run History</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Every action, logged
                </h3>
                <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
                  Task steps and wallet changes in one timeline.
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--aw-border)] px-4 py-3 md:px-5">
              <Link
                href={dashboardHref}
                className="text-sm font-semibold text-[var(--aw-primary-strong)] transition-colors hover:text-[var(--aw-primary)]"
              >
                Open dashboard
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="animate-slide-in-left aw-page-kicker">How it works</p>
          <h2 className="animate-word-slide animation-delay-80 mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Four steps
          </h2>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-4">
            {[
              { title: "Prompt", detail: "Tell it what to buy." },
              { title: "Execute", detail: "Agent searches and compares." },
              { title: "Approve", detail: "You confirm before it spends." },
              { title: "Receipt", detail: "Logged, tracked, done." },
            ].map((step, index) => (
              <article
                key={step.title}
                className="animate-card-reveal rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-4"
                style={{ animationDelay: `${160 + index * 70}ms` }}
              >
                <p className="text-[0.7rem] font-bold tracking-[0.1em] text-[var(--aw-primary-strong)]">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 text-[1rem] font-semibold text-[var(--aw-text)]">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-[0.82rem] text-[var(--aw-text-soft)]">
                  {step.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="animate-slide-in-left aw-page-kicker">Plans</p>
          <h2 className="animate-word-slide animation-delay-80 mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Pricing with built-in subscription control
          </h2>
          <p className="animate-word-slide animation-delay-120 mt-2 text-sm text-[var(--aw-text-soft)]">
            Every paid plan includes the Subscriptions workspace for renewals, cancellations, and auditability.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              {
                src: "https://images.unsplash.com/photo-1556742393-d75f468bfcb0?auto=format&fit=crop&w=1200&q=80",
                alt: "Team reviewing budget dashboard",
                label: "Spend Visibility",
              },
              {
                src: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
                alt: "Charts and subscription analytics",
                label: "Subscription Control",
              },
              {
                src: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80",
                alt: "Financial planning workspace",
                label: "Audit Ready",
              },
            ].map((visual, index) => (
              <article
                key={visual.label}
                className="animate-card-reveal overflow-hidden rounded-2xl border border-[var(--aw-border)] bg-white"
                style={{ animationDelay: `${120 + index * 70}ms` }}
              >
                <img
                  src={visual.src}
                  alt={visual.alt}
                  loading="lazy"
                  className="h-36 w-full object-cover"
                />
                <p className="border-t border-[var(--aw-border)] px-3 py-2 text-xs font-semibold text-[var(--aw-text-soft)]">
                  {visual.label}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-7 grid grid-cols-1 items-stretch gap-4 md:grid-cols-3">
            {[
              {
                name: "Starter",
                price: "Free",
                desc: "For trying Agent Wallet",
                features: [
                  "Basic task creation",
                  "Wallet balance tracking",
                  "Spending limits",
                  "Run history",
                ],
                cta: "Get Started",
                href: pricingCtas.starter,
              },
              {
                name: "Professional",
                price: "$29",
                period: "/month",
                desc: "For power users",
                features: [
                  "Everything in Starter",
                  "AI-powered search",
                  "Auto-approval rules",
                  "Subscription management",
                  "Team collaboration",
                ],
                cta: "Start Free Trial",
                highlighted: true,
                href: pricingCtas.professional,
              },
              {
                name: "Enterprise",
                price: "Custom",
                desc: "For organizations",
                features: [
                  "Everything in Professional",
                  "API access",
                  "Priority support",
                  "Custom integrations",
                  "SLA guarantee",
                ],
                cta: "Contact Sales",
                href: pricingCtas.enterprise,
              },
            ].map((plan, index) => (
              <div
                key={plan.name}
                className={`animate-card-reveal rounded-xl border px-5 py-6 ${
                  plan.highlighted
                    ? "border-[var(--aw-primary)] bg-[var(--aw-primary-soft)]"
                    : "border-[var(--aw-border)] bg-white"
                }`}
                style={{ animationDelay: `${160 + index * 80}ms` }}
              >
                <p className="text-sm font-semibold text-[var(--aw-text)]">
                  {plan.name}
                </p>
                <div className="mt-3 flex items-baseline gap-1">
                  <p className="text-[2.2rem] font-bold text-[var(--aw-text)]">
                    {plan.price}
                  </p>
                  {plan.period && (
                    <p className="text-sm text-[var(--aw-text-soft)]">
                      {plan.period}
                    </p>
                  )}
                </div>
                <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
                  {plan.desc}
                </p>
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-[var(--aw-text-soft)]"
                    >
                      <CheckCircle2
                        size={16}
                        className="mt-0.5 flex-shrink-0 text-[var(--aw-primary)]"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-semibold transition-colors ${
                    plan.highlighted
                      ? "bg-[var(--aw-primary)] text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] hover:bg-[var(--aw-primary-strong)]"
                      : "border border-[var(--aw-border)] bg-white text-[var(--aw-text-soft)] hover:border-[var(--aw-border-strong)]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3">
            <p className="text-xs text-[var(--aw-text-soft)]">
              Already running plans? Use the{' '}
              <Link href={billingHref} className="font-semibold text-[var(--aw-primary-strong)] hover:underline">
                Subscriptions workspace
              </Link>{' '}
              to inspect billing, check renewals, and cancel when needed.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="animate-slide-in-left aw-page-kicker">Subscriptions</p>
          <h2 className="animate-word-slide animation-delay-80 mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Subscription operations in one place
          </h2>
          <p className="animate-word-slide animation-delay-120 mt-2 text-sm text-[var(--aw-text-soft)]">
            From discovery to cancellation, actions stay connected to wallet controls and logs.
          </p>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              {
                icon: CreditCard,
                title: "Discover",
                desc: "Find and compare services before signup.",
              },
              {
                icon: RefreshCw,
                title: "Renewals",
                desc: "Review upcoming renewals and take action.",
              },
              {
                icon: TrendingDown,
                title: "Spend + Audit",
                desc: "Control limits and keep a complete trail.",
              },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="animate-card-reveal rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] p-5"
                  style={{ animationDelay: `${160 + index * 60}ms` }}
                >
                  <Icon
                    size={32}
                    className="text-[var(--aw-primary)]"
                  />
                  <h3 className="mt-3 font-semibold text-[var(--aw-text)]">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-[var(--aw-text-soft)]">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-5">
            <Link href={billingHref} className="aw-button-secondary inline-flex h-9 items-center px-3 text-xs">
              Open Subscriptions Workspace
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--aw-border)] bg-white px-5 py-8 md:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-semibold text-[var(--aw-text)]">Agent Wallet</p>
          <p className="text-xs text-[var(--aw-text-muted)]">
            Autonomous spending, fully controlled.
          </p>
        </div>
      </footer>
    </div>
  );
}
