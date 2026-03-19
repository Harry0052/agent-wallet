import type { HTMLAttributes } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle, dashboardInsetStyle, dashboardPrimaryButtonStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function AdviceWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  const cards = props.useLiveData && props.accountsConnected ? props.home.insightCards.slice(0, 2) : [];
  const studentCards = props.useLiveData && props.accountsConnected
    ? props.home.moneyIntelligence?.studentFocus.cards.slice(0, 2) || []
    : [];
  const alerts = props.useLiveData && props.accountsConnected
    ? props.home.moneyIntelligence?.alerts.slice(0, 1) || []
    : [];
  const advanced = props.useLiveData && props.accountsConnected
    ? props.home.moneyIntelligence?.advancedIntelligence
    : null;
  const automation = props.useLiveData && props.accountsConnected
    ? props.home.automation?.summary
    : null;

  return (
    <WidgetContainer
      title="What Calico Noticed"
      subtitle="Tips, alerts, and ideas to help you with your money."
      dragHandleProps={props.dragHandleProps}
    >
      {cards.length === 0 ? (
        <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-4">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[20px] bg-[rgba(253,186,116,0.2)] text-[var(--calico-primary)]">
              <Sparkles size={20} />
            </div>
            <p className="mt-4 text-lg font-semibold text-[var(--calico-text)]">Calico has tips for you</p>
            <p className="mt-2 text-sm leading-6 text-[var(--calico-text-muted)]">Answer a few questions and Calico will start noticing things about your money and share helpful ideas.</p>
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
          {studentCards.map((card) => (
            <div key={card.id} className="rounded-[20px] border border-[var(--calico-border)] bg-[rgba(251,207,232,0.16)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--calico-text)]">{card.title}</p>
              <p className="mt-1 text-sm text-[var(--calico-text-muted)]">{card.summary}</p>
            </div>
          ))}
          {alerts.map((alert) => (
            <div key={alert.id} className="rounded-[20px] border border-[var(--calico-border)] bg-[rgba(251,191,36,0.12)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--calico-text)]">{alert.title}</p>
              <p className="mt-1 text-sm text-[var(--calico-text-muted)]">{alert.summary}</p>
            </div>
          ))}
          {automation ? (
            <div className="rounded-[20px] border border-[var(--calico-border)] bg-[var(--calico-hover)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--calico-text)]">Your To-Do List</p>
              <p className="mt-1 text-sm text-[var(--calico-text-muted)]">
                {automation.pendingConfirmCount} need your OK · {automation.activeCount} in progress.
              </p>
            </div>
          ) : null}
          {advanced ? (
            <div className="rounded-[20px] border border-[var(--calico-border)] bg-[rgba(59,130,246,0.08)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--calico-text)]">Money Checkup</p>
              <p className="mt-1 text-sm text-[var(--calico-text-muted)]">
                Risk {advanced.financialRiskScoring.riskBand} ({Math.round(advanced.financialRiskScoring.overallRiskScore)}) · Stress {advanced.financialStressDetection.status}.
              </p>
              <p className="mt-1 text-sm text-[var(--calico-text-muted)]">
                Suggested monthly goal contribution: ${Math.round(advanced.lifeGoalPlanning.recommendedContributionNow)}.
              </p>
            </div>
          ) : null}
          <Link href="/insights" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
            See more from Calico
          </Link>
          {automation ? (
            <Link href="/tasks" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--calico-primary)] transition hover:text-[var(--calico-primary-hover)]">
              Open Task Center
            </Link>
          ) : null}
        </div>
      )}
    </WidgetContainer>
  );
}
