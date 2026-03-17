"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Bot,
  Home,
  Landmark,
  Lightbulb,
  ListChecks,
  LineChart,
  MessageCircle,
  PieChart,
  RefreshCw,
  Settings,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useCustomLabels } from "@/lib/useCustomLabels";

interface NavLink {
  href: string;
  key: string;
  icon: LucideIcon;
}

const mainLinks: NavLink[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/accounts", key: "accounts", icon: Landmark },
  { href: "/transactions", key: "transactions", icon: ArrowLeftRight },
  { href: "/recurring", key: "recurring", icon: RefreshCw },
  { href: "/tasks", key: "tasks", icon: ListChecks },
  { href: "/cashflow", key: "cashflow", icon: TrendingUp },
];

const planLinks: NavLink[] = [
  { href: "/budgets", key: "budgets", icon: PieChart },
  { href: "/goals", key: "goals", icon: Target },
  { href: "/investments", key: "investments", icon: LineChart },
  { href: "/reports", key: "reports", icon: BarChart3 },
  { href: "/insights", key: "insights", icon: Lightbulb },
  { href: "/advice", key: "advice", icon: MessageCircle },
  { href: "/automations", key: "automations", icon: Bot },
];

const utilLinks: NavLink[] = [{ href: "/settings", key: "settings", icon: Settings }];

export function AppNav() {
  const pathname = usePathname();
  const { getLabel } = useCustomLabels();

  const renderLink = (link: NavLink) => {
    const isActive = pathname === link.href;
    const Icon = link.icon;
    return (
      <Link key={link.href} href={link.href} className="sw-sidebar-link" data-active={isActive}>
        <Icon size={18} strokeWidth={isActive ? 2 : 1.7} />
        {getLabel(link.key)}
      </Link>
    );
  };

  return (
    <>
      <nav className="sw-sidebar hidden md:flex">
        <div className="sw-sidebar-logo">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--aw-primary-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <img src="/calico-icon.png" alt="Calico" className="h-6 w-6 rounded-lg object-cover" />
          </div>
          <div>
            <p className="text-[0.94rem] font-semibold tracking-[-0.02em] text-[var(--aw-text)]">Calico</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--aw-text-muted)]">Your Money Helper</p>
          </div>
        </div>

        <div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Your Money</div>
        <div className="sw-sidebar-nav">{mainLinks.map(renderLink)}</div>

        <div className="sw-sidebar-divider" />

        <div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--aw-text-muted)]">Plan Ahead</div>
        <div className="sw-sidebar-nav">{planLinks.map(renderLink)}</div>

        <div className="mt-auto rounded-[16px] border border-[var(--aw-border)] bg-[var(--aw-surface-1)]/70 p-2 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="sw-sidebar-nav">{utilLinks.map(renderLink)}</div>
        </div>
      </nav>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--aw-border)] bg-[var(--aw-surface-1)]/90 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-around px-2 py-2">
          {[mainLinks[0], mainLinks[2], mainLinks[3], mainLinks[4], utilLinks[0]].map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-semibold transition-colors ${
                  isActive ? "text-[var(--aw-primary)]" : "text-[var(--aw-text-muted)]"
                }`}
              >
                <Icon size={20} strokeWidth={isActive ? 2 : 1.6} />
                {getLabel(link.key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
