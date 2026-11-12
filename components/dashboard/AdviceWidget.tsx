import type { HTMLAttributes } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function AdviceWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const cards = props.useLiveData && props.accountsConnected ? props.home.insightCards.slice(0, 3) : [];

  return (
    <WidgetContainer
      title="Tips from Agent Wallet"
      subtitle="Helpful suggestions based on your recent activity."
      dragHandleProps={props.dragHandleProps}
    >
      {cards.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(253,186,116,0.2)] text-[var(--aw-primary)]">
              <Sparkles size={20} />
            </div>
            <p className="mt-4 text-lg font-semibold text-[var(--aw-text)]">Agent Wallet has tips for you</p>
            <p className="mt-2 text-sm leading-6 text-[var(--aw-text-muted)]">
              Once you connect an account, Agent Wallet will start noticing patterns and share helpful ideas about your money.
            </p>
          </div>
          <Link
            href="/insights"
            style={dashboardPrimaryButtonStyle}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--aw-primary-strong)]"
          >
            Explore insights
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <div key={card.id} style={dashboardInsetStyle} className="rounded-[20px] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--aw-text)]">{card.title}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--aw-text-muted)]">{card.summary}</p>
            </div>
          ))}
          <div className="flex items-center gap-4">
            <Link href="/insights" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--aw-primary)] transition hover:text-[var(--aw-primary-strong)]">
              See all tips
            </Link>
            <Link href="/tasks" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--aw-primary)] transition hover:text-[var(--aw-primary-strong)]">
              Open Task Center
            </Link>
          </div>
        </div>
      )}
    </WidgetContainer>
  );
}
