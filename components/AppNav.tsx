"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Command,
  Layers3,
  Settings,
  WalletCards,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { fmt } from "@/lib/utils";
import { logout } from '@/services/auth';

const navLinks = [
  { href: "/operator", label: "Dashboard", icon: Command },
  { href: "/execution", label: "Tasks", icon: Activity },
  { href: "/tools", label: "Tools", icon: BarChart3 },
  { href: "/wallet", label: "Wallet", icon: WalletCards },
  { href: "/refunds", label: "Recovery", icon: AlertTriangle },
  { href: "/subscriptions", label: "Billing", icon: Layers3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function getSystemStatusLabel(
  isProcessing: boolean,
  status: string | undefined,
): string {
  if (status === "awaiting-approval") return "Needs Approval";
  if (isProcessing) return "Running Task";
  if (status === "completed") return "Task Complete";
  if (status === "cancelled") return "Task Cancelled";
  return "Ready";
}

function getSystemStatusState(
  isProcessing: boolean,
  status: string | undefined,
): "live" | "ok" | "alert" {
  if (status === "cancelled") return "alert";
  if (status === "awaiting-approval" || isProcessing) return "live";
  return "ok";
}

export function AppNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { wallet, isProcessing, activeTask } = useApp();
  const isDemoMode = searchParams.get("demo") === "1";

  const systemLabel = getSystemStatusLabel(isProcessing, activeTask?.status);
  const systemState = getSystemStatusState(isProcessing, activeTask?.status);

  const buildHref = (base: string) => {
    if (isDemoMode) return `${base}?demo=1`;
    return base;
  };

  const onLogout = async () => {
    await logout();
    router.replace('/login');
    router.refresh();
  };

  return (
    <>
      {/* Desktop top nav */}
      <nav className="aw-global-nav hidden md:block" data-surface="light">
        <div className="aw-global-nav-inner max-w-[1280px] px-5">
          {/* Left: Logo */}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <div className="aw-brand-mark">
              <span className="text-[0.65rem] font-bold tracking-wider text-white">
                AW
              </span>
            </div>
            <span className="text-[0.95rem] font-semibold tracking-[0.01em] text-[var(--aw-text)]">
              Agent Wallet
            </span>
            <span className="hidden rounded-full border border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--aw-primary-strong)] lg:inline-flex">
              Financial OS
            </span>
          </Link>

          {/* Center: Page links */}
          <div className="flex items-center gap-0.5">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={buildHref(link.href)}
                  className="aw-nav-link"
                  data-active={isActive}
                >
                  <Icon size={14} />
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right: Status + Balance */}
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="aw-status-chip" data-state={systemState}>
              {systemLabel}
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] px-3 py-1.5">
              <WalletCards size={13} className="text-[var(--aw-primary-strong)]" />
              <span className="text-[0.78rem] font-bold text-[var(--aw-text)]">
                {fmt(wallet.balance)}
              </span>
            </div>
            <button
              type="button"
              className="aw-button-secondary px-3 py-1.5 text-xs"
              onClick={() => { void onLogout(); }}
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--aw-border)] bg-white/92 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between px-1 py-2">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={buildHref(link.href)}
                className={`flex min-w-[3.55rem] flex-col items-center gap-0.5 px-1.5 py-1 text-[0.58rem] font-semibold transition-colors ${
                  isActive
                    ? "text-[var(--aw-primary-strong)]"
                    : "text-[var(--aw-text-muted)] hover:text-[var(--aw-text-soft)]"
                }`}
              >
                <Icon size={18} />
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
