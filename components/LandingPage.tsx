"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function LandingPage() {
  const dashboardHref = "/operator?entry=landing";
  const demoHref = "/operator?demo=1&entry=landing";
  const tasksHref = "/execution";
  const analyticsHref = "/tools";
  const walletHref = "/wallet";
  const billingHref = "/subscriptions";
  const settingsHref = "/settings";

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
            <Link href={analyticsHref} className="aw-nav-link-dark">
              Analytics
            </Link>
            <Link href={billingHref} className="aw-nav-link-dark">
              Billing
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
              className="hidden items-center gap-1.5 rounded-lg border border-[var(--aw-border)] bg-white px-4 py-2 text-[0.78rem] font-semibold text-[var(--aw-text-soft)] transition-colors hover:border-[var(--aw-border-strong)] hover:text-[var(--aw-primary-strong)] sm:inline-flex"
            >
              Open Dashboard
            </Link>
            <Link
              href={demoHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--aw-primary)] px-4 py-2 text-[0.78rem] font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] transition-colors hover:bg-[var(--aw-primary-strong)]"
            >
              Try Demo
            </Link>
          </div>
        </div>
      </nav>

      <section className="aw-hero-dark flex min-h-[72vh] items-center px-5 pb-14 pt-28 md:px-8 md:pb-20">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="animate-fade-up text-[2.3rem] font-bold leading-[1.08] tracking-tight text-[var(--aw-text)] md:text-[3.2rem]">
              Agent Wallet
            </h1>

            <p className="animate-fade-up mt-3 text-[1.04rem] text-[var(--aw-text-soft)] md:text-[1.16rem]">
              Your wallet, but it has a brain and hands.
            </p>

            <div
              className="animate-fade-up mx-auto mt-6 inline-flex flex-col gap-1 rounded-2xl border border-[var(--aw-border)] bg-white px-5 py-4 text-[0.96rem] font-medium text-[var(--aw-text-soft)]"
              style={{ animationDelay: "80ms" }}
            >
              <p>Fund tasks.</p>
              <p>Watch them run.</p>
              <p>Track spend in one place.</p>
            </div>

            <div
              className="animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3"
              style={{ animationDelay: "140ms" }}
            >
              <Link
                href={dashboardHref}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--aw-primary)] px-6 py-3.5 text-[0.88rem] font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.24)] transition-colors hover:bg-[var(--aw-primary-strong)]"
              >
                Open Dashboard
                <ArrowRight size={16} />
              </Link>
              <Link
                href={tasksHref}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-white px-6 py-3.5 text-[0.88rem] font-semibold text-[var(--aw-text-soft)] transition-colors hover:border-[var(--aw-border-strong)] hover:text-[var(--aw-primary-strong)]"
              >
                View Tasks
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-12 md:px-8 md:py-14">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2 md:gap-3">
          {[
            "Real wallet balance",
            "Live task runs",
            "Spend guardrails",
            "Run history",
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1.5 text-[0.72rem] font-semibold text-[var(--aw-text-soft)]"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="aw-page-kicker">Product</p>
          <h2 className="mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Live product view
          </h2>
          <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
            This is the same UI you use in the app.
          </p>

          <article className="aw-surface-elevated mt-6 overflow-hidden p-0">
            <div className="border-b border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-4 py-3 md:px-5">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  "Dashboard",
                  "Tasks",
                  "Wallet",
                  "Analytics",
                  "Billing",
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
              <div className="rounded-xl border border-[var(--aw-border)] bg-white p-4">
                <p className="aw-kicker">Task Console</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Create and run tasks
                </h3>
                <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
                  Write what you want. The app handles research, checks, and
                  approvals.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--aw-border)] bg-white p-4">
                <p className="aw-kicker">Run History</p>
                <h3 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                  Track each step
                </h3>
                <p className="mt-2 text-sm text-[var(--aw-text-soft)]">
                  See real task activity and wallet changes in one timeline.
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--aw-border)] px-4 py-3 md:px-5">
              <Link
                href={dashboardHref}
                className="text-sm font-semibold text-[var(--aw-primary-strong)] transition-colors hover:text-[var(--aw-primary)]"
              >
                Open the real dashboard
              </Link>
            </div>
          </article>
        </div>
      </section>

      <section className="border-t border-[var(--aw-border)] bg-white px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="aw-page-kicker">How it works</p>
          <h2 className="mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Simple flow
          </h2>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-4">
            {[
              { title: "Create", detail: "Start with one prompt." },
              { title: "Run", detail: "Watch tasks run live." },
              { title: "Approve", detail: "Review high-impact actions." },
              { title: "Track", detail: "Follow spend and history." },
            ].map((step, index) => (
              <article
                key={step.title}
                className="rounded-2xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-4"
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

      <section className="border-t border-[var(--aw-border)] px-5 py-14 md:px-8 md:py-18">
        <div className="mx-auto max-w-5xl">
          <p className="aw-page-kicker">Key actions</p>
          <h2 className="mt-1 text-[1.45rem] font-bold text-[var(--aw-text)] md:text-[1.9rem]">
            Start where you need
          </h2>

          <div className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Dashboard", href: dashboardHref, detail: "Create and review tasks." },
              { title: "Tasks", href: tasksHref, detail: "Watch live runs." },
              { title: "Wallet", href: walletHref, detail: "Manage balance and limits." },
              { title: "Billing", href: billingHref, detail: "Handle plan changes." },
            ].map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="rounded-2xl border border-[var(--aw-border)] bg-white p-4 transition-colors hover:border-[var(--aw-border-strong)]"
              >
                <p className="text-sm font-semibold text-[var(--aw-text)]">
                  {item.title}
                </p>
                <p className="mt-1.5 text-xs text-[var(--aw-text-soft)]">
                  {item.detail}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--aw-border)] bg-white px-5 py-8 md:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-semibold text-[var(--aw-text)]">Agent Wallet</p>
          <p className="text-xs text-[var(--aw-text-muted)]">
            Financial OS for tasks, wallet controls, and spend tracking.
          </p>
        </div>
      </footer>
    </div>
  );
}
