import type { HTMLAttributes } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function AdviceWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const cards = props.useLiveData && props.accountsConnected ? props.home.insightCards.slice(0, 2) : [];

  return (
    <WidgetContainer
      title="Advice"
      subtitle="Actionable guidance stays modular so it can swap from placeholder to AI-driven recommendations later."
      dragHandleProps={props.dragHandleProps}
    >
      {cards.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(253,186,116,0.2)] text-[var(--calico-primary)]">
              <Sparkles size={20} />
            </div>
            <p className="mt-4 text-lg font-semibold text-[var(--calico-text)]">Get personalized advice</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">Answer a few questions and Calico can turn this space into a focused advice feed.</p>
          </div>
          <Link
            href="/insights"
            style={dashboardPrimaryButtonStyle}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-[20px] px-4 text-sm font-semibold transition hover:bg-[var(--calico-primary-hover)]"
          >
            Get started
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <div key={card.id} style={dashboardInsetStyle} className="rounded-[20px] px-4 py-4">
              <p className="text-sm font-semibold text-[var(--calico-text)]">{card.title}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">{card.summary}</p>
            </div>
          ))}
          <Link href="/insights" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
            View more advice
          </Link>
        </div>
      )}
    </WidgetContainer>
  );
}
