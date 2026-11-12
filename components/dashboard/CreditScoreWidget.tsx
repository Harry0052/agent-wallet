import type { HTMLAttributes } from "react";
import { ShieldCheck } from "lucide-react";
import { WidgetContainer } from "@/components/dashboard/WidgetContainer";
import { dashboardDashedStyle } from "@/components/dashboard/dashboardStyles";
import type { DashboardWidgetProps } from "@/components/dashboard/dashboardTypes";

export function CreditScoreWidget(props: DashboardWidgetProps & { dragHandleProps?: HTMLAttributes<HTMLButtonElement> }) {
  return (
    <WidgetContainer
      title="Credit Score"
      dragHandleProps={props.dragHandleProps}
    >
      <div style={dashboardDashedStyle} className="flex h-full flex-col justify-between rounded-[20px] p-6">
        <div>
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-[rgba(34,197,94,0.15)] text-[var(--calico-success)]">
            <ShieldCheck size={24} />
          </div>
          <p className="mt-4 text-base font-semibold text-[var(--calico-text)]">
            Credit score tracking
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--calico-text-muted)]">
            Agent Wallet is working on adding credit score tracking to your dashboard. You'll be able to see your score and get alerts when it changes.
          </p>
        </div>
        <div className="mt-6 inline-flex h-11 items-center justify-center rounded-[16px] border border-[var(--calico-border)] bg-[var(--calico-hover)] px-4 text-sm font-semibold text-[var(--calico-text-muted)]">
          Coming soon
        </div>
      </div>
    </WidgetContainer>
  );
}
